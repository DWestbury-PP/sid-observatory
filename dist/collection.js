// Removing a neighboring tune preserves the selected object and playback state.
export function withoutTrack(tracks,current,index){
  if(!Number.isInteger(index)||index<0||index>=tracks.length||tracks[index].original)return null;
  const next=tracks.filter((_,i)=>i!==index),activeRemoved=index===current;
  return {tracks:next,activeRemoved,current:!next.length?-1:activeRemoved?Math.min(index,next.length-1):current>index?current-1:current};
}
