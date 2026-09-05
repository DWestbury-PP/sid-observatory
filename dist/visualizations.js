const colors=['#74edcf','#d694fc','#ffb979'];
export function trigger(data){for(let i=1;i<data.length/2;i++)if(data[i-1]<=0&&data[i]>0)return i;return 0;}

export function drawOscilloscope(ctx,w,h,snapshot,muted){
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#233040';ctx.lineWidth=.5;ctx.globalAlpha=.4;
  for(let x=24;x<w;x+=48){ctx.beginPath();ctx.moveTo(x,58);ctx.lineTo(x,h-40);ctx.stroke();}
  for(let y=70;y<h-40;y+=36){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  ctx.globalAlpha=1;
  for(let v=0;v<3;v++){
    const data=snapshot.waves[v],start=trigger(data),length=Math.min(256,data.length-start),center=62+(h-105)*(v+.5)/3;
    ctx.beginPath();ctx.lineWidth=1.5;ctx.strokeStyle=colors[v];ctx.globalAlpha=muted[v]?.13:.95;
    for(let x=0;x<w;x+=2){const sample=data[start+Math.floor(x/w*length)]||0,y=center-sample*(h-110)/7;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}
    ctx.stroke();
  }
  ctx.globalAlpha=1;
}

// An expressive radial mapping of actual pre-filter waveform windows. This is
// intentionally different geometry from a time-domain oscilloscope, even when
// the operating system requests reduced motion.
export function drawPhosphor(ctx,w,h,snapshot,history,muted,reduceMotion=false){
  ctx.clearRect(0,0,w,h);
  const plotHeight=Math.max(50,h-104),centerY=59+plotHeight/2;
  const rx=Math.min(w*.19,plotHeight*1.2),ry=plotHeight*.33;
  const layers=reduceMotion?[snapshot]:history.length?history.slice(-20).filter((_,i)=>i%2===0).concat(snapshot):[snapshot];
  const rotation=reduceMotion?0:snapshot.time*.24;
  ctx.save();
  ctx.beginPath();ctx.rect(0,54,w,plotHeight+8);ctx.clip();
  ctx.globalCompositeOperation='lighter';
  for(let v=0;v<3;v++){
    const centerX=w*(.23+v*.27);
    for(let layer=0;layer<layers.length;layer++){
      const data=layers[layer].waves[v],start=trigger(data),length=Math.min(256,data.length-start);
      const age=layers.length-1-layer,latest=age===0;
      ctx.beginPath();ctx.strokeStyle=colors[v];ctx.lineWidth=latest?1.8:.8;
      ctx.globalAlpha=(muted[v]?.1:1)*(latest?.95:.12*(1-age/layers.length));
      ctx.shadowColor=colors[v];ctx.shadowBlur=latest?16:0;
      for(let step=0;step<=256;step++){
        const fraction=(step%256)/256,sample=data[start+Math.floor(fraction*length)]||0;
        const angle=step/256*Math.PI*2+rotation*(v===1?-1:1)-Math.PI/2;
        const radial=1+sample*.38+age*.013;
        const x=centerX+Math.cos(angle)*rx*radial,y=centerY+Math.sin(angle)*ry*radial;
        step?ctx.lineTo(x,y):ctx.moveTo(x,y);
      }
      ctx.closePath();ctx.stroke();
    }
  }
  ctx.restore();
}
