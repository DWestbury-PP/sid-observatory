import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSID,sidAddress} from '../dist/sid-format.js';
import {SIDCore} from '../dist/vendor/sid-core.js';
const load=name=>{const bytes=readFileSync(new URL('../dist/music/'+name,import.meta.url));return ()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);};
const triple=load('phosphor-dreams-3sid.sid'),single=load('phosphor-dreams.sid');
const energies=(core,seconds,rate=48000)=>{const e=new Float64Array(9);for(let i=0;i<rate*seconds;i++){const s=core.render();assert.ok(Number.isFinite(s));core.samples.forEach((x,v)=>e[v]+=x*x);}return Array.from(e);};

test('PSID v4 header yields three chips with per-chip addresses and models',()=>{
  const meta=parseSID(triple());
  assert.equal(meta.version,4);assert.equal(meta.title,'Phosphor dreams 3SID');
  assert.deepEqual(meta.chips,[{address:0xD400,model:8580},{address:0xD420,model:6581},{address:0xD440,model:8580}]);
  assert.equal(meta.model,8580);assert.deepEqual(parseSID(single()).chips,[{address:0xD400,model:8580}]);
});
test('extra SID address bytes follow the specification: odd and reserved values mean no chip',()=>{
  for(const [byte,expected] of [[0,0],[0x42,0xD420],[0x43,0],[0x41,0],[0x7E,0xD7E0],[0x80,0],[0xDE,0],[0xE0,0xDE00],[0xFE,0xDFE0],[0xFF,0]])assert.equal(sidAddress(byte),expected);
  const variant=(second,third,flags)=>{const a=triple();const b=new Uint8Array(a);b[122]=second;b[123]=third;if(flags!==undefined){b[118]=flags>>8;b[119]=flags&255;}return parseSID(a);};
  assert.equal(variant(0x43,0x44).chips.length,1,'third is ignored without a second');
  assert.equal(variant(0x42,0x42).chips.length,2,'third cannot share the second address');
  assert.equal(variant(0x42,0x45).chips.length,2);
  assert.deepEqual(variant(0x50,0xE2).chips.map(c=>c.address),[0xD400,0xD500,0xDE20]);
  // Unknown model bits for chips 2 and 3 inherit chip 1.
  assert.deepEqual(variant(0x42,0x44,0x14).chips.map(c=>c.model),[6581,6581,6581]);
  assert.deepEqual(variant(0x42,0x44,0x24|0x80).chips.map(c=>c.model),[8580,8580,8580]);
  assert.deepEqual(variant(0x42,0x44,0x24|0x40|0x100).chips.map(c=>c.model),[8580,6581,6581]);
  // A v3 header never has a third chip, and a v2 header has neither.
  const v3=triple();new DataView(v3).setUint16(4,3);assert.equal(parseSID(v3).chips.length,2);
  const v2=triple();new DataView(v2).setUint16(4,2);assert.equal(parseSID(v2).chips.length,1);
});
test('all nine voices of a 3SID tune render, with independent register blocks per chip',()=>{
  const a=triple(),meta=parseSID(a),core=new SIDCore(48000);core.load(a,meta);
  const energy=energies(core,6);
  assert.ok(energy.every(e=>e>10),'every voice carries signal: '+energy.map(Math.round).join(' '));
  const snap=core.snapshot();
  assert.equal(snap.chips,3);assert.equal(snap.registers.length,3);assert.equal(snap.envelopes.length,9);
  assert.ok(snap.registers.every(block=>block.length===25));
  const freq=block=>block[0]|block[1]<<8;
  assert.notEqual(freq(snap.registers[0]),freq(snap.registers[1]));assert.notEqual(freq(snap.registers[0]),freq(snap.registers[2]));
  // A single-chip tune leaves the other trace slots silent.
  const b=single(),one=new SIDCore(48000);one.load(b,parseSID(b));
  const oneEnergy=energies(one,1);assert.ok(oneEnergy.slice(0,3).every(e=>e>1)&&oneEnergy.slice(3).every(e=>e===0));
  assert.equal(one.snapshot().chips,1);assert.equal(one.snapshot().registers.length,1);
});
test('muting spans nine voices and chip models apply per chip',()=>{
  const a=triple(),meta=parseSID(a);
  const muted=new SIDCore(),open=new SIDCore();muted.load(a,meta);open.load(a,meta);
  muted.setMuted(Array(9).fill(true));
  for(let i=0;i<48000;i++){assert.equal(muted.render(),0);open.render();}
  assert.deepEqual(muted.snapshot(),open.snapshot());
  // Muting only chips 2 and 3 leaves chip 1 audible.
  muted.setMuted([false,false,false,true,true,true,true,true,true]);
  let energy=0;for(let i=0;i<48000;i++){const s=muted.render();energy+=s*s;}assert.ok(energy>1);
  const base=new SIDCore(),other=new SIDCore();base.load(a,meta);other.load(a,meta);
  other.setModel(6581,2);
  let diff=0;for(let i=0;i<48000;i++)diff+=Math.abs(base.render()-other.render());assert.ok(diff>1,'chip 3 model changes output');
  const same=new SIDCore(),alsoSame=new SIDCore();same.load(a,meta);alsoSame.load(a,meta);
  alsoSame.setModel(6581,7);
  for(let i=0;i<24000;i++)assert.equal(same.render(),alsoSame.render());
});
test('worklet bridge reports chip count and streams nine traces',async()=>{
  const messages=[];globalThis.sampleRate=48000;
  globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:message=>messages.push(message)};}};
  let Processor;globalThis.registerProcessor=(_name,constructor)=>Processor=constructor;
  await import('../dist/sid-worklet.js');const p=new Processor(),a=triple();
  p.port.onmessage({data:{type:'load',buffer:a,meta:parseSID(a),sub:0,id:7}});
  const loaded=messages.find(m=>m.type==='loaded');assert.equal(loaded.chips,3);
  p.port.onmessage({data:{type:'model',chip:1,value:8580}});p.port.onmessage({data:{type:'playing',value:true}});
  for(let i=0;i<400;i++)p.process([],[[new Float32Array(128)]]);
  const snapshots=messages.filter(m=>m.type==='snapshot');
  assert.ok(snapshots.length>40);assert.ok(snapshots.every(s=>s.waves.length===9&&s.registers.length===3&&s.chips===3));
  for(let v=0;v<9;v++)assert.ok(snapshots.some(s=>s.waves[v].some(x=>x!==0)),'voice '+v+' appears in the traces');
  const b=single();p.port.onmessage({data:{type:'load',buffer:b,meta:parseSID(b),sub:0,id:8}});
  assert.equal(messages.filter(m=>m.type==='loaded').at(-1).chips,1);assert.equal(messages.filter(m=>m.type==='snapshot').at(-1).waves.length,3);
  assert.ok(!messages.some(m=>m.type==='error'));
});
