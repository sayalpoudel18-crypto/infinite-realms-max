import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';

// A local run explicitly disables external AI calls. A public run refuses
// login redirects, so a Vercel sign-in page cannot pass as a healthy game.
const external = process.argv[2];
const base = external || 'http://127.0.0.1:3183';
const report = { base, timestamp: new Date().toISOString(), checks: [], conversation: [] };
let child;
let serverOutput = '';
let state = {
  hp: { current: 100, max: 100 }, qi: { current: 50, max: 100 }, xp: 0,
  gold: 0, turn: 0, realm: 'Body Tempering — Stage 1', location: 'Opening Scene',
  inventory: [], relationships: {}, quests: [], timeline: []
};
const game = { id: 'acceptance-roots', title: 'Roots regression', genre: 'Cultivation', playerName: 'Acceptance Player', setting: 'Opening Scene', premise: 'A wanderer wants to discover their origins.' };
const recent = [];

async function request(path, body, raw = false) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch {}
  return { status: response.status, type: response.headers.get('content-type'), text, data };
}
function check(name, fn) {
  try { fn(); report.checks.push({ name, status: 'PASS' }); }
  catch (error) { report.checks.push({ name, status: 'FAIL', error: error.message }); }
}
function applyResult(out, previous) {
  if (out.state && typeof out.state === 'object') return structuredClone(out.state);
  const next = structuredClone(previous);
  for (const change of out.stateChanges || []) {
    if (change.type === 'stat') {
      const path = String(change.key).split('.');
      if (path.some(x => ['__proto__', 'prototype', 'constructor'].includes(x))) continue;
      const key = path.pop();
      const target = path.reduce((o, k) => o?.[k], next);
      if (target && typeof change.value === 'number') target[key] = change.op === 'set' ? change.value : (target[key] || 0) + change.value;
    }
  }
  for (const key of ['hp', 'qi']) next[key].current = Math.max(0, Math.min(next[key].max, next[key].current));
  return next;
}

try {
  if (!external) {
    child = spawn(process.execPath, ['launcher.js'], {
      env: { ...process.env, PORT: '3183', OPENROUTER_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { serverOutput += chunk; });
    child.stderr.on('data', chunk => { serverOutput += chunk; });
    for (let i = 0; i < 100 && !serverOutput.includes('live on'); i++) {
      if (child.exitCode !== null) throw new Error(`Server exited: ${serverOutput}`);
      await delay(50);
    }
    if (!serverOutput.includes('live on')) throw new Error('Server startup timed out.');
  }
  const home = await request('/');
  check('GET / serves the game, without a login redirect', () => {
    assert.equal(home.status, 200);
    assert.match(home.type || '', /text\/html/);
    assert.match(home.text, /<title>Infinite Realms Max<\/title>/);
  });
  if (report.checks.at(-1).status !== 'PASS') throw new Error('Homepage gate failed; API tests were not attempted.');
  check('Rendered inline browser JavaScript parses', () => {
    const scripts = [...home.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];
    assert.ok(scripts.length > 0, 'No inline scripts found; adapt this check for external script files.');
    for (const [i, s] of scripts.entries()) new Script(s[1], { filename: `http-home-inline-${i + 1}.js` });
  });
  const health = await request('/api/health');
  report.health = health.data;
  check('GET /api/health returns healthy JSON', () => { assert.equal(health.status, 200); assert.equal(health.data?.ok, true); });
  if (external && !['demo', 'adaptive-fallback', 'fallback', 'builtin', 'built-in'].includes(health.data?.ai)) {
    throw new Error('External AI may be enabled. Public story/load tests are blocked until a verified free test configuration is provided.');
  }

  const sequence = [
    ['Try to find out what your roots are', 'ACTION'],
    ['What do you recommend I should do', 'ADVICE'],
    ['Find out what your roots are', 'ACTION'],
    ['Story direction: What do I do next then?', 'META'],
    ['I’m confused on what I should be doing', 'HELP'],
    ['H', 'UNCLEAR'],
    ['Cultivate', 'ACTION'],
    ['Show me my stats', 'STATS']
  ];
  for (const [message, expectedIntent] of sequence) {
    const before = structuredClone(state);
    const r = await request('/api/story', { message, game, state, recent: recent.slice(-16), memories: [] });
    const out = r.data || {};
    state = applyResult(out, state);
    const row = { message, expectedIntent, status: r.status, response: out, before, after: structuredClone(state) };
    report.conversation.push(row);
    recent.push({ who: 'player', text: message }, { who: 'gm', text: out.narration || '' });
    check(`Story request returns narration: ${message}`, () => { assert.equal(r.status, 200); assert.ok(out.narration); });
    if (['ADVICE', 'META', 'HELP', 'UNCLEAR', 'STATS'].includes(expectedIntent)) {
      check(`Does not narrate the request as an action: ${message}`, () => {
        assert.doesNotMatch(out.narration || '', /\bacts at\b|The situation has changed|A small detail changes the situation/);
        assert.deepEqual(state, before, 'Non-action changed structured state.');
        assert.equal((out.memories || []).filter(m => /chose to|decided to/.test(m.text || '')).length, 0, 'Non-action was saved as an in-world decision.');
      });
    }
    if (message === 'Cultivate') check('Cultivation increases actual Qi and XP', () => {
      assert.ok(state.qi.current > before.qi.current, 'Qi did not increase.');
      assert.ok(state.xp > before.xp, 'XP did not increase.');
    });
    if (expectedIntent === 'STATS') check('Stats response shows the current HP, Qi and XP', () => {
      const n = out.narration || '';
      assert.match(n, new RegExp(`HP[^\\d]*${state.hp.current}`, 'i'));
      assert.match(n, new RegExp(`Qi[^\\d]*${state.qi.current}`, 'i'));
      assert.match(n, new RegExp(`XP[^\\d]*${state.xp}`, 'i'));
    });
  }
  check('Only the three in-world actions advance turns', () => { assert.equal(state.turn, 3); });

  const dice = await request('/api/roll', { expression: '2d6+3' });
  check('Dice have valid bounds and arithmetic', () => {
    assert.equal(dice.status, 200);
    assert.equal(dice.data.rolls.length, 2);
    assert.ok(dice.data.rolls.every(x => Number.isInteger(x) && x >= 1 && x <= 6));
    assert.equal(dice.data.total, dice.data.rolls.reduce((a, b) => a + b, 0) + 3);
  });
  for (const expression of ['0d6', '1d1', '51d6', '1d0', 'abc']) {
    const r = await request('/api/roll', { expression });
    check(`Invalid dice rejected with 400: ${expression}`, () => { assert.equal(r.status, 400); });
  }
  for (const [label, body, raw] of [
    ['broken JSON', '{', true], ['null body', 'null', true], ['array body', '[]', true],
    ['empty message', { message: '' }], ['object message', { message: {} }],
    ['overlong message', { message: 'x'.repeat(2501) }]
  ]) {
    const r = await request('/api/story', body, raw);
    check(`Malformed request rejected with 400: ${label}`, () => { assert.equal(r.status, 400); assert.ok(r.data?.error); });
  }
  let longSessionOK = true;
  const history = [];
  for (let i = 0; i < 100; i++) {
    const r = await request('/api/story', { message: 'Cultivate', game, state, recent: history.slice(-16), memories: [] });
    if (r.status !== 200 || !r.data?.narration) { longSessionOK = false; break; }
    state = applyResult(r.data, state);
    history.push({ who: 'player', text: 'Cultivate' }, { who: 'gm', text: r.data.narration });
  }
  check('100 sequential requests stay responsive with valid stat bounds', () => {
    assert.ok(longSessionOK);
    assert.ok(Number.isFinite(state.qi.current) && state.qi.current >= 0 && state.qi.current <= state.qi.max);
  });
  const simultaneous = await Promise.all(Array.from({ length: 12 }, (_, i) => request('/api/story', {
    message: 'Cultivate', game: { ...game, id: `isolated-${i}`, playerName: `IsolationPlayer${i}` }, state, recent: [], memories: []
  })));
  check('12 concurrent independent requests return without mixing player names', () => {
    for (const [i, r] of simultaneous.entries()) {
      assert.equal(r.status, 200);
      assert.match(r.data.narration, new RegExp(`IsolationPlayer${i}\\b`));
    }
  });
  report.limits = [
    'API responsiveness does not establish same-save concurrency safety, replay protection or persistence.',
    'Clue substance, NPC continuity, fixed mystery truth and encrypted GM saves require review of the actual v0.9 implementation.',
    'This script does not substitute for desktop/mobile browser interaction, console and network inspection.'
  ];
} catch (error) {
  report.checks.push({ name: 'Suite execution', status: 'FAIL', error: error.message });
} finally {
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  report.summary = { passed: report.checks.filter(c => c.status === 'PASS').length, failed: report.checks.filter(c => c.status === 'FAIL').length };
  const path = external ? 'acceptance-public.json' : 'acceptance-local.json';
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report.summary, report: path, health: report.health, failures: report.checks.filter(c => c.status === 'FAIL') }, null, 2));
  process.exitCode = report.summary.failed ? 1 : 0;
}
