import test from 'node:test';
import assert from 'node:assert/strict';
import {withoutTrack} from '../dist/collection.js';
import {drawOscilloscope,drawPhosphor} from '../dist/visualizations.js';

test('removing a neighboring upload preserves the playing track object',()=>{
  const demo={original:true},a={},b={},tracks=[demo,a,b];
  let result=withoutTrack(tracks,2,1);
  assert.equal(result.activeRemoved,false);assert.equal(result.tracks[result.current],b);
  result=withoutTrack(tracks,1,2);
  assert.equal(result.activeRemoved,false);assert.equal(result.tracks[result.current],a);
  assert.equal(tracks.length,3);assert.equal(withoutTrack(tracks,0,0),null);
});
test('removing the selected upload selects a neighbor or returns an empty collection',()=>{
  const demo={original:true},a={},b={};
  let result=withoutTrack([demo,a,b],1,1);
  assert.equal(result.activeRemoved,true);assert.equal(result.tracks[result.current],b);
  result=withoutTrack([demo,a],1,1);assert.equal(result.tracks[result.current],demo);
  result=withoutTrack([a],0,0);assert.equal(result.current,-1);assert.deepEqual(result.tracks,[]);
});
function recordingContext(){
  const paths=[];let path=[];
  return {paths,clearRect(){},save(){},restore(){},rect(){},clip(){},beginPath(){path=[];},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},closePath(){path.closed=true;},stroke(){paths.push(path);}};
}
const snapshot={time:10,waves:Array.from({length:3},(_,v)=>Float32Array.from({length:512},(_,i)=>Math.sin(i*.05*(v+1))*.7))};
test('Phosphor remains radial and distinct from scope with reduced motion enabled',()=>{
  for(const [w,h] of [[360,220],[1200,180],[1200,390]]){
    const scope=recordingContext(),phosphor=recordingContext();
    drawOscilloscope(scope,w,h,snapshot,[false,false,false]);
    drawPhosphor(phosphor,w,h,snapshot,[],[false,false,false],true);
    assert.equal(phosphor.paths.length,3);assert.ok(phosphor.paths.every(path=>path.closed));
    assert.ok(scope.paths.every(path=>!path.closed));
    for(const path of [...scope.paths,...phosphor.paths])for(const point of path)assert.ok(point.every(Number.isFinite));
  }
});
test('Phosphor renders actual signal history; pause time keeps orbit geometry stable',()=>{
  const first=recordingContext(),again=recordingContext();
  const history=Array.from({length:20},()=>snapshot);
  drawPhosphor(first,1000,324,snapshot,history,[false,false,false]);
  drawPhosphor(again,1000,324,snapshot,history,[false,false,false]);
  assert.ok(first.paths.length>3);assert.deepEqual(first.paths,again.paths);
});
