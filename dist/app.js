import {parseSID} from './sid-format.js';
import {withoutTrack} from './collection.js';
import {trigger,drawOscilloscope,drawPhosphor,voiceColor} from './visualizations.js';
import {hvscUrl,deepsidUrl,shardFor,humanize,formatTime,searchPaths,nodeAt,hasEnded,nextTrack,describePath} from './archive.js';

const $=id=>document.getElementById(id);
const MAX_VOICES=9;
const zero=(count=1)=>({chips:count,registers:Array.from({length:count},()=>Array(25).fill(0)),envelopes:Array(count*3).fill(0),waves:Array.from({length:count*3},()=>new Float32Array(512)),time:0});
let snapshot=zero(),tracks=[],current=-1,playing=false,loaded=false,busy=false,view='ribbons',ended=false;
let chips=1,voices=3,activeChip=0,layout='compact',autoAdvance=true;
let context,node,gain,initPromise,sequence=0,pending=new Map(),muted=Array(MAX_VOICES).fill(false),solo=-1;
let history=[];
const archive={manifest:null,shelf:[],paths:null,shards:new Map(),folder:[],query:''};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
try{if(localStorage.getItem('sid-observatory-layout')==='tabs')layout='tabs';autoAdvance=localStorage.getItem('sid-observatory-advance')!=='off';}catch{}
const hex=address=>'$'+address.toString(16).toUpperCase().padStart(4,'0');
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function playingUI(value){playing=value;document.body.classList.toggle('playing',value);$('play').textContent=value?'Ⅱ':'▶';$('play').setAttribute('aria-label',value?'Pause':'Play');$('live-text').textContent=value?'SID SIGNAL LIVE':loaded?'PLAYBACK PAUSED':'READY TO LISTEN';$('start-hint').hidden=loaded;}
function setBusy(value){busy=value;for(const id of ['play','start-button','restart','subtune'])$(id).disabled=value||current<0;for(const button of document.querySelectorAll('.remove-track'))button.disabled=value;}
function chipModels(meta){return meta.chips.map((chip,i)=>({...chip,model:Number($('model-'+i)?.value||chip.model)}));}
function currentLength(){const track=tracks[current];return track?.lengths?.[Number($('subtune').value)]||0;}
function updateDuration(){$('duration').textContent=formatTime(currentLength());}
async function audio(){
  if(initPromise)return initPromise;
  initPromise=(async()=>{
    if(!window.isSecureContext)throw new Error('AudioWorklet needs HTTPS or localhost. Open the hosted demo, or serve the project locally.');
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)throw new Error('This browser does not support Web Audio.');
    context=new Audio({latencyHint:'interactive'});
    if(!context.audioWorklet)throw new Error('AudioWorklet is unavailable. Try a current version of Chrome, Firefox or Safari.');
    await context.audioWorklet.addModule('./sid-worklet.js');
    node=new AudioWorkletNode(context,'sid-observatory',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});
    gain=context.createGain();gain.gain.value=Number($('volume').value)/100;
    node.connect(gain).connect(context.destination);
    node.port.onmessage=({data})=>{
      if(data.type==='snapshot'&&current>=0&&(loaded||busy)){
        if(data.chips!==chips)return;snapshot=data;if(playing){history.push(data);if(history.length>20)history.shift();}updateInspector();
        if(playing&&!ended&&!busy&&hasEnded(data.time,currentLength()))finishTrack();
      }
      else if(data.type==='loaded'){pending.get(data.id)?.resolve();pending.delete(data.id);}
      else if(data.type==='error'){
        const error=new Error(data.message);pending.get(data.id)?.reject(error);pending.delete(data.id);
        playingUI(false);loaded=false;status(data.message,true);
      }
    };
    node.onprocessorerror=()=>{playingUI(false);loaded=false;status('The audio processor stopped. Reload the page to reset the emulator.',true);for(const request of pending.values())request.reject(new Error('Audio processor failed.'));pending.clear();};
    context.onstatechange=()=>{if(context.state==='suspended'&&playing){node.port.postMessage({type:'playing',value:false});playingUI(false);}};
  })().catch(async error=>{initPromise=null;if(context&&context.state!=='closed')await context.close();throw error;});
  return initPromise;
}
async function loadCurrent(sub=Number($('subtune').value)){
  await audio();
  history=[];ended=false;
  const track=tracks[current],id=++sequence,chipsMeta=chipModels(track.meta);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('The SID player did not respond. Reload the page to reset it.'));},10000);
    pending.set(id,{resolve:()=>{clearTimeout(timer);resolve();},reject:error=>{clearTimeout(timer);reject(error);}});
    node.port.postMessage({type:'load',id,buffer:track.buffer,meta:{...track.meta,chips:chipsMeta,model:chipsMeta[0].model},sub});
  });
  loaded=true;sendMute();updateDuration();$('start-hint').hidden=true;
}
// Browsers may refuse to start audio without a user gesture; resume() then never settles. Bound the wait.
async function resumeAudio(){
  await Promise.race([context.resume(),new Promise(resolve=>setTimeout(resolve,1500))]);
  if(context.state!=='running')throw new Error('The browser is waiting for a click before it will start audio. Press play.');
}
async function togglePlay(){
  if(busy||current<0)return;
  setBusy(true);
  try{
    if(playing){node.port.postMessage({type:'playing',value:false});playingUI(false);}
    else{
      await audio();await resumeAudio();
      if(!loaded)await loadCurrent();
      node.port.postMessage({type:'playing',value:true});playingUI(true);
      status('Playing locally · 50 Hz register snapshots · Voice traces are pre-filter, with the emulated envelope applied.');
    }
  }catch(error){status(error.message,true);playingUI(false);}
  finally{setBusy(false);}
}
// Called from the audio snapshot stream once playback passes the song-length database's figure.
async function finishTrack(){
  ended=true;
  const title=tracks[current].meta.title,next=nextTrack(tracks,current);
  if(autoAdvance&&next>=0){status('Reached the end of '+title+' · continuing to the next tune.');await selectTrack(next);return;}
  node.port.postMessage({type:'playing',value:false});playingUI(false);loaded=false;
  status('Reached the end of '+title+(autoAdvance?' · that was the last tune in your collection.':'. Press play to hear it again.'));
}
function trackTag(track){const tag=document.createElement('em');tag.className='track-tag';if(track.meta.chips.length>1){tag.textContent=track.meta.chips.length+'SID';tag.title=track.meta.chips.length+' SID chips';}else if(track.source==='hvsc'){tag.textContent='HVSC';tag.title='Streamed from the High Voltage SID Collection';}else return null;return tag;}
function renderTracks(){
  $('track-list').replaceChildren(...tracks.map((track,i)=>{
    const row=document.createElement('div');row.className='track-row';
    const button=document.createElement('button');button.className='track-item'+(i===current?' active':'');button.setAttribute('aria-pressed',String(i===current));
    const number=document.createElement('span');number.className='track-number';number.textContent=String(i+1).padStart(2,'0');
    const content=document.createElement('span'),title=document.createElement('strong'),author=document.createElement('small');title.textContent=track.meta.title;author.textContent=track.meta.author;
    content.append(title,author);const tag=trackTag(track);if(tag)author.append(' ',tag);
    button.append(number,content);button.addEventListener('click',()=>selectTrack(i));row.append(button);
    if(!track.original){const remove=document.createElement('button');remove.className='remove-track';remove.textContent='×';remove.title='Remove '+track.meta.title;remove.setAttribute('aria-label','Remove '+track.meta.title+' from your tunes');remove.disabled=busy;remove.onclick=()=>removeTrack(i);row.append(remove);}
    return row;
  }));if(!tracks.length){const empty=document.createElement('p');empty.className='track-empty';empty.textContent='Your tunes appear here.';$('track-list').append(empty);}$('track-count').textContent=String(tracks.length).padStart(2,'0');
}
async function removeTrack(index){
  if(busy)return;
  const result=withoutTrack(tracks,current,index);if(!result)return;
  const title=tracks[index].meta.title;
  if(result.activeRemoved){
    node?.port.postMessage({type:'playing',value:false});loaded=false;playingUI(false);history=[];current=-1;tracks=result.tracks;
    if(result.current>=0)await selectTrack(result.current);
    else showEmptyState();
  }else{tracks=result.tracks;current=result.current;renderTracks();}
  status('Removed '+title+' from this session.'+(tracks[index]?.source==='hvsc'?'':' Your original file is unchanged.'));
  // Keep keyboard focus in the collection after the pressed button disappears.
  const rows=$('track-list').children;const next=rows[Math.min(index,rows.length-1)];
  (next?.querySelector('.remove-track')||next?.querySelector('.track-item')||$('sid-file')).focus();
}
// Nothing on the turntable: point the listener at the shelf, the archive and their own files.
function showEmptyState(){
  $('track-credit').textContent='NOTHING ON THE TURNTABLE';$('track-title').textContent='Pick a tune.';
  $('track-author').textContent='Choose a classic from the shelf, browse the whole archive, or open a SID file of your own.';
  $('transport-title').textContent='No tune selected';$('transport-author').textContent='';
  $('format-badge').textContent='PSID';$('chip-badge').textContent='3 VOICES';$('track-source').hidden=true;
  $('subtune').replaceChildren();muted.fill(false);solo=-1;
  chips=1;voices=3;activeChip=0;snapshot=zero();createInspector(null);sendMute();renderTracks();updateInspector();updateDuration();setBusy(false);
  // The start button stays usable with nothing selected: it opens the archive.
  $('start-hint').hidden=false;$('start-button').textContent='Browse the archive';$('start-button').onclick=openArchive;$('start-button').disabled=false;
}
async function selectTrack(index){
  if(busy||index===current)return;
  const resume=playing;
  node?.port.postMessage({type:'playing',value:false});playingUI(false);loaded=false;ended=false;current=index;history=[];
  const track=tracks[index],{meta,original}=track;
  chips=meta.chips.length;voices=chips*3;activeChip=0;snapshot=zero(chips);
  for(const id of ['track-title','transport-title'])$(id).textContent=meta.title;
  $('track-author').textContent=meta.author+(meta.released?' · '+meta.released:'');$('transport-author').textContent=meta.author;
  $('track-credit').textContent=original?'AN ORIGINAL SID STUDY':track.source==='hvsc'?'FROM THE HIGH VOLTAGE SID COLLECTION':'FROM YOUR RECORD BOX';$('format-badge').textContent='PSID v'+meta.version;
  $('track-source').hidden=track.source!=='hvsc';if(track.source==='hvsc'){$('hvsc-path').textContent=track.path;$('deepsid-link').href=deepsidUrl(track.path);}
  $('chip-badge').textContent=chips>1?chips+' × SID · '+voices+' VOICES':'3 VOICES';
  $('subtune').replaceChildren(...Array.from({length:meta.songs},(_,i)=>{const option=document.createElement('option');option.value=i;option.textContent=String(i+1).padStart(2,'0')+' / '+String(meta.songs).padStart(2,'0');return option;}));
  $('subtune').value=meta.start;muted.fill(false);solo=-1;createInspector(meta);sendMute();renderTracks();updateInspector();updateDuration();playingUI(false);setBusy(false);
  $('start-button').textContent='▶  Play this tune';$('start-button').onclick=togglePlay;
  const where=chips>1?chips+' × SID at '+meta.chips.map(chip=>hex(chip.address)).join(', '):'single SID';
  status((meta.assumedPAL?'This file does not specify a clock. PAL is assumed. ':'Ready to play · PAL / ')+where);
  if(resume)await togglePlay();
}
async function restart(){
  if(busy||current<0)return;setBusy(true);
  const resume=playing;node?.port.postMessage({type:'playing',value:false});playingUI(false);
  try{await loadCurrent();if(resume){await resumeAudio();node.port.postMessage({type:'playing',value:true});playingUI(true);}}
  catch(error){loaded=false;status(error.message,true);}finally{setBusy(false);}
}
function effectiveMute(){return muted.map((v,i)=>solo>=0?i!==solo:v);}
function sendMute(){
  const values=effectiveMute();node?.port.postMessage({type:'mute',value:values});
  for(let i=0;i<voices;i++){
    $('voice-'+i)?.classList.toggle('muted',values[i]);
    $('mute-'+i)?.setAttribute('aria-pressed',String(muted[i]));$('solo-'+i)?.setAttribute('aria-pressed',String(solo===i));
  }
}
const MODEL_NAMES={6581:'MOS 6581',8580:'MOS 8580'};
function voiceCard(v){
  const chip=Math.floor(v/3),k=v%3,label=chips>1?`SID ${chip+1} · VOICE 0${k+1}`:`VOICE 0${k+1}`,name=chips>1?`chip ${chip+1} voice ${k+1}`:`voice ${k+1}`;
  return `<article class="voice-card" id="voice-${v}" style="--voice:${voiceColor(v)}"><div class="voice-card-head"><span class="voice-name">${label}</span><div class="voice-actions"><button id="mute-${v}" aria-label="Mute ${name}" title="Mute ${name}" aria-pressed="false">M</button><button id="solo-${v}" aria-label="Solo ${name}" title="Solo ${name}" aria-pressed="false">S</button></div></div><div class="voice-pitch"><strong id="note-${v}">—</strong><small id="hz-${v}">0.0 Hz</small></div><span class="wave-type" id="wave-${v}">OSCILLATOR IDLE</span><canvas id="scope-${v}" aria-label="${name} pre-filter waveform"></canvas><div class="voice-data"><span>PULSE WIDTH</span><strong id="pw-${v}">0000 · 0.0%</strong></div><div class="pulse-bar"><i id="pw-bar-${v}"></i></div><div class="voice-data"><span>ENVELOPE</span><strong id="env-${v}">0 / 255</strong></div><div class="env-bar"><i id="env-bar-${v}"></i></div><div class="adsr"><span>A<strong id="a-${v}">0</strong></span><span>D<strong id="d-${v}">0</strong></span><span>S<strong id="s-${v}">0</strong></span><span>R<strong id="r-${v}">0</strong></span></div><div class="voice-flags"><span id="gate-${v}">GATE</span><span id="sync-${v}">SYNC</span><span id="ring-${v}">RING</span><span id="test-${v}">TEST</span></div></article>`;
}
function filterStrip(chip,model){
  const options=[8580,6581].map(m=>`<option value="${m}"${m===model?' selected':''}>${MODEL_NAMES[m]}</option>`).join('');
  return `<section class="filter-strip" aria-label="${chips>1?'SID '+(chip+1)+' filter':'Shared SID filter'}"><div><span class="tiny-label">${chips>1?'FILTER · SID '+(chip+1):'SHARED ANALOG FILTER'}</span><strong id="filter-mode-${chip}" class="filter-mode">Bypassed</strong></div><div class="cutoff-block"><div><span class="tiny-label">CUTOFF REGISTER</span><strong id="filter-cutoff-${chip}">0000 <small>/ 2047</small></strong></div><div class="filter-track"><span id="cutoff-fill-${chip}"></span></div></div><div><span class="tiny-label">RESONANCE</span><strong id="filter-resonance-${chip}">0 / 15</strong></div><div><span class="tiny-label">ROUTING</span><strong id="filter-routing-${chip}">None</strong></div><label class="model-control"><span class="tiny-label">CHIP MODEL</span><select id="model-${chip}" aria-label="${chips>1?'SID '+(chip+1)+' chip model':'Chip model'}">${options}</select></label></section>`;
}
// The inspector is rebuilt per tune because the chip count can change. Single-chip tunes
// show the classic three-card row; multi-chip tunes offer a condensed all-chips view or tabs.
function createInspector(meta){
  const list=meta?meta.chips:[{address:0xD400,model:8580}];
  $('chips').innerHTML=list.map((chip,c)=>`<section class="chip-group" id="chip-${c}" role="${chips>1?'tabpanel':'region'}" aria-labelledby="chip-tab-${c}"><header class="chip-head"${chips>1?'':' hidden'}><span class="chip-name">SID ${c+1}</span><span class="chip-address">${hex(chip.address)}–${hex(chip.address+0x18)}</span><span class="chip-model" id="chip-model-${c}">${MODEL_NAMES[chip.model]}</span><span class="chip-note">${c===0?'FIRST CHIP · MAIN OUTPUT':'ADDITIONAL CHIP'}</span></header><div class="voices">${[0,1,2].map(k=>voiceCard(c*3+k)).join('')}</div>${filterStrip(c,chip.model)}</section>`).join('');
  for(let v=0;v<voices;v++){$('mute-'+v).onclick=()=>{muted[v]=!muted[v];solo=-1;sendMute();};$('solo-'+v).onclick=()=>{solo=solo===v?-1:v;sendMute();};}
  for(let c=0;c<chips;c++)$('model-'+c).onchange=()=>{const value=Number($('model-'+c).value);node?.port.postMessage({type:'model',chip:c,value});$('chip-model-'+c).textContent=MODEL_NAMES[value];};
  $('chip-tabs').replaceChildren(...list.map((chip,c)=>{const tab=document.createElement('button');tab.id='chip-tab-'+c;tab.role='tab';tab.innerHTML=`<strong>SID ${c+1}</strong><span>${hex(chip.address)}</span>`;tab.onclick=()=>{activeChip=c;applyLayout();};return tab;}));
  const names=['FREQ LO','FREQ HI','PW LO','PW HI','CONTROL','ATT / DEC','SUS / REL'];
  $('register-panel').innerHTML=list.map((chip,c)=>`<div class="register-block"><div class="register-block-label"><span>${chips>1?'SID '+(c+1):'SID REGISTERS'}</span><span>${hex(chip.address)}–${hex(chip.address+0x18)}</span></div>${Array.from({length:25},(_,i)=>`<div class="register" title="${(chips>1?'SID '+(c+1)+' · ':'')+(i<21?'Voice '+(Math.floor(i/7)+1)+' '+names[i%7]:['CUTOFF LO','CUTOFF HI','RES / ROUTE','MODE / VOL'][i-21])}"><span>${hex(chip.address+i)}</span><strong id="reg-${c}-${i}">00</strong></div>`).join('')}</div>`).join('');
  $('register-panel').classList.toggle('dense',chips>1);
  $('voice-legend').replaceChildren(...[0,1,2].map(k=>{const span=document.createElement('span');span.style.color=voiceColor(k);span.textContent='0'+(k+1)+' IDLE';return span;}));
  applyLayout();
}
function applyLayout(){
  const multi=chips>1;
  $('inspector-switch').hidden=!multi;$('chip-tabs').hidden=!multi||layout!=='tabs';
  $('chips').classList.toggle('condensed',multi&&layout==='compact');
  for(const button of $('inspector-switch').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.layout===layout));
  for(let c=0;c<chips;c++){
    const group=$('chip-'+c);if(!group)continue;
    group.hidden=multi&&layout==='tabs'&&c!==activeChip;
    const tab=$('chip-tab-'+c);tab.setAttribute('aria-selected',String(c===activeChip));tab.tabIndex=c===activeChip?0:-1;
  }
  $('legend-chip').textContent=multi?(layout==='tabs'?'SID '+(activeChip+1)+' ·':'ALL CHIPS · SID 1 OUTER RING ·'):'';
  updateInspector();
}
function noteName(hz){if(hz<1)return '—';const midi=Math.round(69+12*Math.log2(hz/440));return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((midi%12)+12)%12]+(Math.floor(midi/12)-1);}
function waveNames(control){return [[16,'TRIANGLE'],[32,'SAW'],[64,'PULSE'],[128,'NOISE']].filter(([bit])=>control&bit).map(([,name])=>name).join(' + ')||'OSCILLATOR IDLE';}
function updateInspector(){
  const legend=$('voice-legend').children,legendChip=layout==='tabs'?activeChip:0;
  for(let v=0;v<voices;v++){
    const chip=Math.floor(v/3),r=snapshot.registers[chip];if(!r||!$('note-'+v))continue;
    const o=(v%3)*7,control=r[o+4],frequency=(r[o]|r[o+1]<<8)*985248/16777216,pw=r[o+2]|(r[o+3]&15)<<8,pct=pw/4096*100;
    $('note-'+v).textContent=control&128?'NOISE':noteName(frequency);$('hz-'+v).textContent=frequency.toFixed(1)+' Hz';$('wave-'+v).textContent=waveNames(control);$('wave-'+v).title=waveNames(control);
    if(chip===legendChip&&legend[v%3])legend[v%3].textContent='0'+(v%3+1)+' '+waveNames(control).replace('OSCILLATOR IDLE','IDLE');
    $('pw-'+v).textContent=String(pw).padStart(4,'0')+' · '+pct.toFixed(1)+'%';$('pw-bar-'+v).style.width=pct+'%';
    $('env-'+v).textContent=snapshot.envelopes[v]+' / 255';$('env-bar-'+v).style.width=(snapshot.envelopes[v]/255*100)+'%';
    $('a-'+v).textContent=r[o+5]>>4;$('d-'+v).textContent=r[o+5]&15;$('s-'+v).textContent=r[o+6]>>4;$('r-'+v).textContent=r[o+6]&15;
    for(const [name,bit] of [['gate',1],['sync',2],['ring',4],['test',8]])$(name+'-'+v).classList.toggle('on',!!(control&bit));
  }
  for(let c=0;c<chips;c++){
    const r=snapshot.registers[c];if(!r||!$('filter-mode-'+c))continue;
    const cutoff=(r[21]&7)|(r[22]<<3);
    $('filter-cutoff-'+c).replaceChildren(document.createTextNode(String(cutoff).padStart(4,'0')+' '));const suffix=document.createElement('small');suffix.textContent='/ 2047';$('filter-cutoff-'+c).append(suffix);
    $('cutoff-fill-'+c).style.width=(cutoff/2047*100)+'%';$('filter-resonance-'+c).textContent=(r[23]>>4)+' / 15';
    const mode=[[16,'Low-pass'],[32,'Band-pass'],[64,'High-pass']].filter(([bit])=>r[24]&bit).map(([,name])=>name).join(' + ')||'Bypassed';
    $('filter-mode-'+c).textContent=mode;$('filter-mode-'+c).title=mode;
    $('filter-routing-'+c).textContent=[0,1,2].filter(i=>r[23]&(1<<i)).map(i=>'0'+(i+1)).join(' · ')||'None';
    for(let i=0;i<25;i++)$('reg-'+c+'-'+i).textContent=r[i].toString(16).padStart(2,'0').toUpperCase();
  }
  $('elapsed').textContent=formatTime(snapshot.time)==='--:--'?'00:00':formatTime(snapshot.time);
}
function fit(canvas){const box=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(box.width*dpr)||canvas.height!==Math.round(box.height*dpr)){canvas.width=Math.round(box.width*dpr);canvas.height=Math.round(box.height*dpr);}const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w:box.width,h:box.height};}
function drawScope(canvas,data,color,dim=false){const {ctx,w,h}=fit(canvas);if(!w||!h)return;ctx.clearRect(0,0,w,h);ctx.strokeStyle='#293241';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();ctx.strokeStyle=color;ctx.globalAlpha=dim?.28:.85;ctx.lineWidth=1.1;ctx.beginPath();const start=trigger(data),length=Math.min(256,data.length-start);for(let x=0;x<w;x++){const n=data[start+Math.floor(x/w*length)]||0;const y=h/2-n*h*.4;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();ctx.globalAlpha=1;}
let lastDraw=0;
function frame(now){
  requestAnimationFrame(frame);if(document.hidden||now-lastDraw<(reduced.matches?80:30))return;lastDraw=now;
  const mutedNow=effectiveMute();
  if(view!=='registers'){
    const {ctx,w,h}=fit($('main-canvas'));
    if(view==='ribbons')drawPhosphor(ctx,w,h,snapshot,history,mutedNow,reduced.matches);
    else drawOscilloscope(ctx,w,h,snapshot,mutedNow);
  }
  for(let v=0;v<voices;v++){const canvas=$('scope-'+v);if(canvas&&!canvas.closest('[hidden]'))drawScope(canvas,snapshot.waves[v],voiceColor(v),mutedNow[v]);}
}
async function importFiles(files){
  if(busy){status('Finish loading this tune, then drop your files again.');return;}
  const errors=[],added=[];
  for(const file of files){
    try{if(file.size>65792)throw new Error('File is larger than a SID program.');const buffer=await file.arrayBuffer();const meta=parseSID(buffer,file.name);added.push({buffer,meta,original:false,source:'local'});}
    catch(error){errors.push(file.name+': '+error.message);}
  }
  if(added.length){const first=tracks.length;tracks.push(...added);await selectTrack(first);}
  if(errors.length)status(errors.join(' '),true);
}

// ---- The archive: HVSC index shipped with the site, tunes streamed on request. ----
function archiveStatus(message,error=false){$('archive-status').textContent=message;$('archive-status').classList.toggle('error',error);}
async function loadJSON(url){const response=await fetch(url);if(!response.ok)throw new Error('Could not load '+url.split('/').pop()+' ('+response.status+').');return response.json();}
async function loadShard(name){if(!archive.shards.has(name))archive.shards.set(name,loadJSON('./hvsc/'+name+'.json').catch(error=>{archive.shards.delete(name);throw error;}));return archive.shards.get(name);}
async function loadPaths(){if(!archive.paths){archive.paths=fetch('./hvsc/paths.txt').then(r=>{if(!r.ok)throw new Error('The search index could not be loaded.');return r.text();}).then(text=>text.trim().split('\n')).catch(error=>{archive.paths=null;throw error;});}return archive.paths;}
async function lengthsFor(path){
  const shelf=archive.shelf.find(entry=>entry.path===path);if(shelf)return shelf.lengths;
  try{const shard=await loadShard(shardFor(path));const segments=path.split('/').slice(3);let node=shard.tree;for(const segment of segments.slice(0,-1))node=node?.folders?.[segment];return node?.files?.[segments.at(-1)]||null;}catch{return null;}
}
// Fetch one tune from HVSC, add it to the collection and optionally start it.
async function addArchiveTrack(path,{play=true}={}){
  if(busy){archiveStatus('Finish loading the current tune first.');return;}
  const existing=tracks.findIndex(track=>track.path===path);
  if(existing>=0){if(play){$('archive').close();await selectTrack(existing);if(!playing)await togglePlay();}else archiveStatus(humanize(path.split('/').pop())+' is already in your tunes.');return;}
  const {title,composer}=describePath(path);
  archiveStatus('Fetching '+title+' from hvsc.c64.org…');status('Fetching '+title+' by '+composer+' from the High Voltage SID Collection…');
  try{
    const [response,lengths]=await Promise.all([fetch(hvscUrl(path)),lengthsFor(path)]);
    if(!response.ok)throw new Error('HVSC answered '+response.status+' for this tune.');
    const buffer=await response.arrayBuffer();
    if(buffer.byteLength>65792)throw new Error('File is larger than a SID program.');
    const meta=parseSID(buffer,path.split('/').pop());
    tracks.push({buffer,meta,original:false,source:'hvsc',path,lengths});
    renderTracks();
    archiveStatus('Added '+meta.title+' by '+meta.author+' to your tunes.');
    if(play){$('archive').close();await selectTrack(tracks.length-1);if(!playing)await togglePlay();}
    else status('Added '+meta.title+' to your tunes · streamed from HVSC, not stored.');
  }catch(error){
    const message=error instanceof TypeError?(location.hostname==='localhost'?'HVSC does not allow the http://localhost origin. Open this page as http://127.0.0.1 instead.':'HVSC could not be reached. Check your connection and try again.'):error.message;
    archiveStatus(title+': '+message,true);status(title+': '+message,true);
  }
}
function archiveRow({glyph,title,subtitle,length,onOpen,onAdd,folder=false}){
  const row=document.createElement('div');row.className='archive-row'+(folder?' folder':'');row.role='listitem';
  const g=document.createElement('span');g.className='glyph';g.setAttribute('aria-hidden','true');g.textContent=glyph;
  const main=document.createElement('button');main.className='main';const strong=document.createElement('strong');strong.textContent=title;main.append(strong);
  if(subtitle){const small=document.createElement('small');small.textContent=subtitle;main.append(small);}
  main.onclick=onOpen;row.append(g,main);
  const len=document.createElement('span');len.className='length';len.textContent=length||'';row.append(len);
  if(onAdd){const add=document.createElement('button');add.className='add';add.textContent='+';add.title='Add to your tunes without playing';add.setAttribute('aria-label','Add '+title+' to your tunes');add.onclick=onAdd;row.append(add);}
  return row;
}
function fileRow(path,lengths){
  const {title,composer}=describePath(path),name=path.split('/').pop(),chipsIn=/_3SID\.sid$/i.test(name)?3:/_2SID\.sid$/i.test(name)?2:1;
  return archiveRow({glyph:'♪',title:title+(chipsIn>1?' · '+chipsIn+'SID':''),subtitle:composer+(lengths&&lengths.length>1?' · '+lengths.length+' subtunes':''),length:formatTime(lengths?.[0]),onOpen:()=>addArchiveTrack(path),onAdd:()=>addArchiveTrack(path,{play:false})});
}
function renderCrumbs(){
  const crumbs=$('archive-crumbs');crumbs.replaceChildren();
  const root=document.createElement('button');root.textContent='HVSC';root.onclick=()=>{archive.folder=[];archive.query='';$('archive-search').value='';renderArchive();};crumbs.append(root);
  archive.folder.forEach((segment,i)=>{const sep=document.createElement('span');sep.textContent='/';crumbs.append(sep);if(i===archive.folder.length-1){const here=document.createElement('strong');here.textContent=humanize(segment);crumbs.append(here);}else{const b=document.createElement('button');b.textContent=humanize(segment);b.onclick=()=>{archive.folder=archive.folder.slice(0,i+1);renderArchive();};crumbs.append(b);}});
  if(archive.query){const sep=document.createElement('span');sep.textContent='/';const q=document.createElement('strong');q.textContent='Search: '+archive.query;crumbs.append(sep,q);}
}
function folderRow(name,subtitle,open){return archiveRow({glyph:'▸',title:humanize(name),subtitle,onOpen:open,folder:true});}
function countFiles(node){return Object.keys(node.files).length+Object.values(node.folders).reduce((sum,child)=>sum+countFiles(child),0);}
async function renderArchive(){
  renderCrumbs();
  const list=$('archive-list');list.replaceChildren();
  if(archive.query){
    archiveStatus('Searching…');
    try{const paths=await loadPaths();const results=searchPaths(paths,archive.query);
      if(archive.query!==$('archive-search').value.trim())return;
      list.replaceChildren(...results.map(path=>fileRow(path,null)));
      if(!results.length){const empty=document.createElement('p');empty.className='archive-empty';empty.textContent='No tunes match “'+archive.query+'”. Try a composer surname or a game title.';list.append(empty);}
      archiveStatus(results.length>=120?'Showing the first 120 matches · refine your search to see more.':results.length+' match'+(results.length===1?'':'es')+' across the collection.');
    }catch(error){archiveStatus(error.message,true);}
    return;
  }
  if(!archive.manifest){archiveStatus('The archive index is not available.',true);return;}
  const [top,second,...rest]=archive.folder;
  if(!top){
    const labels={MUSICIANS:'Composers, A to Z',DEMOS:'Demoscene productions',GAMES:'Game soundtracks filed by title'};
    for(const name of Object.keys(archive.manifest.shards))list.append(folderRow(name,labels[name]||'',()=>{archive.folder=[name];renderArchive();}));
    archiveStatus('Release '+archive.manifest.release+' · '+archive.manifest.files.toLocaleString()+' tunes. Pick a folder, or search above.');
    return;
  }
  if(!second){
    for(const name of archive.manifest.shards[top]||[])list.append(folderRow(name,'',()=>{archive.folder=[top,name];renderArchive();}));
    archiveStatus(humanize(top)+' · '+(archive.manifest.shards[top]||[]).length+' sections.');
    return;
  }
  archiveStatus('Loading…');
  try{
    const shard=await loadShard(top+'-'+second),node=nodeAt(shard.tree,rest);
    if(!node){archive.folder=[top,second];return renderArchive();}
    for(const [name,child] of Object.entries(node.folders))list.append(folderRow(name,countFiles(child)+' tunes',()=>{archive.folder=[...archive.folder,name];renderArchive();}));
    const base='/'+archive.folder.join('/');
    for(const [name,lengths] of Object.entries(node.files))list.append(fileRow(base+'/'+name,lengths));
    archiveStatus(Object.keys(node.folders).length+' folders · '+Object.keys(node.files).length+' tunes here. Click a tune to play it, or + to queue it.');
  }catch(error){archiveStatus(error.message,true);}
}
function renderShelf(){
  $('shelf').replaceChildren(...archive.shelf.map(entry=>{
    const item=document.createElement('button');item.className='shelf-item';item.title=entry.note+' · '+entry.path;
    const strong=document.createElement('strong');strong.textContent=entry.title;const small=document.createElement('small');small.textContent=entry.author;
    if(entry.chips>1){const tag=document.createElement('em');tag.className='track-tag';tag.textContent=entry.chips+'SID';small.append(tag);}
    const length=document.createElement('span');length.className='length';length.textContent=formatTime(entry.lengths[entry.start||0]);
    item.append(strong,small,length);item.onclick=()=>addArchiveTrack(entry.path);return item;
  }));
}
async function openArchive(){
  $('archive').showModal();
  if(archive.manifest)$('archive-meta').textContent='RELEASE '+archive.manifest.release+' · '+archive.manifest.files.toLocaleString()+' TUNES · STREAMED FROM HVSC.C64.ORG';
  renderArchive();$('archive-search').focus();
}
let searchTimer=0;
$('archive-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{archive.query=$('archive-search').value.trim();renderArchive();},180);};
$('archive-button').onclick=openArchive;$('close-archive').onclick=()=>$('archive').close();
$('advance').onclick=()=>{autoAdvance=!autoAdvance;$('advance').setAttribute('aria-pressed',String(autoAdvance));try{localStorage.setItem('sid-observatory-advance',autoAdvance?'on':'off');}catch{}status(autoAdvance?'Your tunes will play on in order when each one ends.':'Playback stops at the end of each tune.');};
$('advance').setAttribute('aria-pressed',String(autoAdvance));

$('play').onclick=togglePlay;$('restart').onclick=restart;$('subtune').onchange=restart;
$('volume').oninput=()=>{const value=Number($('volume').value);$('volume-value').textContent=value+'%';if(gain)gain.gain.setTargetAtTime(value/100,context.currentTime,.02);};
$('sid-file').onchange=async event=>{await importFiles(event.target.files);event.target.value='';};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{view=button.dataset.view;for(const b of document.querySelectorAll('[data-view]')){b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));}$('register-panel').hidden=view!=='registers';$('main-canvas').hidden=view==='registers';$('visual-caption').textContent=view==='registers'?(chips>1?'PER-CHIP REGISTERS · HEXADECIMAL':'$D400–$D418 · HEXADECIMAL'):view==='ribbons'?'PHOSPHOR ORBITS · VOICE HISTORY':'OSCILLATOR OUTPUT · PRE-FILTER';$('main-canvas').setAttribute('aria-label',view==='ribbons'?'Audio-driven phosphor orbits with voice history':'Triggered pre-filter waveform traces');};
for(const button of document.querySelectorAll('[data-layout]'))button.onclick=()=>{layout=button.dataset.layout;try{localStorage.setItem('sid-observatory-layout',layout);}catch{}applyLayout();};
$('chip-tabs').addEventListener('keydown',event=>{if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft')return;event.preventDefault();activeChip=(activeChip+(event.key==='ArrowRight'?1:chips-1))%chips;applyLayout();$('chip-tab-'+activeChip).focus();});
$('focus-button').onclick=()=>{const on=document.body.classList.toggle('focus-mode');$('focus-button').setAttribute('aria-pressed',String(on));$('focus-button').textContent=on?'Show the instrument panel ⤡':'Listening mode ⤢';};
$('about-button').onclick=()=>$('about').showModal();$('close-about').onclick=()=>$('about').close();
document.addEventListener('keydown',event=>{if(event.code==='Space'&&!/INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)&&!$('about').open&&!$('archive').open){event.preventDefault();togglePlay();}});
let dragDepth=0;document.addEventListener('dragenter',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dragDepth++;document.body.classList.add('dragging');}});
document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('dragging');}});
document.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;document.body.classList.remove('dragging');if(event.dataTransfer?.files.length)importFiles(event.dataTransfer.files);});
showEmptyState();requestAnimationFrame(frame);
try{
  [archive.manifest,archive.shelf]=await Promise.all([loadJSON('./hvsc/manifest.json'),loadJSON('./hvsc/shelf.json')]);
  $('archive-count').textContent='HVSC #'+archive.manifest.release;renderShelf();
}catch(error){$('archive-count').textContent='OFFLINE';$('archive-button').disabled=true;status(error.message,true);}
