import { SIDCore } from './vendor/sid-core.js';

const MAX_VOICES = 9;
class SIDProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new SIDCore(sampleRate);
    this.active = false; this.loaded = false; this.frames = 0; this.cursor = 0; this.voices = 3;
    this.traces = Array.from({length:MAX_VOICES}, () => new Float32Array(512));
    this.port.onmessage = ({data}) => {
      try {
        if (data.type === 'load') {
          this.active=false;
          this.core.load(data.buffer,data.meta,data.sub);
          this.voices=this.core.chips()*3;
          this.loaded=true; this.frames=0; this.cursor=0;
          this.traces.forEach(t=>t.fill(0));
          this.sendSnapshot();
          this.port.postMessage({type:'loaded',id:data.id,chips:this.core.chips()});
        } else if (data.type === 'playing') this.active=!!data.value && this.loaded;
        else if (data.type === 'model') this.core.setModel(data.value,data.chip||0);
        else if (data.type === 'mute') this.core.setMuted(data.value);
      } catch(error) {
        this.active=false;
        this.port.postMessage({type:'error',message:error.message,id:data.id});
      }
    };
  }
  sendSnapshot() {
    // Copy a chronological window per active voice; retain ring buffers in the audio thread.
    const waves=this.traces.slice(0,this.voices).map(t=>{const out=new Float32Array(512);for(let i=0;i<512;i++)out[i]=t[(this.cursor+i)&511];return out;});
    this.port.postMessage({type:'snapshot',...this.core.snapshot(),waves},waves.map(w=>w.buffer));
  }
  process(_inputs,outputs) {
    const channel=outputs[0][0];
    if(!this.active) { channel.fill(0); return true; }
    try {
      const voices=this.voices;
      for(let i=0;i<channel.length;i++) {
        const sample=this.core.render();
        if(!Number.isFinite(sample))throw new Error('This tune produced an invalid audio sample.');
        channel[i]=Math.max(-1,Math.min(1,sample));
        for(let v=0;v<voices;v++)this.traces[v][this.cursor]=this.core.samples[v];
        this.cursor=(this.cursor+1)&511;
      }
      this.frames+=channel.length;
      if(this.frames>=sampleRate/50) { this.frames%=sampleRate/50;this.sendSnapshot(); }
    } catch(error) {channel.fill(0);this.active=false;this.port.postMessage({type:'error',message:error.message});}
    return true;
  }
}
registerProcessor('sid-observatory',SIDProcessor);
