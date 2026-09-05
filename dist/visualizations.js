// Voice hue is fixed per voice position (1, 2, 3) on every chip; the chip is
// conveyed by placement: card row, oscilloscope band, phosphor ring depth.
export const colors=['#74edcf','#d694fc','#ffb979'];
export const voiceColor=v=>colors[v%3];
export function trigger(data){for(let i=1;i<data.length/2;i++)if(data[i-1]<=0&&data[i]>0)return i;return 0;}

export function drawOscilloscope(ctx,w,h,snapshot,muted){
  ctx.clearRect(0,0,w,h);
  const voices=snapshot.waves.length,chips=Math.max(1,Math.ceil(voices/3));
  ctx.strokeStyle='#233040';ctx.lineWidth=.5;ctx.globalAlpha=.4;
  for(let x=24;x<w;x+=48){ctx.beginPath();ctx.moveTo(x,58);ctx.lineTo(x,h-40);ctx.stroke();}
  for(let y=70;y<h-40;y+=36){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  ctx.globalAlpha=1;
  // Each chip owns a horizontal band; its three traces stack inside it.
  const top=62,plot=h-105,gap=chips>1?10:0,band=(plot-gap*(chips-1))/chips;
  for(let v=0;v<voices;v++){
    const chip=Math.floor(v/3),data=snapshot.waves[v],start=trigger(data),length=Math.min(256,data.length-start);
    const center=top+chip*(band+gap)+band*((v%3)+.5)/3,amplitude=band/7;
    ctx.beginPath();ctx.lineWidth=chips>1?1.2:1.5;ctx.strokeStyle=voiceColor(v);ctx.globalAlpha=muted[v]?.13:.95;
    for(let x=0;x<w;x+=2){const sample=data[start+Math.floor(x/w*length)]||0,y=center-sample*amplitude;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}
    ctx.stroke();
  }
  if(chips>1){ctx.globalAlpha=.5;ctx.strokeStyle='#3a475a';ctx.lineWidth=.6;for(let c=1;c<chips;c++){const y=top+c*(band+gap)-gap/2;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}}
  ctx.globalAlpha=1;
}

// An expressive radial mapping of actual pre-filter waveform windows. This is
// intentionally different geometry from a time-domain oscilloscope, even when
// the operating system requests reduced motion. Extra chips nest inside the
// first chip's three orbits as smaller rings: chip 1 outside, chip 3 innermost.
export function drawPhosphor(ctx,w,h,snapshot,history,muted,reduceMotion=false){
  ctx.clearRect(0,0,w,h);
  const voices=snapshot.waves.length,chips=Math.max(1,Math.ceil(voices/3));
  const plotHeight=Math.max(50,h-104),centerY=59+plotHeight/2;
  const rx=Math.min(w*.19,plotHeight*1.2),ry=plotHeight*.33;
  const layers=reduceMotion?[snapshot]:history.length?history.slice(-20).filter((_,i)=>i%2===0).concat(snapshot):[snapshot];
  const rotation=reduceMotion?0:snapshot.time*.24;
  const scales=[1,.62,.3];
  ctx.save();
  ctx.beginPath();ctx.rect(0,54,w,plotHeight+8);ctx.clip();
  ctx.globalCompositeOperation='lighter';
  for(let v=0;v<voices;v++){
    const chip=Math.floor(v/3),voice=v%3,scale=chips>1?scales[chip]:1,centerX=w*(.23+voice*.27);
    for(let layer=0;layer<layers.length;layer++){
      const data=layers[layer].waves[v]||snapshot.waves[v],start=trigger(data),length=Math.min(256,data.length-start);
      const age=layers.length-1-layer,latest=age===0;
      ctx.beginPath();ctx.strokeStyle=voiceColor(v);ctx.lineWidth=latest?(chip?1.3:1.8):.8;
      ctx.globalAlpha=(muted[v]?.1:1)*(latest?.95:.12*(1-age/layers.length));
      ctx.shadowColor=voiceColor(v);ctx.shadowBlur=latest?16:0;
      for(let step=0;step<=256;step++){
        const fraction=(step%256)/256,sample=data[start+Math.floor(fraction*length)]||0;
        const angle=step/256*Math.PI*2+rotation*((voice+chip)%2?-1:1)-Math.PI/2;
        const radial=(1+sample*.38+age*.013)*scale;
        const x=centerX+Math.cos(angle)*rx*radial,y=centerY+Math.sin(angle)*ry*radial;
        step?ctx.lineTo(x,y):ctx.moveTo(x,y);
      }
      ctx.closePath();ctx.stroke();
    }
  }
  ctx.restore();
}
