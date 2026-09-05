// Archive helpers: pure functions over HVSC paths and the generated index.
// Tunes are streamed from HVSC into the browser on request; nothing is stored.
export const HVSC_BASE='https://hvsc.c64.org/download/C64Music';
export const hvscUrl=path=>HVSC_BASE+path.split('/').map(encodeURIComponent).join('/');
export const deepsidUrl=path=>'https://deepsid.chordian.net/?file='+encodeURI(path);
// Shards are named after the first two path segments: /MUSICIANS/H/... -> MUSICIANS-H.
export function shardFor(path){const [,top,second]=path.split('/');return top&&second?top+'-'+second:null;}
export const humanize=name=>name.replace(/\.sid$/i,'').replace(/_/g,' ');
export function formatTime(seconds){if(!(seconds>0)||!Number.isFinite(seconds))return '--:--';const whole=Math.floor(seconds);return String(Math.floor(whole/60)).padStart(2,'0')+':'+String(whole%60).padStart(2,'0');}
// Every whitespace-separated token must appear somewhere in the humanized path.
export function searchPaths(paths,query,limit=120){
  const tokens=query.toLowerCase().split(/\s+/).filter(Boolean);if(!tokens.length)return [];
  const results=[];
  for(const path of paths){const text=path.toLowerCase().replace(/_/g,' ');if(tokens.every(token=>text.includes(token))){results.push(path);if(results.length>=limit)break;}}
  return results;
}
// Walk a shard tree to the folder that contains the given remaining segments.
export function nodeAt(tree,segments){let node=tree;for(const segment of segments){node=node?.folders?.[segment];if(!node)return null;}return node;}
export function lengthsIn(tree,segments){const node=nodeAt(tree,segments.slice(0,-1));return node?.files?.[segments.at(-1)]||null;}
// A tune has ended when the song-length database knows its length and playback has reached it.
export const hasEnded=(time,length)=>length>0&&time>=length;
export const nextTrack=(tracks,current)=>current>=0&&current+1<tracks.length?current+1:-1;
// Split "/MUSICIANS/H/Hubbard_Rob/Commando.sid" into a display composer and title; a _2SID/_3SID
// filename suffix becomes the chip count rather than part of the title.
export function describePath(path){const parts=path.split('/').filter(Boolean);const file=parts.at(-1)||'';const folder=parts.length>3?parts[parts.length-2]:parts[0];const chips=/_3SID\.sid$/i.test(file)?3:/_2SID\.sid$/i.test(file)?2:1;return {title:humanize(file).replace(/\s[23]SID$/i,''),composer:humanize(folder),folder:parts.slice(0,-1).join('/'),chips};}
