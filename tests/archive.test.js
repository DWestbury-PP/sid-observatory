import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {hvscUrl,deepsidUrl,shardFor,humanize,formatTime,searchPaths,nodeAt,lengthsIn,hasEnded,nextTrack,describePath} from '../dist/archive.js';
const hvsc=new URL('../dist/hvsc/',import.meta.url);
const json=name=>JSON.parse(readFileSync(new URL(name,hvsc),'utf8'));

test('generated index is pinned, complete and internally consistent',()=>{
  const manifest=json('manifest.json');
  assert.ok(Number.isInteger(manifest.release)&&manifest.release>=85);
  assert.ok(manifest.files>60000);
  const shardNames=Object.entries(manifest.shards).flatMap(([top,seconds])=>seconds.map(second=>`${top}-${second}.json`));
  const present=readdirSync(hvsc).filter(name=>/-.*\.json$/.test(name));
  assert.deepEqual(present.sort(),shardNames.sort());
  const paths=readFileSync(new URL('paths.txt',hvsc),'utf8').trim().split('\n');
  assert.equal(paths.length,manifest.files);
  assert.ok(paths.every(path=>path.startsWith('/')&&path.endsWith('.sid')));
  assert.ok(paths.includes('/MUSICIANS/H/Hubbard_Rob/Commando.sid'));
  // Shards hold exactly the files of paths.txt.
  let counted=0;const count=node=>{counted+=Object.keys(node.files).length;Object.values(node.folders).forEach(count);};
  for(const name of present)count(json(name).tree);
  assert.equal(counted,paths.length);
});
test('shard trees resolve folders and per-subtune lengths for real paths',()=>{
  const shard=json('MUSICIANS-H.json');assert.equal(shard.path,'/MUSICIANS/H');
  const hubbard=nodeAt(shard.tree,['Hubbard_Rob']);assert.ok(hubbard&&Object.keys(hubbard.files).length>30);
  const lengths=lengthsIn(shard.tree,['Hubbard_Rob','Commando.sid']);
  assert.ok(Array.isArray(lengths)&&lengths.length>=19&&Math.abs(lengths[0]-235.6)<.2);
  assert.equal(nodeAt(shard.tree,['Nobody_Here']),null);assert.equal(lengthsIn(shard.tree,['Hubbard_Rob','Missing.sid']),null);
  assert.equal(shardFor('/MUSICIANS/H/Hubbard_Rob/Commando.sid'),'MUSICIANS-H');assert.equal(shardFor('/DEMOS/A-F/Devils_ReSIDence_3SID.sid'),'DEMOS-A-F');assert.equal(shardFor('/'),null);
});
test('starter shelf entries are verified PSID tunes present in the index',()=>{
  const shelf=json('shelf.json');assert.ok(shelf.length>=10);
  const paths=new Set(readFileSync(new URL('paths.txt',hvsc),'utf8').trim().split('\n'));
  for(const entry of shelf){assert.ok(paths.has(entry.path),entry.path);assert.ok(entry.title&&entry.author&&entry.note);assert.ok(entry.lengths.length>=1&&entry.lengths[0]>0);assert.ok([1,2,3].includes(entry.chips));assert.ok(Number.isInteger(entry.start)&&entry.start>=0&&entry.start<entry.lengths.length);}
  assert.ok(shelf.some(e=>e.chips===2)&&shelf.some(e=>e.chips===3));
});
test('URLs, names, times and search behave',()=>{
  assert.equal(hvscUrl('/MUSICIANS/H/Hubbard_Rob/Commando.sid'),'https://hvsc.c64.org/download/C64Music/MUSICIANS/H/Hubbard_Rob/Commando.sid');
  assert.equal(hvscUrl('/MUSICIANS/A/A-Man/Tune #1.sid'),'https://hvsc.c64.org/download/C64Music/MUSICIANS/A/A-Man/Tune%20%231.sid');
  assert.equal(deepsidUrl('/MUSICIANS/H/Hubbard_Rob/Commando.sid'),'https://deepsid.chordian.net/?file=/MUSICIANS/H/Hubbard_Rob/Commando.sid');
  assert.equal(humanize('Monty_on_the_Run.sid'),'Monty on the Run');
  assert.equal(formatTime(235.6),'03:55');assert.equal(formatTime(0),'--:--');assert.equal(formatTime(NaN),'--:--');assert.equal(formatTime(3600),'60:00');
  const paths=['/MUSICIANS/H/Hubbard_Rob/Commando.sid','/MUSICIANS/G/Galway_Martin/Wizball.sid','/GAMES/A-F/Commando_Remix.sid'];
  assert.deepEqual(searchPaths(paths,'hubbard commando'),['/MUSICIANS/H/Hubbard_Rob/Commando.sid']);
  assert.deepEqual(searchPaths(paths,'COMMANDO'),['/MUSICIANS/H/Hubbard_Rob/Commando.sid','/GAMES/A-F/Commando_Remix.sid']);
  assert.deepEqual(searchPaths(paths,'   '),[]);assert.equal(searchPaths(paths,'commando',1).length,1);
  assert.deepEqual(describePath('/MUSICIANS/H/Hubbard_Rob/Commando.sid'),{title:'Commando',composer:'Hubbard Rob',folder:'MUSICIANS/H/Hubbard_Rob'});
  assert.equal(describePath('/DEMOS/A-F/Devils_ReSIDence_3SID.sid').composer,'DEMOS');
});
test('end detection and advancing follow song lengths and collection order',()=>{
  assert.equal(hasEnded(10,0),false);assert.equal(hasEnded(235.5,235.6),false);assert.equal(hasEnded(235.6,235.6),true);assert.equal(hasEnded(5,null),false);
  assert.equal(nextTrack([1,2,3],0),1);assert.equal(nextTrack([1,2,3],2),-1);assert.equal(nextTrack([1,2,3],-1),-1);assert.equal(nextTrack([],0),-1);
});
