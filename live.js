const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomInt } = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const FREE_MODEL = process.env.FREE_MODEL || 'openrouter/free';
const HTML = fs.readFileSync(path.join(__dirname, 'live.html'), 'utf8');

function reply(res, code, body, type='application/json; charset=utf-8') {
  res.writeHead(code, {'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function body(req){return new Promise((ok,no)=>{let s='';req.on('data',c=>{s+=c;if(s.length>500000)req.destroy()});req.on('end',()=>{try{ok(s?JSON.parse(s):{})}catch(e){no(e)}});req.on('error',no)})}
function text(v,n=5000){return String(v??'').slice(0,n)}
function clamp(v,a,b){v=Number(v);return Number.isFinite(v)?Math.min(b,Math.max(a,v)):a}
function dice(expr){const m=String(expr||'').trim().match(/^(\d{0,2})d(\d{1,4})([+-]\d{1,5})?$/i);if(!m)throw Error('Use dice like 1d20, 2d6+3, or 1d100');const count=clamp(m[1]||1,1,50),sides=clamp(m[2],2,10000),mod=clamp(m[3]||0,-99999,99999),rolls=Array.from({length:count},()=>randomInt(1,sides+1)),subtotal=rolls.reduce((a,b)=>a+b,0);return{expression:count+'d'+sides+(mod?(mod>0?'+':'')+mod:''),rolls,modifier:mod,subtotal,total:subtotal+mod}}

async function callAI(messages,max_tokens=1200,temperature=.8){
  if(!OPENROUTER_API_KEY) throw Error('No OpenRouter key');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),45000);
  try{
    const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+OPENROUTER_API_KEY,'Content-Type':'application/json','HTTP-Referer':process.env.SITE_URL||'https://railway.app','X-Title':'Infinite Realms Max'},body:JSON.stringify({model:FREE_MODEL,messages,max_tokens,temperature})});
    if(!r.ok) throw Error('OpenRouter '+r.status+': '+text(await r.text(),240));
    const j=await r.json(), c=j&&j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content;
    if(!c)throw Error('Empty AI response'); return typeof c==='string'?c:JSON.stringify(c);
  }finally{clearTimeout(timer)}
}
function jsonFrom(s){try{return JSON.parse(s)}catch{}const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a>=0&&b>a)try{return JSON.parse(s.slice(a,b+1))}catch{}return null}
function demo(message,game,state){
  const name=text(game.playerName||'Traveler',40),where=text(state.location||game.setting||'the frontier',80),low=message.toLowerCase();let consequence='The world reacts instead of waiting. Nearby people adjust their plans, and a new complication grows from what you just did.',changes=[];
  if(/fight|attack|duel|strike|slash|battle/.test(low)){const dmg=randomInt(2,9);consequence='The clash is immediate and costly. You create an opening, but the opposition answers hard enough that the danger feels real.';changes=[{type:'stat',key:'hp.current',op:'inc',value:-dmg}]}
  else if(/train|cultivate|meditate|practice/.test(low)){const q=randomInt(2,8);consequence='The training gives a measurable gain, but it also reveals a bottleneck that will require insight, resources, or risk to overcome.';changes=[{type:'stat',key:'qi.current',op:'inc',value:q}]}
  else if(/search|look|inspect|investigate|explore/.test(low)) consequence='Your attention catches a detail that was meant to be overlooked. It points toward a larger problem rather than solving the scene for you.';
  else if(/talk|say|ask|tell|convince|negotiate/.test(low)) consequence='The other person responds according to their own motives. Your words change the situation, but they do not simply hand you what you want.';
  return{narration:name+' acts at '+where+': **'+message+'**\n\n'+consequence+'\n\nThe situation now offers several real directions: press forward, investigate the new detail, negotiate, or withdraw before the consequences deepen. What do you do?',stateChanges:changes,memories:[{text:name+' chose to '+message.slice(0,160)+' at '+where+'.',importance:55}],provider:'demo'}
}
function sanitize(x){const out={narration:text(x&&x.narration||'',9000),stateChanges:[],memories:[],provider:x&&x.provider||'AI'},allowed=new Set(['hp.current','hp.max','qi.current','qi.max','gold','xp']);for(const c of Array.isArray(x&&x.stateChanges)?x.stateChanges:[]){if(c&&c.type==='stat'&&allowed.has(c.key)&&['inc','set'].includes(c.op))out.stateChanges.push({type:'stat',key:c.key,op:c.op,value:clamp(c.value,-1000000,1000000)});if(c&&['inventory_add','inventory_remove'].includes(c.type))out.stateChanges.push({type:c.type,item:text(c.item,100),qty:clamp(c.qty||1,1,999)});if(c&&c.type==='relationship')out.stateChanges.push({type:'relationship',entity:text(c.entity,80),op:['inc','set'].includes(c.op)?c.op:'inc',value:clamp(c.value,-100,100)});if(c&&c.type==='quest_add')out.stateChanges.push({type:'quest_add',title:text(c.title,120),description:text(c.description,500)});if(c&&c.type==='quest_status')out.stateChanges.push({type:'quest_status',title:text(c.title,120),status:['active','completed','failed'].includes(c.status)?c.status:'active'})}for(const m of Array.isArray(x&&x.memories)?x.memories:[]){const t=text(m&&m.text||m,700).trim();if(t)out.memories.push({text:t,importance:clamp(m&&m.importance||50,0,100)})}if(!out.narration)out.narration='The narrator returned no usable text. Try another action.';return out}
async function story(b){
  const message=text(b.message,2500).trim();if(!message)throw Error('Enter an action first.');const game=b.game||{},state=b.state||{},memories=(b.memories||[]).slice(-40),recent=(b.recent||[]).slice(-12);if(!OPENROUTER_API_KEY)return demo(message,game,state);
  try{
    const plan=await callAI([{role:'system',content:'You are the planner in an AI RPG council. Give a concise private scene plan. Protect player agency, obey established facts, create earned consequences, keep NPC motives coherent, and avoid effortless wins.'},{role:'user',content:JSON.stringify({game,state,memories,recent,playerAction:message})}],450,.4);
    const raw=await callAI([{role:'system',content:'You are the final Game Master. The human alone controls their character voluntary actions, speech, thoughts and decisions. You control NPCs, world and consequences. Treat supplied state as authoritative. Return ONLY JSON with narration, stateChanges, memories. Allowed changes: stat hp.current/hp.max/qi.current/qi.max/gold/xp with inc or set; inventory_add/remove; relationship; quest_add; quest_status. Write vivid 3-7 paragraphs. No effortless victories, no controlling the player, no retconning established facts. End at a decision point.'},{role:'user',content:JSON.stringify({plannerAdvice:plan,game,state,memories,recent,playerAction:message})}],1500,.88);
    const parsed=jsonFrom(raw);return parsed?sanitize({...parsed,provider:'OpenRouter '+FREE_MODEL}):{narration:raw,stateChanges:[],memories:[],provider:'OpenRouter '+FREE_MODEL};
  }catch(e){const d=demo(message,game,state);d.narration+='\n\n_[Free AI was temporarily unavailable, so this turn used the built-in fallback.]_';d.error=text(e.message,200);return d}
}

const manifest=JSON.stringify({name:'Infinite Realms Max',short_name:'Infinite Realms',start_url:'/',display:'standalone',background_color:'#080a10',theme_color:'#090b12',icons:[]});
const sw="self.addEventListener('install',function(){self.skipWaiting()});self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim())});";

http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://'+(req.headers.host||'localhost'));
  if(req.method==='GET'&&u.pathname==='/api/health')return reply(res,200,{ok:true,app:'Infinite Realms Max',version:'0.5.1',ai:OPENROUTER_API_KEY?'openrouter':'demo',model:OPENROUTER_API_KEY?FREE_MODEL:'built-in fallback',freeMode:true});
  if(req.method==='POST'&&u.pathname==='/api/story')return reply(res,200,await story(await body(req)));
  if(req.method==='POST'&&u.pathname==='/api/roll')return reply(res,200,dice((await body(req)).expression));
  if(req.method==='GET'&&u.pathname==='/manifest.webmanifest')return reply(res,200,manifest,'application/manifest+json; charset=utf-8');
  if(req.method==='GET'&&u.pathname==='/sw.js')return reply(res,200,sw,'application/javascript; charset=utf-8');
  if(req.method==='GET')return reply(res,200,HTML,'text/html; charset=utf-8');
  return reply(res,404,{error:'Not found'});
}catch(e){return reply(res,500,{error:text(e.message||'Server error',500)})}}).listen(PORT,'0.0.0.0',()=>console.log('Infinite Realms Max live on '+PORT+' ('+(OPENROUTER_API_KEY?'OpenRouter free model':'demo fallback')+')'));
