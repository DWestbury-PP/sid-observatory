import {parseSID} from './sid-format.js';
import {withoutTrack} from './collection.js';
import {trigger,drawOscilloscope,drawPhosphor} from './visualizations.js';

const $=id=>document.getElementById(id);
const colors=['#74edcf','#d694fc','#ffb979'];
const zero=()=>({registers:Array(25).fill(0),envelopes:[0,0,0],waves:Array.from({length:3},()=>new Float32Array(512)),time:0});
let snapshot=zero(),tracks=[],current=-1,playing=false,loaded=false,busy=false,view='ribbons';
let context,node,gain,initPromise,sequence=0,pending=new Map(),muted=[false,false,false],solo=-1;
let history=[];
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function playingUI(value){playing=value;document.body.classList.toggle('playing',value);$('play').textContent=value?'Ⅱ':'▶';$('play').setAttribute('aria-label',value?'Pause':'Play');$('live-text').textContent=value?'SID SIGNAL LIVE':loaded?'PLAYBACK PAUSED':'READY TO LISTEN';$('start-hint').hidden=loaded;}
function setBusy(value){busy=value;for(const id of ['play','start-button','restart','subtune'])$(id).disabled=value||current<0;for(const button of document.querySelectorAll('.remove-track'))button.disabled=value;}
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
      if(data.type==='snapshot'&&current>=0&&(loaded||busy)){snapshot=data;if(playing){history.push(data);if(history.length>20)history.shift();}updateInspector();}
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
  history=[];
  const track=tracks[current],id=++sequence;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('The SID player did not respond. Reload the page to reset it.'));},10000);
    pending.set(id,{resolve:()=>{clearTimeout(timer);resolve();},reject:error=>{clearTimeout(timer);reject(error);}});
    node.port.postMessage({type:'load',id,buffer:track.buffer,meta:{...track.meta,model:Number($('model').value)},sub});
  });
  loaded=true;sendMute();$('start-hint').hidden=true;
}
async function togglePlay(){
  if(busy||current<0)return;
  setBusy(true);
  try{
    if(playing){node.port.postMessage({type:'playing',value:false});playingUI(false);}
    else{
      await audio();await context.resume();
      if(!loaded)await loadCurrent();
      node.port.postMessage({type:'playing',value:true});playingUI(true);
      status('Playing locally · 50 Hz register snapshots · Voice traces are pre-filter, with the emulated envelope applied.');
    }
  }catch(error){status(error.message,true);playingUI(false);}
  finally{setBusy(false);}
}
function renderTracks(){
  $('track-list').replaceChildren(...tracks.map((track,i)=>{
    const row=document.createElement('div');row.className='track-row';
    const button=document.createElement('button');button.className='track-item'+(i===current?' active':'');button.setAttribute('aria-pressed',String(i===current));
    const number=document.createElement('span');number.className='track-number';number.textContent=String(i+1).padStart(2,'0');
    const content=document.createElement('span'),title=document.createElement('strong'),author=document.createElement('small');title.textContent=track.meta.title;author.textContent=track.meta.author;
    content.append(title,author);button.append(number,content);button.addEventListener('click',()=>selectTrack(i));row.append(button);
    if(!track.original){const remove=document.createElement('button');remove.className='remove-track';remove.textContent='×';remove.title='Remove '+track.meta.title;remove.setAttribute('aria-label','Remove '+track.meta.title+' from your tunes');remove.disabled=busy;remove.onclick=()=>removeTrack(i);row.append(remove);}
    return row;
  }));$('track-count').textContent=String(tracks.length).padStart(2,'0');
}
async function removeTrack(index){
  if(busy)return;
  const result=withoutTrack(tracks,current,index);if(!result)return;
  const title=tracks[index].meta.title;
  if(result.activeRemoved){
    node?.port.postMessage({type:'playing',value:false});loaded=false;playingUI(false);history=[];snapshot=zero();current=-1;tracks=result.tracks;
    if(result.current>=0)await selectTrack(result.current);
    else{
      for(const id of ['track-title','transport-title'])$(id).textContent='No tune selected';
      $('track-author').textContent='Open a SID file to begin';$('transport-author').textContent='';$('track-credit').textContent='YOUR RECORD BOX';$('format-badge').textContent='PSID';
      $('subtune').replaceChildren();$('start-hint').hidden=true;muted=[false,false,false];solo=-1;sendMute();renderTracks();updateInspector();setBusy(false);
    }
  }else{tracks=result.tracks;current=result.current;renderTracks();}
  status('Removed '+title+' from this session. Your original file is unchanged.');
  // Keep keyboard focus in the collection after the pressed button disappears.
  const rows=$('track-list').children;const next=rows[Math.min(index,rows.length-1)];
  (next?.querySelector('.remove-track')||next?.querySelector('.track-item')||$('sid-file')).focus();
}
async function selectTrack(index){
  if(busy||index===current)return;
  const resume=playing;
  node?.port.postMessage({type:'playing',value:false});playingUI(false);loaded=false;current=index;snapshot=zero();history=[];
  const {meta,original}=tracks[index];
  for(const id of ['track-title','transport-title'])$(id).textContent=meta.title;
  $('track-author').textContent=meta.author+(meta.released?' · '+meta.released:'');$('transport-author').textContent=meta.author;
  $('track-credit').textContent=original?'AN ORIGINAL SID STUDY':'FROM YOUR RECORD BOX';$('format-badge').textContent='PSID v'+meta.version;
  $('model').value=String(meta.model);$('subtune').replaceChildren(...Array.from({length:meta.songs},(_,i)=>{const option=document.createElement('option');option.value=i;option.textContent=String(i+1).padStart(2,'0')+' / '+String(meta.songs).padStart(2,'0');return option;}));
  $('subtune').value=meta.start;muted=[false,false,false];solo=-1;sendMute();renderTracks();updateInspector();playingUI(false);setBusy(false);
  $('start-button').textContent='▶  Play this tune';
  status(meta.assumedPAL?'This file does not specify a clock. PAL is assumed for this prototype.':'Ready to play · PAL / single SID');
  if(resume)await togglePlay();
}
async function restart(){
  if(busy||current<0)return;setBusy(true);
  const resume=playing;node?.port.postMessage({type:'playing',value:false});playingUI(false);
  try{await loadCurrent();if(resume){await context.resume();node.port.postMessage({type:'playing',value:true});playingUI(true);}}
  catch(error){loaded=false;status(error.message,true);}finally{setBusy(false);}
}
function effectiveMute(){return muted.map((v,i)=>solo>=0?i!==solo:v);}
function sendMute(){
  const values=effectiveMute();node?.port.postMessage({type:'mute',value:values});
  for(let i=0;i<3;i++){
    $('voice-'+i)?.classList.toggle('muted',values[i]);
    $('mute-'+i)?.setAttribute('aria-pressed',String(muted[i]));$('solo-'+i)?.setAttribute('aria-pressed',String(solo===i));
  }
}
function createInspector(){
  $('voices').innerHTML=Array.from({length:3},(_,i)=>`<article class="voice-card" id="voice-${i}"><div class="voice-card-head"><span class="voice-name">VOICE 0${i+1}</span><div class="voice-actions"><button id="mute-${i}" aria-label="Mute voice ${i+1}" title="Mute voice ${i+1}" aria-pressed="false">M</button><button id="solo-${i}" aria-label="Solo voice ${i+1}" title="Solo voice ${i+1}" aria-pressed="false">S</button></div></div><div class="voice-pitch"><strong id="note-${i}">—</strong><small id="hz-${i}">0.0 Hz</small></div><span class="wave-type" id="wave-${i}">OSCILLATOR IDLE</span><canvas id="scope-${i}" aria-label="Voice ${i+1} pre-filter waveform"></canvas><div class="voice-data"><span>PULSE WIDTH</span><strong id="pw-${i}">0000 · 0.0%</strong></div><div class="pulse-bar"><i id="pw-bar-${i}"></i></div><div class="voice-data"><span>ENVELOPE</span><strong id="env-${i}">0 / 255</strong></div><div class="env-bar"><i id="env-bar-${i}"></i></div><div class="adsr"><span>A<strong id="a-${i}">0</strong></span><span>D<strong id="d-${i}">0</strong></span><span>S<strong id="s-${i}">0</strong></span><span>R<strong id="r-${i}">0</strong></span></div><div class="voice-flags"><span id="gate-${i}">GATE</span><span id="sync-${i}">SYNC</span><span id="ring-${i}">RING</span><span id="test-${i}">TEST</span></div></article>`).join('');
  for(let i=0;i<3;i++){$('mute-'+i).onclick=()=>{muted[i]=!muted[i];solo=-1;sendMute();};$('solo-'+i).onclick=()=>{solo=solo===i?-1:i;sendMute();};}
  const names=['FREQ LO','FREQ HI','PW LO','PW HI','CONTROL','ATT / DEC','SUS / REL'];
  $('register-panel').innerHTML=Array.from({length:25},(_,i)=>`<div class="register" title="${i<21?'Voice '+(Math.floor(i/7)+1)+' '+names[i%7]:['CUTOFF LO','CUTOFF HI','RES / ROUTE','MODE / VOL'][i-21]}"><span>$${(0xd400+i).toString(16).toUpperCase()}</span><strong id="reg-${i}">00</strong></div>`).join('');
}
function noteName(hz){if(hz<1)return '—';const midi=Math.round(69+12*Math.log2(hz/440));return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((midi%12)+12)%12]+(Math.floor(midi/12)-1);}
function waveNames(control){return [[16,'TRIANGLE'],[32,'SAW'],[64,'PULSE'],[128,'NOISE']].filter(([bit])=>control&bit).map(([,name])=>name).join(' + ')||'OSCILLATOR IDLE';}
function updateInspector(){
  const r=snapshot.registers;
  for(let i=0;i<3;i++){
    const o=i*7,control=r[o+4],frequency=(r[o]|r[o+1]<<8)*985248/16777216,pw=r[o+2]|(r[o+3]&15)<<8,pct=pw/4096*100;
    $('note-'+i).textContent=control&128?'NOISE':noteName(frequency);$('hz-'+i).textContent=frequency.toFixed(1)+' Hz';$('wave-'+i).textContent=waveNames(control);$('wave-'+i).title=waveNames(control);
    document.querySelectorAll('.voice-legend span')[i].textContent='0'+(i+1)+' '+waveNames(control).replace('OSCILLATOR IDLE','IDLE');
    $('pw-'+i).textContent=String(pw).padStart(4,'0')+' · '+pct.toFixed(1)+'%';$('pw-bar-'+i).style.width=pct+'%';
    $('env-'+i).textContent=snapshot.envelopes[i]+' / 255';$('env-bar-'+i).style.width=(snapshot.envelopes[i]/255*100)+'%';
    $('a-'+i).textContent=r[o+5]>>4;$('d-'+i).textContent=r[o+5]&15;$('s-'+i).textContent=r[o+6]>>4;$('r-'+i).textContent=r[o+6]&15;
    for(const [name,bit] of [['gate',1],['sync',2],['ring',4],['test',8]])$(name+'-'+i).classList.toggle('on',!!(control&bit));
  }
  const cutoff=(r[21]&7)|(r[22]<<3);
  $('filter-cutoff').replaceChildren(document.createTextNode(String(cutoff).padStart(4,'0')+' '));const suffix=document.createElement('small');suffix.textContent='/ 2047';$('filter-cutoff').append(suffix);
  $('cutoff-fill').style.width=(cutoff/2047*100)+'%';$('filter-resonance').textContent=(r[23]>>4)+' / 15';
  $('filter-mode').textContent=[[16,'Low-pass'],[32,'Band-pass'],[64,'High-pass']].filter(([bit])=>r[24]&bit).map(([,name])=>name).join(' + ')||'Bypassed';
  $('filter-mode').title=$('filter-mode').textContent;
  $('filter-routing').textContent=[0,1,2].filter(i=>r[23]&(1<<i)).map(i=>'0'+(i+1)).join(' · ')||'None';
  for(let i=0;i<25;i++)$('reg-'+i).textContent=r[i].toString(16).padStart(2,'0').toUpperCase();
  const seconds=Math.floor(snapshot.time);$('elapsed').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
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
  for(let i=0;i<3;i++)drawScope($('scope-'+i),snapshot.waves[i],colors[i],mutedNow[i]);
}
async function importFiles(files){
  if(busy){status('Finish loading this tune, then drop your files again.');return;}
  const errors=[],added=[];
  for(const file of files){
    try{if(file.size>65792)throw new Error('File is larger than a SID program.');const buffer=await file.arrayBuffer();const meta=parseSID(buffer,file.name);added.push({buffer,meta,original:false});}
    catch(error){errors.push(file.name+': '+error.message);}
  }
  if(added.length){const first=tracks.length;tracks.push(...added);await selectTrack(first);}
  if(errors.length)status(errors.join(' '),true);
}
$('play').onclick=togglePlay;$('start-button').onclick=togglePlay;$('restart').onclick=restart;$('subtune').onchange=restart;
$('volume').oninput=()=>{const value=Number($('volume').value);$('volume-value').textContent=value+'%';if(gain)gain.gain.setTargetAtTime(value/100,context.currentTime,.02);};
$('model').onchange=()=>node?.port.postMessage({type:'model',value:Number($('model').value)});
$('sid-file').onchange=async event=>{await importFiles(event.target.files);event.target.value='';};
for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{view=button.dataset.view;for(const b of document.querySelectorAll('[data-view]')){b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));}$('register-panel').hidden=view!=='registers';$('main-canvas').hidden=view==='registers';$('visual-caption').textContent=view==='registers'?'$D400–$D418 · HEXADECIMAL':view==='ribbons'?'PHOSPHOR ORBITS · VOICE HISTORY':'OSCILLATOR OUTPUT · PRE-FILTER';$('main-canvas').setAttribute('aria-label',view==='ribbons'?'Audio-driven phosphor orbits with voice history':'Three triggered pre-filter waveform traces');};
$('focus-button').onclick=()=>{const on=document.body.classList.toggle('focus-mode');$('focus-button').setAttribute('aria-pressed',String(on));$('focus-button').textContent=on?'Show the instrument panel ⤡':'Listening mode ⤢';};
$('about-button').onclick=()=>$('about').showModal();$('close-about').onclick=()=>$('about').close();
document.addEventListener('keydown',event=>{if(event.code==='Space'&&!/INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)&&!$('about').open){event.preventDefault();togglePlay();}});
let dragDepth=0;document.addEventListener('dragenter',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dragDepth++;document.body.classList.add('dragging');}});
document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('dragging');}});
document.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;document.body.classList.remove('dragging');if(event.dataTransfer?.files.length)importFiles(event.dataTransfer.files);});
createInspector();updateInspector();requestAnimationFrame(frame);
try{
  const response=await fetch('./music/phosphor-dreams.sid');if(!response.ok)throw new Error('The bundled tune could not be loaded. You can still open your own SID file.');
  const buffer=await response.arrayBuffer();tracks.push({buffer,meta:parseSID(buffer),original:true});await selectTrack(0);
}catch(error){status(error.message,true);}
