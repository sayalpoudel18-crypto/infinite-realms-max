(function(){
  'use strict';
  var MAX_TURNS=400, MAX_MEMORIES=150, MAX_CHECKPOINTS=10, MAX_CP_TURNS=140, MAX_CP_MEMORIES=120;
  var busy=false;
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function num(v,d){v=Number(v);return Number.isFinite(v)?v:d;}
  function clamp(v,a,b){return Math.min(b,Math.max(a,num(v,a)));}
  function normalizeState(s,g){
    s=s&&typeof s==='object'?s:{};
    s.location=String(s.location||g.setting||'Unknown').slice(0,200);
    s.realm=String(s.realm||(g.genre==='Cultivation'?'Body Tempering — Stage 1':'Level 1')).slice(0,160);
    s.hp=s.hp&&typeof s.hp==='object'?s.hp:{current:100,max:100};s.hp.max=clamp(s.hp.max,1,1000000);s.hp.current=clamp(s.hp.current,0,s.hp.max);
    s.qi=s.qi&&typeof s.qi==='object'?s.qi:{current:50,max:100};s.qi.max=clamp(s.qi.max,1,1000000);s.qi.current=clamp(s.qi.current,0,s.qi.max);
    s.gold=clamp(s.gold,-1000000000,1000000000);s.xp=clamp(s.xp,0,1000000000);
    s.inventory=Array.isArray(s.inventory)?s.inventory.slice(-120):[];s.quests=Array.isArray(s.quests)?s.quests.slice(-80):[];s.relationships=s.relationships&&typeof s.relationships==='object'&&!Array.isArray(s.relationships)?s.relationships:{};
    Object.keys(s.relationships).forEach(function(k){s.relationships[k]=clamp(s.relationships[k],-100,100)});
    return s;
  }
  function normalizeRun(run,g){
    run=run&&typeof run==='object'?run:{};run.state=normalizeState(run.state||baseState(g),g);run.turns=Array.isArray(run.turns)?run.turns.slice(-MAX_TURNS):[];run.memories=Array.isArray(run.memories)?run.memories.slice(-MAX_MEMORIES):[];run.checkpoints=Array.isArray(run.checkpoints)?run.checkpoints.slice(-MAX_CHECKPOINTS):[];
    run.checkpoints.forEach(function(cp){if(Array.isArray(cp.turns))cp.turns=cp.turns.slice(-MAX_CP_TURNS);if(Array.isArray(cp.memories))cp.memories=cp.memories.slice(-MAX_CP_MEMORIES)});return run;
  }
  function compact(){
    db.games=Array.isArray(db.games)?db.games.slice(-60):[];db.runs=db.runs&&typeof db.runs==='object'?db.runs:{};
    Object.keys(db.runs).forEach(function(id){var g=findGame(id)||{genre:'Adventure',setting:'Unknown'};db.runs[id]=normalizeRun(db.runs[id],g)});
  }
  window.save=function(){
    compact();
    try{localStorage.setItem(STORE,JSON.stringify(db));}
    catch(e){
      Object.keys(db.runs).forEach(function(id){var r=db.runs[id];r.turns=r.turns.slice(-250);r.memories=r.memories.slice(-100);r.checkpoints=r.checkpoints.slice(-5);r.checkpoints.forEach(function(cp){cp.turns=(cp.turns||[]).slice(-80);cp.memories=(cp.memories||[]).slice(-80)})});
      try{localStorage.setItem(STORE,JSON.stringify(db));}
      catch(e2){alert('Your browser storage is full. Export or remove older campaigns/checkpoints before continuing.');throw e2;}
    }
  };
  window.api=async function(path,b){
    var attempts=0,last;
    while(attempts<2){attempts++;var c=new AbortController(),t=setTimeout(function(){c.abort()},60000);try{
      var r=await fetch(path,{method:b?'POST':'GET',headers:{'content-type':'application/json'},body:b?JSON.stringify(b):undefined,signal:c.signal});
      var text=await r.text(),j;try{j=text?JSON.parse(text):{}}catch(e){j={error:text||'Non-JSON server response'}}
      if(!r.ok){var er=new Error(j.error||('Request failed ('+r.status+')'));er.status=r.status;if(r.status<500||r.status===429)throw er;last=er;}
      else return j;
    }catch(e){last=e;if(e.status&&e.status<500)throw e;}finally{clearTimeout(t)}
    }
    throw last||new Error('Network request failed');
  };
  window.play=function(id){var g=findGame(id);if(!g)return;var run=db.runs[id];if(!run){run={state:baseState(g),turns:[{who:'gm',text:g.premise+'\n\nWhat do you do?'}],memories:[],checkpoints:[]}}run=normalizeRun(run,g);db.runs[id]=run;current={g:g,run:run};save();renderPlay();};
  window.apply=function(changes){
    if(!current)return;var s=current.run.state; (Array.isArray(changes)?changes:[]).forEach(function(c){if(!c||typeof c!=='object')return;
      if(c.type==='stat'){var old=Number(getPath(s,c.key)||0),v=c.op==='set'?Number(c.value):old+Number(c.value||0);if(c.key==='hp.max'){s.hp.max=clamp(v,1,1000000);s.hp.current=clamp(s.hp.current,0,s.hp.max)}else if(c.key==='hp.current')s.hp.current=clamp(v,0,s.hp.max);else if(c.key==='qi.max'){s.qi.max=clamp(v,1,1000000);s.qi.current=clamp(s.qi.current,0,s.qi.max)}else if(c.key==='qi.current')s.qi.current=clamp(v,0,s.qi.max);else if(c.key==='gold')s.gold=clamp(v,-1000000000,1000000000);else if(c.key==='xp')s.xp=clamp(v,0,1000000000)}
      else if(c.type==='inventory_add'&&c.item){var x=s.inventory.find(function(i){return String(i.name).toLowerCase()===String(c.item).toLowerCase()});if(x)x.qty=clamp(Number(x.qty||0)+Number(c.qty||1),0,99999);else s.inventory.push({name:String(c.item).slice(0,100),qty:clamp(c.qty||1,1,99999)});s.inventory=s.inventory.slice(-120)}
      else if(c.type==='inventory_remove'&&c.item){var y=s.inventory.find(function(i){return String(i.name).toLowerCase()===String(c.item).toLowerCase()});if(y)y.qty=Number(y.qty||0)-Number(c.qty||1);s.inventory=s.inventory.filter(function(i){return Number(i.qty)>0})}
      else if(c.type==='relationship'&&c.entity){var oldRel=Number(s.relationships[c.entity]||0),nv=c.op==='set'?Number(c.value):oldRel+Number(c.value||0);s.relationships[String(c.entity).slice(0,80)]=clamp(nv,-100,100)}
      else if(c.type==='quest_add'&&c.title&&!s.quests.some(function(q){return q.title===c.title})){s.quests.push({title:String(c.title).slice(0,120),description:String(c.description||'').slice(0,500),status:'active'});s.quests=s.quests.slice(-80)}
      else if(c.type==='quest_status'&&c.title){var q=s.quests.find(function(z){return z.title===c.title});if(q)q.status=['active','completed','failed'].includes(c.status)?c.status:'active'}
      else if(c.type==='location'&&c.value)s.location=String(c.value).slice(0,160);
      else if(c.type==='realm'&&c.value)s.realm=String(c.value).slice(0,160);
    });
    current.run.state=normalizeState(s,current.g);
  };
  window.sendTurn=async function(){
    if(busy||!current)return;var el=document.getElementById('msg');if(!el)return;var raw=String(el.value||'').trim();if(!raw)return;if(raw.length>2500){alert('Keep one action under 2,500 characters.');return}
    var mode=document.getElementById('mode').value,message=mode==='Say'?'I say: "'+raw+'"':mode==='Story'?'Story direction: '+raw:raw;busy=true;current.run.turns.push({who:'player',text:message});current.run.turns=current.run.turns.slice(-MAX_TURNS);el.value='';renderPlay();var b=document.getElementById('send');if(b){b.disabled=true;b.textContent='Thinking…'}
    try{var out=await api('/api/story',{message:message,game:current.g,state:current.run.state,memories:current.run.memories.slice(-MAX_MEMORIES),recent:current.run.turns.slice(-16)});current.run.turns.push({who:'gm',text:String(out.narration||'The world shifts, but no narration was returned.')});apply(out.stateChanges);(Array.isArray(out.memories)?out.memories:[]).forEach(function(m){if(m&&m.text&&!current.run.memories.some(function(x){return x.text===m.text}))current.run.memories.push({id:String(Date.now()+Math.random()),text:String(m.text).slice(0,700),importance:clamp(m.importance||50,0,100)})});current.run.turns=current.run.turns.slice(-MAX_TURNS);current.run.memories=current.run.memories.slice(-MAX_MEMORIES);db.runs[current.g.id]=current.run;save()}
    catch(e){current.run.turns.push({who:'gm',text:'The narrator could not complete that turn: '+e.message+'\n\nYour previous state is still saved. You can retry or choose another action.'});current.run.turns=current.run.turns.slice(-MAX_TURNS);save()}
    finally{busy=false;renderPlay()}
  };
  window.checkpoint=function(){
    if(!current)return;var cps=current.run.checkpoints||[];var list=cps.length?cps.map(function(cp,i){return '<div class="mem"><b>'+esc(cp.label||('Checkpoint '+(i+1)))+'</b><br><small>'+new Date(cp.at||Date.now()).toLocaleString()+'</small><div style="margin-top:8px"><button class="btn" onclick="restoreCheckpoint('+i+')">Restore</button> <button class="btn ghost" onclick="deleteCheckpoint('+i+')">Delete</button></div></div>'}).join(''):'<div class="empty">No checkpoints yet.</div>';modal('<h2>Save points</h2><p class="status">Checkpoints keep state, memory and the most recent '+MAX_CP_TURNS+' turns so long campaigns stay reliable on iPhone.</p>'+list+'<button class="btn primary" onclick="makeCheckpoint()">+ New checkpoint</button> <button class="btn" onclick="closeModal()">Close</button>');
  };
  window.makeCheckpoint=function(){if(!current)return;var label=prompt('Name this checkpoint','Checkpoint '+((current.run.checkpoints||[]).length+1));if(!label)return;var cp={label:String(label).slice(0,80),at:Date.now(),state:clone(current.run.state),turns:clone(current.run.turns.slice(-MAX_CP_TURNS)),memories:clone(current.run.memories.slice(-MAX_CP_MEMORIES))};current.run.checkpoints=(current.run.checkpoints||[]).concat([cp]).slice(-MAX_CHECKPOINTS);save();checkpoint();};
  window.restoreCheckpoint=function(i){if(!current)return;var cp=(current.run.checkpoints||[])[i];if(!cp)return;if(!confirm('Restore "'+(cp.label||'this checkpoint')+'"? Your current branch will be replaced unless you save it first.'))return;current.run.state=normalizeState(clone(cp.state),current.g);current.run.turns=clone(cp.turns||[]).slice(-MAX_TURNS);current.run.memories=clone(cp.memories||[]).slice(-MAX_MEMORIES);save();closeModal();renderPlay();};
  window.deleteCheckpoint=function(i){if(!current)return;current.run.checkpoints.splice(i,1);save();checkpoint();};
  window.addEventListener('beforeunload',function(){try{save()}catch(e){}});
  window.addEventListener('offline',function(){var x=document.getElementById('aiStatus');if(x)x.innerHTML='<span class="warn">● Offline — saves still local</span>'});
  window.addEventListener('online',function(){var x=document.getElementById('aiStatus');if(x)x.innerHTML='<span class="good">● Online</span>'});
  try{compact();save();}catch(e){}
})();
