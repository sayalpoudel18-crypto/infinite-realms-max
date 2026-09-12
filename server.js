const http = require('http');
const { randomInt, randomUUID } = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const FREE_MODEL = process.env.FREE_MODEL || 'openrouter/free';
const SITE_NAME = 'Infinite Realms Max';

function send(res, status, body, type='application/json; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': type.startsWith('text/html') ? 'no-store' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',c=>{ raw+=c; if(raw.length>500000) req.destroy(); });
    req.on('end',()=>{ try{ resolve(raw?JSON.parse(raw):{}); }catch(e){ reject(e); } });
    req.on('error',reject);
  });
}
function clamp(n,a,b){ n=Number(n); return Number.isFinite(n)?Math.min(b,Math.max(a,n)):a; }
function safeText(v,max=5000){ return String(v??'').slice(0,max); }

function parseDice(expr){
  const m=String(expr||'').trim().match(/^(\d{0,2})d(\d{1,4})([+-]\d{1,5})?$/i);
  if(!m) throw new Error('Use dice like 1d20, 2d6+3, or 1d100');
  const count=clamp(m[1]||1,1,50), sides=clamp(m[2],2,10000), mod=clamp(m[3]||0,-99999,99999);
  const rolls=Array.from({length:count},()=>randomInt(1,sides+1));
  const subtotal=rolls.reduce((a,b)=>a+b,0);
  return { expression:`${count}d${sides}${mod?mod>0?'+'+mod:String(mod):''}`, rolls, modifier:mod, subtotal, total:subtotal+mod };
}

async function openRouter(messages, maxTokens=1100, temperature=0.85){
  if(!OPENROUTER_API_KEY) throw new Error('No OpenRouter key');
  const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),45000);
  try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST', signal:ctrl.signal,
      headers:{'authorization':`Bearer ${OPENROUTER_API_KEY}`,'content-type':'application/json','HTTP-Referer':process.env.SITE_URL||'https://railway.app','X-Title':SITE_NAME},
      body:JSON.stringify({model:FREE_MODEL,messages,max_tokens:maxTokens,temperature})
    });
    if(!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0,300)}`);
    const j=await r.json();
    const c=j?.choices?.[0]?.message?.content;
    if(!c) throw new Error('Empty AI response');
    return typeof c==='string'?c:JSON.stringify(c);
  } finally { clearTimeout(timer); }
}

function demoNarration(msg, game, state){
  const name=safeText(game?.playerName||'Traveler',40);
  const location=safeText(state?.location||game?.setting||'the frontier',80);
  const action=safeText(msg,900);
  const low=action.toLowerCase();
  let consequence='The world reacts instead of waiting for you. Nearby people exchange guarded looks, and a new complication takes shape just beyond your immediate view.';
  let changes=[];
  if(/fight|attack|strike|duel|punch|slash|battle/.test(low)){
    const dmg=randomInt(2,9); consequence=`Your move forces an immediate clash. You gain ground, but not cleanly; the opposition answers with enough force to make the risk feel real.`;
    changes.push({type:'stat',key:'hp.current',op:'inc',value:-dmg});
  } else if(/search|look|investigate|inspect|explore/.test(low)) {
    consequence='Careful attention pays off. You notice a detail that was easy to miss before: someone has deliberately altered the scene, leaving a clue that points toward a larger problem.';
  } else if(/talk|say|ask|tell|convince|negotiate/.test(low)) {
    consequence='The response is measured rather than automatic. Your words change the mood, but the other person clearly has goals of their own and does not simply agree.';
  } else if(/train|cultivate|meditate|practice/.test(low)) {
    const qi=randomInt(2,8); consequence='The training produces a real but limited gain. Progress comes with strain, revealing a bottleneck you will eventually have to solve rather than skip.';
    changes.push({type:'stat',key:'qi.current',op:'inc',value:qi});
  }
  return {
    narration:`${name} acts at ${location}: **${action}**\n\n${consequence}\n\nA small detail changes the situation: there is now a choice between pressing the advantage, gathering more information, or backing away before the consequences deepen. What do you do?`,
    stateChanges:changes,
    memories:[{text:`${name} chose to ${action.slice(0,160)} at ${location}.`,importance:55}],
    provider:'demo'
  };
}

function sanitizeResult(obj){
  const out={narration:safeText(obj?.narration||'',9000),stateChanges:[],memories:[],provider:obj?.provider||'ai'};
  if(!out.narration) out.narration='The scene shifts, but the narrator returned no usable text. Try another action.';
  const allowedStats=new Set(['hp.current','hp.max','qi.current','qi.max','gold','xp']);
  for(const c of Array.isArray(obj?.stateChanges)?obj.stateChanges:[]){
    if(c?.type==='stat' && allowedStats.has(c.key) && ['inc','set'].includes(c.op)) out.stateChanges.push({type:'stat',key:c.key,op:c.op,value:clamp(c.value,-1000000,1000000)});
    if(c?.type==='inventory_add') out.stateChanges.push({type:'inventory_add',item:safeText(c.item,100),qty:clamp(c.qty||1,1,999)});
    if(c?.type==='inventory_remove') out.stateChanges.push({type:'inventory_remove',item:safeText(c.item,100),qty:clamp(c.qty||1,1,999)});
    if(c?.type==='relationship') out.stateChanges.push({type:'relationship',entity:safeText(c.entity,80),op:['inc','set'].includes(c.op)?c.op:'inc',value:clamp(c.value,-100,100)});
    if(c?.type==='quest_add') out.stateChanges.push({type:'quest_add',title:safeText(c.title,120),description:safeText(c.description,500)});
    if(c?.type==='quest_status') out.stateChanges.push({type:'quest_status',title:safeText(c.title,120),status:['active','completed','failed'].includes(c.status)?c.status:'active'});
  }
  for(const m of Array.isArray(obj?.memories)?obj.memories:[]){ const text=safeText(m?.text||m,700).trim(); if(text) out.memories.push({text,importance:clamp(m?.importance||50,0,100)}); }
  return out;
}

function extractJson(text){
  try{return JSON.parse(text)}catch{}
  const a=text.indexOf('{'), b=text.lastIndexOf('}');
  if(a>=0&&b>a){ try{return JSON.parse(text.slice(a,b+1))}catch{} }
  return null;
}

async function story(body){
  const message=safeText(body?.message,2500).trim();
  if(!message) throw new Error('Enter an action first.');
  const game=body?.game||{}, state=body?.state||{}, memories=(body?.memories||[]).slice(-40), recent=(body?.recent||[]).slice(-12);
  if(!OPENROUTER_API_KEY) return demoNarration(message,game,state);
  try{
    const planner=await openRouter([
      {role:'system',content:'You are the planning member of an AI RPG council. Create a concise private scene plan. Protect player agency, honor established facts, create consequences, avoid easy wins, and end with meaningful options.'},
      {role:'user',content:JSON.stringify({game:{title:game.title,genre:game.genre,premise:game.premise,rules:game.rules,cards:game.cards},state,memories,recent,playerAction:message})}
    ],450,0.45);
    const narrator=await openRouter([
      {role:'system',content:`You are the final Game Master. The human alone controls their character's voluntary actions, speech, thoughts, and decisions. You control NPCs/world/consequences. Treat supplied state as authoritative. Never secretly change numeric state in prose. Return ONLY JSON with keys narration, stateChanges, memories. stateChanges may use: {type:"stat",key:"hp.current|hp.max|qi.current|qi.max|gold|xp",op:"inc|set",value:number}; {type:"inventory_add|inventory_remove",item:string,qty:number}; {type:"relationship",entity:string,op:"inc|set",value:number}; {type:"quest_add",title:string,description:string}; {type:"quest_status",title:string,status:"active|completed|failed"}. memories is [{text,importance:0-100}]. Write vivid 3-7 paragraphs by default. No effortless victories, no repetitive summaries, no controlling the player. End at a decision point.`},
      {role:'user',content:JSON.stringify({plannerAdvice:planner,game,state,memories,recent,playerAction:message})}
    ],1500,0.88);
    const parsed=extractJson(narrator);
    if(!parsed) return {narration:narrator,stateChanges:[],memories:[],provider:`OpenRouter ${FREE_MODEL}`};
    return sanitizeResult({...parsed,provider:`OpenRouter ${FREE_MODEL}`});
  }catch(e){
    const d=demoNarration(message,game,state); d.narration += `\n\n_[Free AI temporarily unavailable; this turn used the built-in fallback.]_`; d.error=safeText(e.message,220); return d;
  }
}

const HTML = String.raw`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#090b12"><link rel="manifest" href="/manifest.webmanifest"><title>Infinite Realms Max</title><style>
:root{--bg:#080a10;--panel:#11141d;--panel2:#171b26;--line:#282e3d;--text:#eef1f8;--muted:#939caf;--a:#8b5cf6;--a2:#5eead4;--danger:#fb7185}*{box-sizing:border-box}html,body{margin:0;background:radial-gradient(circle at 30% -10%,#241640 0,#0b0d14 38%,#07090e 75%);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100%;overscroll-behavior:none}button,input,textarea,select{font:inherit}.app{min-height:100vh}.top{height:62px;position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;padding:0 18px;background:#090b12e8;backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}.brand{font-weight:850;letter-spacing:-.4px}.brand b{color:#a78bfa}.nav{margin-left:auto;display:flex;gap:7px}.btn{border:1px solid var(--line);background:#151924;color:var(--text);border-radius:10px;padding:9px 13px;cursor:pointer}.btn:hover{border-color:#4b556d}.btn.primary{background:linear-gradient(135deg,#7c3aed,#5b21b6);border-color:#8b5cf6}.btn.ghost{background:transparent}.shell{max-width:1320px;margin:auto;padding:22px}.hero{padding:32px 4px 18px}.hero h1{font-size:clamp(30px,5vw,58px);line-height:1.03;margin:0 0 12px;letter-spacing:-1.8px}.hero p{color:var(--muted);max-width:720px;font-size:17px;line-height:1.55}.filters{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.search{flex:1;min-width:220px;background:#10131b;border:1px solid var(--line);color:white;border-radius:11px;padding:11px 13px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:15px}.card{background:linear-gradient(180deg,#151925,#0f121a);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 14px 38px #0004}.cover{height:138px;background:radial-gradient(circle at 30% 20%,#7c3aed88,#182036 45%,#0d111a);display:flex;align-items:flex-end;padding:14px}.cover span{font-size:38px}.body{padding:15px}.tag{display:inline-flex;border:1px solid #4c3a75;background:#241839;color:#c4b5fd;padding:4px 8px;border-radius:999px;font-size:11px}.card h3{margin:9px 0 7px}.card p{color:var(--muted);font-size:13px;line-height:1.45;min-height:57px}.meta{display:flex;gap:12px;color:#7f899f;font-size:12px;margin:11px 0}.layout{display:grid;grid-template-columns:minmax(0,1fr) 330px;gap:16px;max-width:1400px;margin:auto;padding:14px}.story{min-height:calc(100vh - 90px);display:flex;flex-direction:column;background:#0d1018;border:1px solid var(--line);border-radius:16px;overflow:hidden}.storyhead{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}.storyhead .sub{font-size:12px;color:var(--muted)}.feed{padding:18px;flex:1;overflow:auto;max-height:calc(100vh - 235px)}.turn{padding:14px 15px;margin:0 0 13px;border-radius:13px;line-height:1.58;white-space:pre-wrap}.turn.player{background:#17132a;border:1px solid #38265b}.turn.gm{background:#121722;border:1px solid #222b3c}.who{font-size:11px;text-transform:uppercase;color:#9ca3b8;font-weight:800;letter-spacing:.8px;margin-bottom:7px}.composer{border-top:1px solid var(--line);padding:12px;background:#0b0e15}.composer textarea{width:100%;min-height:76px;max-height:180px;resize:vertical;background:#141822;border:1px solid var(--line);color:white;border-radius:12px;padding:12px}.composerbar{display:flex;gap:8px;align-items:center;margin-top:8px}.composerbar select{background:#141822;border:1px solid var(--line);color:white;border-radius:9px;padding:9px}.composerbar .send{margin-left:auto}.side{display:flex;flex-direction:column;gap:12px}.panel{background:#10131b;border:1px solid var(--line);border-radius:15px;padding:14px}.panel h3{margin:0 0 11px;font-size:14px}.kv{display:grid;grid-template-columns:1fr auto;gap:7px;font-size:13px;padding:6px 0;border-bottom:1px solid #202532}.kv:last-child{border:0}.kv span:first-child{color:var(--muted)}.bar{height:7px;background:#242938;border-radius:6px;overflow:hidden;margin-top:5px}.fill{height:100%;background:linear-gradient(90deg,#8b5cf6,#5eead4)}.pill{display:inline-flex;margin:3px 3px 0 0;padding:5px 7px;background:#171c27;border:1px solid #293043;border-radius:8px;font-size:12px}.modal{position:fixed;inset:0;z-index:50;background:#05070bbd;display:none;align-items:center;justify-content:center;padding:18px}.modal.on{display:flex}.dialog{width:min(760px,100%);max-height:90vh;overflow:auto;background:#11151e;border:1px solid #343b4d;border-radius:18px;padding:20px}.dialog h2{margin-top:0}.field{margin:13px 0}.field label{display:block;color:#aab2c3;font-size:12px;margin-bottom:6px}.field input,.field textarea,.field select{width:100%;background:#0b0e15;border:1px solid var(--line);color:white;padding:10px;border-radius:10px}.field textarea{min-height:95px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.mem{border:1px solid var(--line);padding:10px;border-radius:10px;margin:8px 0}.mem small{color:#8e98ac}.empty{color:var(--muted);text-align:center;padding:30px}.status{font-size:12px;color:#8fa0bb}.good{color:#5eead4}.warn{color:#fbbf24}@media(max-width:900px){.layout{grid-template-columns:1fr;padding:7px}.side{display:grid;grid-template-columns:1fr 1fr}.feed{max-height:none;min-height:55vh}.top{padding:0 10px}.nav .hideM{display:none}}@media(max-width:600px){.shell{padding:14px}.hero{padding-top:18px}.side{grid-template-columns:1fr}.row{grid-template-columns:1fr}.btn{padding:9px 10px}.brand{font-size:14px}.story{border-radius:12px}.layout{padding-bottom:max(8px,env(safe-area-inset-bottom))}}
</style></head><body><div class="app"><header class="top"><div class="brand">∞ <b>Infinite Realms</b> Max</div><div id="aiStatus" class="status"></div><nav class="nav"><button class="btn ghost hideM" onclick="home()">Discover</button><button class="btn ghost" onclick="showMemory()">Memory</button><button class="btn primary" onclick="openCreator()">+ Create</button></nav></header><main id="view"></main></div><div class="modal" id="modal"><div class="dialog" id="dialog"></div></div><script>
const STORE='irmax-save-v1';
const samples=[
{id:'hollow-star',title:'Path of the Hollow Star',genre:'Cultivation',icon:'⚔️',desc:'A ruthless cultivation sandbox where sect politics, breakthroughs, rivals, artifacts and consequences persist.',plays:18420,rating:4.8,premise:'You are an Outer Sect disciple of Azure Sect. During your spirit-root examination, the ancient testing pillar goes completely dark.',playerName:'Sayal',role:'Outer Sect Disciple',setting:'Azure Sect — Testing Plaza',tone:'Cinematic progression fantasy with danger, strategy, earned power and persistent consequences.',rules:'Never control the player. Power must be earned. Rivals remember humiliation. Breakthroughs require conditions. The world continues without the player.',cards:[['World','A vast cultivation world of sects, dynasties, forbidden zones, spirit beasts and ancient inheritances.'],['Progression','Cultivation is earned through resources, insight, training and dangerous breakthroughs. No free realm jumps.'],['Combat','Outcomes respect cultivation gap, technique quality, preparation, injuries and real dice when rolled.'],['AI Instructions','Treat state and memory as canon. NPCs pursue their own goals. Reuse established characters and consequences.']]},
{id:'neon-noir',title:'Neon City Detective',genre:'Detective',icon:'🕵️',desc:'Solve a conspiracy in a rain-soaked megacity where witnesses lie and evidence persists.',plays:9230,rating:4.7,premise:'A famous synthetic-memory designer is found dead inside a locked penthouse.',playerName:'Alex',role:'Independent Investigator',setting:'Meridian City',tone:'Noir, grounded mystery, clever clues, morally gray characters.',rules:'Mysteries must have coherent solutions. Clues cannot retroactively change merely to defeat the player.',cards:[['Mystery','The core case has an internally consistent culprit, motive and evidence trail.'],['NPCs','Witnesses can lie, omit facts, panic or pursue conflicting agendas.']]},
{id:'afterfall',title:'Afterfall Survival',genre:'Survival',icon:'☣️',desc:'Build alliances, scavenge, manage injuries and survive a collapsing region.',plays:12050,rating:4.6,premise:'The emergency broadcasts stopped three days ago. Your shelter has food for four more nights.',playerName:'Morgan',role:'Survivor',setting:'Abandoned Lakeside District',tone:'Tense grounded survival with scarce resources.',rules:'Resources matter. Injuries matter. Do not invent convenient supplies.',cards:[['Survival','Food, water, medicine, shelter and trust are meaningful constraints.']]},
{id:'starbound',title:'Starbound Exile',genre:'Sci-Fi',icon:'🚀',desc:'Command a damaged ship beyond mapped space while your crew questions your past.',plays:7680,rating:4.7,premise:'Your ship wakes you early from cryosleep after receiving a signal from a star that should not exist.',playerName:'Rin',role:'Acting Captain',setting:'Uncharted Helios Reach',tone:'Epic hard-ish science fiction with mystery and crew drama.',rules:'Technology follows established limits. Crew members have persistent relationships.',cards:[['Ship','The vessel has finite fuel, damage, supplies and modules.'],['Crew','Crew relationships and competence affect outcomes.']]}
];
function baseState(g){return {location:g.setting||'Unknown',realm:g.genre==='Cultivation'?'Body Tempering — Stage 1':'Level 1',hp:{current:100,max:100},qi:{current:g.genre==='Cultivation'?80:20,max:100},gold:45,xp:0,inventory:g.genre==='Cultivation'?[{name:'Outer Sect Token',qty:1},{name:'Low-grade Spirit Stone',qty:3}]:[{name:'Field Kit',qty:1}],quests:[{title:'Follow the first lead',description:'Discover what the opening event means.',status:'active'}],relationships:{}}}
function getData(){try{return JSON.parse(localStorage.getItem(STORE))||{games:[],runs:{}}}catch{return {games:[],runs:{}}}}
function putData(d){localStorage.setItem(STORE,JSON.stringify(d))}
let db=getData(), current=null;
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');return j}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function fmt(s){return esc(s).replace(/\*\*(.*?)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>')}
async function boot(){try{const h=await api('/api/health');document.querySelector('#aiStatus').innerHTML=h.ai==='openrouter'?'<span class="good">● Free AI connected</span>':'<span class="warn">● Demo AI</span>'}catch{}home();if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{})}
function allGames(){return [...samples,...db.games]}
function home(){current=null;document.querySelector('#view').innerHTML=`<div class="shell"><section class="hero"><span class="tag">AI INTERACTIVE WORLDS</span><h1>Choose a world.<br>Change everything.</h1><p>Free-form AI adventures with persistent state, editable campaign cards, long-term memory, real server-side dice and branching local saves.</p></section><div class="filters"><input id="q" class="search" placeholder="Search games, worlds, genres…" oninput="renderGames()"><select id="genre" class="btn" onchange="renderGames()"><option>All genres</option>${[...new Set(allGames().map(g=>g.genre))].map(x=>`<option>${esc(x)}</option>`).join('')}</select></div><div id="games" class="grid"></div></div>`;renderGames()}
function renderGames(){const q=(document.querySelector('#q')?.value||'').toLowerCase(),ge=document.querySelector('#genre')?.value||'All genres';const list=allGames().filter(g=>(ge==='All genres'||g.genre===ge)&&(!q||JSON.stringify(g).toLowerCase().includes(q)));document.querySelector('#games').innerHTML=list.map(g=>`<article class="card"><div class="cover"><span>${g.icon||'✨'}</span></div><div class="body"><span class="tag">${esc(g.genre)}</span><h3>${esc(g.title)}</h3><p>${esc(g.desc||g.premise)}</p><div class="meta"><span>▶ ${(g.plays||0).toLocaleString()}</span><span>★ ${g.rating||'New'}</span></div><button class="btn primary" style="width:100%" onclick="play('${g.id}')">Play</button></div></article>`).join('')||'<div class="empty">No worlds found.</div>'}
function findGame(id){return allGames().find(g=>g.id===id)}
function play(id){const g=findGame(id);if(!g)return;let run=db.runs[id];if(!run){run={state:baseState(g),turns:[{who:'gm',text:g.premise+'\n\nWhat do you do?'}],memories:[],checkpoints:[]};db.runs[id]=run;putData(db)}current={g,run};renderPlay()}
function renderPlay(){const {g,run}=current,s=run.state;const hp=Math.max(0,Math.min(100,(s.hp.current/s.hp.max)*100)),qi=Math.max(0,Math.min(100,(s.qi.current/s.qi.max)*100));document.querySelector('#view').innerHTML=`<div class="layout"><section class="story"><div class="storyhead"><button class="btn ghost" onclick="home()">←</button><div><b>${esc(g.title)}</b><div class="sub">${esc(g.genre)} · ${esc(s.location)}</div></div><button class="btn ghost" style="margin-left:auto" onclick="showCards()">Cards</button></div><div class="feed" id="feed">${run.turns.map(t=>`<div class="turn ${t.who==='player'?'player':'gm'}"><div class="who">${t.who==='player'?'You':'Game Master'}</div>${fmt(t.text)}</div>`).join('')}</div><div class="composer"><textarea id="msg" placeholder="What do you do? You can type anything…"></textarea><div class="composerbar"><select id="mode"><option>Do</option><option>Say</option><option>Story</option></select><button class="btn" onclick="roll()">🎲 Roll</button><button class="btn" onclick="checkpoint()">◇ Save point</button><button id="send" class="btn primary send" onclick="sendTurn()">Send</button></div></div></section><aside class="side"><div class="panel"><h3>${esc(g.playerName||'Character')}</h3><div class="kv"><span>Role</span><b>${esc(g.role||'Adventurer')}</b></div><div class="kv"><span>Realm / Level</span><b>${esc(s.realm)}</b></div><div class="kv"><span>HP</span><b>${s.hp.current}/${s.hp.max}</b></div><div class="bar"><div class="fill" style="width:${hp}%"></div></div><div class="kv"><span>Qi / Energy</span><b>${s.qi.current}/${s.qi.max}</b></div><div class="bar"><div class="fill" style="width:${qi}%"></div></div><div class="kv"><span>Gold</span><b>${s.gold}</b></div><div class="kv"><span>XP</span><b>${s.xp}</b></div></div><div class="panel"><h3>Inventory</h3>${s.inventory.length?s.inventory.map(i=>`<span class="pill">${esc(i.name)} ×${i.qty}</span>`).join(''):'<span class="status">Empty</span>'}</div><div class="panel"><h3>Quests</h3>${s.quests.map(q=>`<div class="mem"><b>${esc(q.title)}</b><br><small>${esc(q.status)}</small></div>`).join('')}</div><div class="panel"><h3>Long-term memory</h3><div class="kv"><span>Facts remembered</span><b>${run.memories.length}</b></div><button class="btn" style="width:100%;margin-top:8px" onclick="showMemory()">Inspect memory</button></div></aside></div>`;setTimeout(()=>{const f=document.querySelector('#feed');f.scrollTop=f.scrollHeight;document.querySelector('#msg')?.focus()},0)}
function setBy(obj,path,val){const p=path.split('.');let x=obj;for(let i=0;i<p.length-1;i++)x=x[p[i]];x[p.at(-1)]=val}
function getBy(obj,path){return path.split('.').reduce((x,k)=>x?.[k],obj)}
function apply(changes){const s=current.run.state;for(const c of changes||[]){if(c.type==='stat'){const old=Number(getBy(s,c.key)||0);setBy(s,c.key,c.op==='set'?c.value:old+c.value);if(c.key==='hp.current')s.hp.current=Math.max(0,Math.min(s.hp.max,s.hp.current));if(c.key==='qi.current')s.qi.current=Math.max(0,Math.min(s.qi.max,s.qi.current))}if(c.type==='inventory_add'){const x=s.inventory.find(i=>i.name.toLowerCase()===c.item.toLowerCase());x?x.qty+=c.qty:s.inventory.push({name:c.item,qty:c.qty})}if(c.type==='inventory_remove'){const x=s.inventory.find(i=>i.name.toLowerCase()===c.item.toLowerCase());if(x)x.qty-=c.qty;s.inventory=s.inventory.filter(i=>i.qty>0)}if(c.type==='relationship'){const old=s.relationships[c.entity]||0;s.relationships[c.entity]=c.op==='set'?c.value:old+c.value}if(c.type==='quest_add'&&!s.quests.some(q=>q.title===c.title))s.quests.push({title:c.title,description:c.description,status:'active'});if(c.type==='quest_status'){const q=s.quests.find(q=>q.title===c.title);if(q)q.status=c.status}}}
async function sendTurn(){const el=document.querySelector('#msg'),b=document.querySelector('#send');const raw=el.value.trim();if(!raw)return;const mode=document.querySelector('#mode').value;const message=mode==='Say'?`I say: "${raw}"`:mode==='Story'?`Story direction: ${raw}`:raw;current.run.turns.push({who:'player',text:message});el.value='';b.disabled=true;b.textContent='Thinking…';renderPlay();try{const out=await api('/api/story',{message,game:current.g,state:current.run.state,memories:current.run.memories,recent:current.run.turns.slice(-12)});current.run.turns.push({who:'gm',text:out.narration});apply(out.stateChanges);for(const m of out.memories||[]){if(!current.run.memories.some(x=>x.text===m.text))current.run.memories.push({...m,id:crypto.randomUUID?.()||String(Date.now())})}current.run.memories=current.run.memories.slice(-150);db.runs[current.g.id]=current.run;putData(db)}catch(e){current.run.turns.push({who:'gm',text:'The narrator hit an error: '+e.message})}renderPlay()}
async function roll(){const e=prompt('Dice expression','1d20');if(!e)return;try{const r=await api('/api/roll',{expression:e});alert(`${r.expression}\nRolls: ${r.rolls.join(', ')}\nTotal: ${r.total}`)}catch(x){alert(x.message)}}
function checkpoint(){const label=prompt('Name this checkpoint','Checkpoint '+(current.run.checkpoints.length+1));if(!label)return;current.run.checkpoints.push({label,at:Date.now(),state:structuredClone(current.run.state),turns:structuredClone(current.run.turns),memories:structuredClone(current.run.memories)});putData(db);alert('Checkpoint saved locally on this iPhone/browser.')}
function showCards(){const g=current.g;modal(`<h2>Campaign Cards</h2><p class="status">These are the world facts/instructions the Game Master receives.</p>${(g.cards||[]).map((c,i)=>`<div class="mem"><b>${esc(c[0])}</b><p>${esc(c[1])}</p></div>`).join('')}<div class="mem"><b>Creator Instructions</b><p>${esc(g.rules||'')}</p></div><button class="btn" onclick="closeModal()">Close</button>`)}
function showMemory(){if(!current){modal('<h2>Memory</h2><p class="status">Open a game first to inspect its long-term memory.</p><button class="btn" onclick="closeModal()">Close</button>');return}const m=current.run.memories;modal(`<h2>Memory Inspector</h2><p class="status">You can correct the AI instead of being stuck with a bad memory.</p><div id="ml">${m.length?m.map((x,i)=>`<div class="mem"><small>Importance ${x.importance||50}</small><div>${esc(x.text)}</div><button class="btn ghost" onclick="editMem(${i})">Edit</button><button class="btn ghost" onclick="delMem(${i})">Delete</button></div>`).join(''):'<div class="empty">No durable memories yet.</div>'}</div><button class="btn primary" onclick="addMem()">+ Add memory</button> <button class="btn" onclick="closeModal()">Done</button>`)}
function editMem(i){const x=current.run.memories[i],v=prompt('Edit memory',x.text);if(v!==null){x.text=v.trim();putData(db);showMemory()}}function delMem(i){current.run.memories.splice(i,1);putData(db);showMemory()}function addMem(){const v=prompt('Permanent fact to remember');if(v){current.run.memories.push({id:String(Date.now()),text:v,importance:90});putData(db);showMemory()}}
function openCreator(){modal(`<h2>Create an Adventure</h2><div class="row"><div class="field"><label>Title</label><input id="ct" value="My New Realm"></div><div class="field"><label>Genre</label><select id="cg"><option>Cultivation</option><option>Fantasy</option><option>Sci-Fi</option><option>Horror</option><option>Detective</option><option>Survival</option><option>Isekai</option><option>Tycoon</option><option>Cozy</option><option>Sandbox</option></select></div></div><div class="field"><label>Premise / opening situation</label><textarea id="cp">I wake in a world where power has a price, and someone already knows my name.</textarea></div><div class="row"><div class="field"><label>Character name</label><input id="cn" value="Sayal"></div><div class="field"><label>Role</label><input id="cr" value="Unknown Wanderer"></div></div><div class="field"><label>Tone / writing style</label><input id="co" value="Immersive, cinematic, character-driven, dangerous"></div><div class="field"><label>Creator Instructions</label><textarea id="ci">Never control my decisions. Remember consequences. Make victories earned. NPCs have independent motives. Keep progression internally consistent.</textarea></div><button class="btn primary" onclick="createGame()">Create & Play</button> <button class="btn" onclick="closeModal()">Cancel</button>`)}
function createGame(){const g={id:'custom-'+Date.now(),title:document.querySelector('#ct').value||'Untitled Realm',genre:document.querySelector('#cg').value,icon:'✨',desc:'A custom AI adventure.',premise:document.querySelector('#cp').value,playerName:document.querySelector('#cn').value,role:document.querySelector('#cr').value,setting:'Opening Scene',tone:document.querySelector('#co').value,rules:document.querySelector('#ci').value,cards:[['Game Overview',document.querySelector('#cp').value],['Player',`${document.querySelector('#cn').value} — ${document.querySelector('#cr').value}`],['AI Instructions',document.querySelector('#ci').value]],plays:0,rating:null};db.games.push(g);putData(db);closeModal();play(g.id)}
function modal(html){document.querySelector('#dialog').innerHTML=html;document.querySelector('#modal').classList.add('on')}function closeModal(){document.querySelector('#modal').classList.remove('on')}
boot();
</script></body></html>`;

const manifest=JSON.stringify({name:SITE_NAME,short_name:'Infinite Realms',start_url:'/',display:'standalone',background_color:'#080a10',theme_color:'#090b12',icons:[]});
const sw=`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{});`;

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='GET'&&url.pathname==='/api/health') return send(res,200,{ok:true,app:SITE_NAME,version:'0.5-live',ai:OPENROUTER_API_KEY?'openrouter':'demo',model:OPENROUTER_API_KEY?FREE_MODEL:'built-in fallback',freeMode:true});
    if(req.method==='POST'&&url.pathname==='/api/roll'){const b=await readJson(req);return send(res,200,parseDice(b.expression));}
    if(req.method==='POST'&&url.pathname==='/api/story'){const b=await readJson(req);return send(res,200,await story(b));}
    if(req.method==='GET'&&url.pathname==='/manifest.webmanifest') return send(res,200,manifest,'application/manifest+json; charset=utf-8');
    if(req.method==='GET'&&url.pathname==='/sw.js') return send(res,200,sw,'application/javascript; charset=utf-8');
    if(req.method==='GET') return send(res,200,HTML,'text/html; charset=utf-8');
    return send(res,404,{error:'Not found'});
  }catch(e){return send(res,500,{error:safeText(e.message||'Server error',500)});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`${SITE_NAME} live on ${PORT} (${OPENROUTER_API_KEY?'OpenRouter free model':'demo fallback'})`));
