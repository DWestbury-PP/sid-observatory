import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSID} from '../dist/sid-format.js';
import {SIDCore} from '../dist/vendor/sid-core.js';
const bytes=readFileSync(new URL('../dist/music/phosphor-dreams.sid',import.meta.url));
const buffer=()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);

test('PSID metadata, explicit and embedded load addresses agree',()=>{
  const original=buffer(),meta=parseSID(original);
  assert.equal(meta.title,'Phosphor dreams');assert.equal(meta.load,0x1000);assert.equal(meta.model,8580);assert.equal(meta.songs,1);
  const embedded=new Uint8Array(original.byteLength+2);embedded.set(new Uint8Array(original).slice(0,124));embedded.set([0,0x10],124);embedded.set(new Uint8Array(original).slice(124),126);embedded[8]=embedded[9]=0;
  const changed=parseSID(embedded.buffer);assert.equal(changed.load,meta.load);assert.equal(changed.offset,126);
  const a=new SIDCore(),b=new SIDCore();a.load(original,meta);b.load(embedded.buffer,changed);
  for(let i=0;i<10000;i++)assert.equal(a.render(),b.render());
});
test('unsupported and malformed formats fail before emulation',()=>{
  for(const mutate of [b=>b[0]=82,b=>b[119]=0x28,b=>{b[14]=b[15]=0;},b=>{b[6]=255;},b=>{b[12]=b[13]=0;}]){const a=buffer();mutate(new Uint8Array(a));assert.throws(()=>parseSID(a));}
  // A v3 header with a second chip is now valid rather than rejected.
  const twin=buffer();const t=new Uint8Array(twin);t[5]=3;t[122]=0x42;assert.equal(parseSID(twin).chips.length,2);
  assert.throws(()=>parseSID(new ArrayBuffer(10)));
});
test('three real voices produce finite output at browser sample rates; restart is deterministic',()=>{
  for(const rate of [44100,48000]){
    const core=new SIDCore(rate),a=buffer();core.load(a,parseSID(a));let energy=0,peak=0;const voiceEnergy=[0,0,0],initial=[];
    for(let i=0;i<rate*2;i++){const sample=core.render();assert.ok(Number.isFinite(sample));if(i<1000)initial.push(sample);energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));core.samples.slice(0,3).forEach((x,v)=>voiceEnergy[v]+=x*x);}
    assert.ok(energy>100&&peak<1);assert.ok(voiceEnergy.every(e=>e>10));assert.ok(Math.abs(core.snapshot().time-2)<.001);
    core.load(a,parseSID(a));for(let i=0;i<initial.length;i++)assert.equal(core.render(),initial[i]);
  }
});
test('muting silences output while chip registers and envelopes continue; chip models differ',()=>{
  const a=buffer(),meta=parseSID(a),core=new SIDCore(),other=new SIDCore();core.load(a,meta);other.load(a,meta);core.setMuted([true,true,true]);
  for(let i=0;i<48000;i++){assert.equal(core.render(),0);other.render();}
  assert.deepEqual(core.snapshot(),other.snapshot());
  core.setMuted([false,false,false]);core.setModel(6581);let diff=0;for(let i=0;i<48000;i++)diff+=Math.abs(core.render()-other.render());assert.ok(diff>1);
});
test('AudioWorklet load/play/pause bridge produces audio and snapshots',async()=>{
  const messages=[];globalThis.sampleRate=48000;
  globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:message=>messages.push(message)};}};
  let Processor;globalThis.registerProcessor=(_name,constructor)=>Processor=constructor;
  await import('../dist/sid-worklet.js');const p=new Processor(),a=buffer();
  p.port.onmessage({data:{type:'load',buffer:a,meta:parseSID(a),sub:0,id:1}});
  assert.ok(messages.some(m=>m.type==='loaded'));p.port.onmessage({data:{type:'playing',value:true}});
  let energy=0;for(let i=0;i<400;i++){const out=new Float32Array(128);p.process([],[[out]]);energy+=out.reduce((sum,x)=>sum+x*x,0);}
  assert.ok(energy>0);assert.ok(messages.filter(m=>m.type==='snapshot').length>40);assert.ok(!messages.some(m=>m.type==='error'));
  p.port.onmessage({data:{type:'playing',value:false}});const out=new Float32Array(128);p.process([],[[out]]);assert.ok(out.every(x=>x===0));
});
