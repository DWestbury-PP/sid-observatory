"""Reproducible AudioWorklet/instrumentation patch of Hermit's jsSID 0.9.1.
Upstream source remains unchanged under dist/vendor/jssid.js.
"""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
source = (root/'dist/vendor/jssid.js').read_text()
start = source.index('var CLK=')
body = source[start:]
# Declare upstream implicit globals so the core can run as a strict ES module.
body = body.replace('endcallback=null,playtime=0,ended=0;', 'var endcallback=null,playtime=0,ended=0;')
# Source has an ENV3 indexing typo; third voice is index 2 for chip zero.
body = body.replace('M[SIDaddr+0x1C]=envcnt[3]', 'M[SIDaddr+0x1C]=envcnt[num*3+2]')
body = body.replace('if(M[SIDaddr+0x17]&FSW[chn])flin+=', 'voiceSample[chn]=(wfout-0x8000)*(envcnt[chn]/256)/32768;if(muted[chn])continue;if(M[SIDaddr+0x17]&FSW[chn])flin+=')
# Enforce bounded init and per-play execution for malformed program code.
body = body.replace('if(tmod[subtune]||M[0xDC05])', 'if(tout<0)throw new Error("SID init routine exceeded the instruction budget.");if(tmod[subtune]||M[0xDC05])')
body = body.replace('fcnt=fspd;fin=0;PC=pla;', 'fcnt=fspd;fin=0;frameInstructions=0;PC=pla;')
body = body.replace('pPC=PC;if(CPU()', 'if(++frameInstructions>100000)throw new Error("SID play routine exceeded the instruction budget.");pPC=PC;if(CPU()')
body = body.replace('M[1]=0x37;M[0xDC05]=0;', 'M[1]=0x37;M[0x02A6]=1;M[0xDC05]=0;')
# Upstream parses per-chip models into prSIDm but filters and combined waveforms read the global SIDm.
body = body.replace('if(SIDm==8580.0){ctf=', 'if(prSIDm[num]==8580.0){ctf=')
body = body.replace('if(differ6581&&SIDm==6581.0)index&=0x7FF;', 'if(differ6581&&prSIDm[(chn/CHA)|0]==6581.0)index&=0x7FF;')
api = '''
// Adapted by SID Observatory, 2026. Audio scheduling is owned by AudioWorklet.
// Up to three chips (PSID v3/v4): nine voices, one filter per chip, per-chip model.
export function SIDCore(smpr=48000) {
  const bgnoi=0;
  var trsaw,pusaw,Pulsetrsaw;
  let frameInstructions=0;
  const muted=Array(9).fill(false), voiceSample=new Float32Array(9);
  this.render=()=>play();
  this.samples=voiceSample;
  this.chips=()=>SIDamount;
  this.setMuted=values=>{for(let i=0;i<9;i++)muted[i]=!!values[i];};
  this.setModel=(value,chip=0)=>{if(chip>=0&&chip<3)prSIDm[chip]=value===6581?6581:8580;};
  this.snapshot=()=>({chips:SIDamount,registers:SID_address.slice(0,SIDamount).map(a=>Array.from(M.slice(a,a+0x19))),envelopes:envcnt.slice(0,SIDamount*3),time:playtime});
  this.load=(buffer,meta,sub=meta.start)=>{
    const bytes=new Uint8Array(buffer),chips=meta.chips||[{address:0xD400,model:meta.model}];
    ldd=0; ind=0; M.fill(0); initSID();
    M.set(bytes.subarray(meta.offset),meta.load);
    ina=meta.init; pla=plf=meta.play;
    SID_address[1]=chips[1]?chips[1].address:0; SID_address[2]=chips[2]?chips[2].address:0;
    SIDamount=1+(SID_address[1]>0)+(SID_address[2]>0);
    for(let i=0;i<3;i++)prSIDm[i]=chips[i]&&chips[i].model===6581?6581:8580;
    for(let i=0;i<32;i++)tmod[i]=(meta.speed>>>i)&1;
    // Tunes 33+ inherit speed bit 31.
    if(sub>=32)tmod[sub]=tmod[31];
    pacc.fill(0);pracc.fill(0);nLFSR.fill(0x7FFFF8);prevwfout.fill(0);pwv.fill(0);plp.fill(0);pbp.fill(0);sMSB.fill(0);sMSBrise.fill(0);voiceSample.fill(0);
    ldd=1; init(sub);
  };
'''
(root/'dist/vendor/sid-core.js').write_text(api+body)
print('Adapted SID core generated.')
