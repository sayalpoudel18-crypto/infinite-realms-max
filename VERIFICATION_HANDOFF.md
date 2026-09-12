# Infinite Realms Max: Vercel acceptance handoff

Checked on 2026-09-12. **Not ready for production promotion.**

## Source identity

- Existing repository: `sayalpoudel18-crypto/infinite-realms-max`.
- Recovered `main` commit: `0facc4bdbcf17a1afbc4b481cf7cce0ced8dbc0e`.
- Repair branch: `repair/launch-and-acceptance-20260912`.
- `package.json` reports 0.4.2 and starts `launcher.js`, which loads the
  embedded UI/server from `server.js`. That server reports 0.5-live.
- `hardened.js` contains a separate 0.6.0 runtime. It is not started by the
  current package script. All other existing remote branches have 0.4.0 packages.
- The v0.9 Adaptive build described in the earlier chat has not been recovered.
  These files are NOT established as the current Vercel deployment's source.
  Do not overwrite that deployment with this older recovery branch.

## Public production result

The requested alias is `https://infinite-realms-max-game1-28c0.vercel.app/`.
An unauthenticated Chrome navigation redirected to Vercel login. A separate
HTTP request confirmed a 302 to Vercel SSO, followed by the Vercel login page.
The eventual HTTP 200 was login HTML, not the game. No game browser acceptance
test passed on this URL.

The Vercel connection returned an empty team list. Fetching the protected
deployment through the connection failed with `403 Forbidden`. No deployment
source, exact deployment ID, project ID or owning team was available. No
preview was deployed and no production alias was changed.

## Applied recovery fix

`npm start` originally crashed with:

```
Error: Could not locate embedded HTML block in server.js
```

The launcher expected an uppercase `MANIFEST` immediately after the template,
but the current server uses lowercase `manifest` separated by a blank line.
The launcher now locates the closing HTML boundary and keeps its literal
contents intact, including browser JavaScript backticks and escapes. It parses
the extracted browser scripts before startup, then compiles server code with
normal CommonJS bindings instead of a bare VM context.

## Verification performed on the recovery branch

Run `node verify-runtime.mjs` from the project directory. It starts the existing
launcher in the same process environment, explicitly clears the OpenRouter key,
tests HTTP endpoints, and shuts down its child server. No external AI calls occur.
Detailed synthetic results are in `acceptance-local.json`.

| Check | Result |
| --- | --- |
| Package launcher starts | Pass after repair |
| GET / serves Infinite Realms HTML | Pass |
| Actual rendered inline browser JavaScript parses | Pass |
| GET /api/health | Pass, reports 0.5-live/demo |
| Eight exact regression messages return HTTP 200 | Pass for transport only |
| Roots investigation gives concrete clues | Fail on manual response review: generic narration |
| Advice, story direction, confusion, H and stats interpreted appropriately | Fail: narrated as character actions |
| Cultivate changes Qi and XP | Partial: Qi increases, XP does not |
| Show stats displays actual HP, Qi and XP | Fail |
| Only the three real actions advance turns | Fail: this runtime has no turn progression |
| Valid dice bounds/arithmetic | Pass |
| Invalid dice return 400 | Fail: silent clamping or 500 |
| Malformed story input returns 400 | Fail: 500 or accepted invalid input |
| 100 sequential requests | Pass for responsiveness; not a persistence guarantee |
| 12 concurrent independent requests | Pass for response/player-name isolation |
| Same-save concurrent commits, retries and replay protection | Not verified |
| Fixed mystery truth and encrypted GM saves | Not verified; no such implementation recovered |
| Recent history sent | Existing browser sends recent turns; fallback does not use them |
| Tappable suggestions, desktop/mobile game UI, console/network checks | Not verified |

The automated suite reports **14 passed / 19 failed**. The investigation finding
is an additional manual review finding, not counted in those automated totals.

The remote browser cannot open this environment's local loopback URL
(`ERR_BLOCKED_BY_CLIENT`). Public Chrome testing succeeded only in establishing
the Vercel login redirect. Do not describe this as successful visual game QA.

## Resume without losing work

1. Restore Vercel access to the account/team owning this exact project, and
   identify the exact deployment and source commit or uploaded source bundle.
2. Recover the corrected v0.9 source from the previous chat/artifact/deployment.
   Reconcile this small launcher fix with that source; preserve later work.
3. Adapt the HTTP checks to the actual state/turn response contract and fix all
   remaining acceptance failures, including meaningful clues, history, canonical
   state, fixed mystery truth, GM encryption, malformed bodies and concurrency.
4. Deploy only a preview of the corrected source. Make sure the approved test
   URL is accessible to an outside player. Do not count an authenticated
   dashboard or login page as a public-game pass.
5. Run the suite against that URL and interact in desktop and mobile viewports.
   Check console errors, request failures, save/resume and all eight messages.
6. Promote only after the required checks pass, then repeat them on production.

The suite can accept a URL (`node verify-runtime.mjs https://...`), but that
mode sends story requests only when health identifies a built-in fallback.
It refuses external AI configurations by default. A future provider-enabled
test must verify zero-cost routing before changing that guard. Never run this
load against a paid provider or production player save.

## Additional AI request

The user requested additional AI services and supplied a comparison article.
The available connection search returned Vercel, but no callable Claude,
Gemini or OpenRouter connection. None of those services was used or newly
connected, and no paid service was enabled. The source has an OpenRouter path,
but no provider credential was configured in this local test environment.
Provider names in a comparison article are not connected accounts. Any future
provider integration must verify current zero-cost eligibility, reject paid
fallbacks, and keep credentials server-side. Do not require additional AI
connections to fix deterministic launcher, intent or state bugs.
