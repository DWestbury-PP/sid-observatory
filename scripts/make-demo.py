"""Assemble small original three-voice PSID studies used as test fixtures (no external music assets).

Two files are produced: the single-chip study `phosphor-dreams.sid` (PSID v2) and a
three-chip canon `phosphor-dreams-3sid.sid` (PSID v4, chips at $D400/$D420/$D440
with mixed 8580/6581/8580 models) that exercises the nine-voice inspector.
"""
from pathlib import Path
import struct, math
root=Path(__file__).resolve().parents[1]
BASE=0x1000

def freq(n): return round(440*2**((n-69)/12)*16777216/985248)
LEAD=[64,67,71,76,71,67,64,62,60,64,67,72,67,64,60,62,57,60,64,69,64,60,57,59,59,62,66,71,69,66,62,59]
BASS=[40]*8+[36]*8+[33]*8+[35]*8

class Assembler:
    def __init__(self):
        self.code=bytearray(); self.labels={}; self.fixes=[]
    def here(self): return BASE+len(self.code)
    def emit(self,*values): self.code.extend(values)
    def label(self,name): self.labels[name]=self.here()
    def lda(self,value): self.emit(0xA9,value)
    def sta(self,addr): self.emit(0x8D,addr&255,addr>>8)
    def jsr(self,name): self.emit(0x20,0,0); self.fixes.append((len(self.code)-2,name))
    def table(self,name): self.emit(0xBD,0,0); self.fixes.append((len(self.code)-2,name))
    def resolve(self):
        for pos,name in self.fixes: self.code[pos:pos+2]=struct.pack('<H',self.labels[name])
        return bytes(self.code)

def voice_routine(asm,tag,sid,zp,transpose=0,lead_wave=0x41,drums=True,start=0):
    """One chip's init/play pair plus note tables. `sid` is the chip base ($D400...).
    Chips without drums give voice 3 a ring-modulated triangle pad that follows the lead."""
    reg=lambda offset: sid+offset
    asm.label(tag+'init')
    asm.emit(0xA2,0x18); asm.lda(0)
    clear=asm.here(); asm.emit(0x9D,sid&255,sid>>8,0xCA,0x10,0xFA)
    asm.lda(start) if start else None
    asm.sta(zp)
    # Voice 3 is a percussive noise voice with drums; the pad variant sustains instead.
    for off,value in [(0x05,0x08),(0x06,0x98),(0x0C,0x09),(0x0D,0xA8),(0x13,0x04 if drums else 0x2A),(0x14,0x04 if drums else 0xA6),(0x02,0),(0x03,8),(0x17,0x53),(0x18,0x1F)]: asm.lda(value);asm.sta(reg(off))
    asm.emit(0x60)
    asm.label(tag+'play'); asm.emit(0xE6,zp,0xA5,zp,0x29,7)
    asm.emit(0xC9,6,0xD0,10); asm.lda(lead_wave&0xFE);asm.sta(reg(0x04));asm.lda(0x10);asm.sta(reg(0x0B))
    asm.emit(0xA5,zp,0x29,7,0xD0,0); skip=len(asm.code)-1
    asm.emit(0xA5,zp,0x4A,0x4A,0x4A,0xAA)
    asm.table(tag+'leadlo');asm.sta(reg(0x00));asm.table(tag+'leadhi');asm.sta(reg(0x01))
    asm.table(tag+'basslo');asm.sta(reg(0x07));asm.table(tag+'basshi');asm.sta(reg(0x08))
    asm.lda(lead_wave);asm.sta(reg(0x04));asm.lda(0x11);asm.sta(reg(0x0B))
    asm.code[skip]=(len(asm.code)-skip-1)&255
    if drums:
        asm.emit(0xA5,zp,0x29,0x0F,0xD0,0); drumskip=len(asm.code)-1
        asm.lda(0x81);asm.sta(reg(0x12));asm.lda(0x60);asm.sta(reg(0x0F));asm.lda(0x04);asm.sta(reg(0x14))
        asm.code[drumskip]=(len(asm.code)-drumskip-1)&255
        asm.emit(0xA5,zp,0x29,0x0F,0xC9,2,0xD0,5);asm.lda(0x80);asm.sta(reg(0x12))
    else:
        asm.emit(0xA5,zp,0x4A,0x4A,0x4A,0xAA)
        asm.table(tag+'leadlo');asm.sta(reg(0x0E));asm.table(tag+'leadhi');asm.sta(reg(0x0F))
        asm.lda(0x15);asm.sta(reg(0x12))
    # Slow filter sweep and pulse-width modulation.
    asm.emit(0xA5,zp);asm.sta(reg(0x02));asm.emit(0x4A,0x18,0x69,0x30);asm.sta(reg(0x16));asm.emit(0x60)
    for name,notes,high in [('leadlo',LEAD,False),('leadhi',LEAD,True),('basslo',BASS,False),('basshi',BASS,True)]:
        asm.label(tag+name)
        for note in notes:
            f=freq(note+transpose); asm.emit((f>>8)&255 if high else f&255)

def header(version,init,play,flags,title,released,extra=b''):
    size=124
    h=bytearray(size);h[:4]=b'PSID'
    for off,value in [(4,version),(6,size),(8,BASE),(10,init),(12,play),(14,1),(16,1),(118,flags)]:h[off:off+2]=struct.pack('>H',value)
    for off,text in [(22,title),(54,'SID Observatory'),(86,released)]:h[off:off+len(text)]=text.encode('ascii')
    h[122:122+len(extra)]=extra
    return h

(root/'tests/music').mkdir(exist_ok=True)

# Single-chip study: identical routine to the first pressing.
asm=Assembler(); voice_routine(asm,'',0xD400,0xFB)
code=asm.resolve()
single=header(2,asm.labels['init'],asm.labels['play'],0x24,'Phosphor dreams','2026 - original procedural study')+code
(root/'tests/music/phosphor-dreams.sid').write_bytes(single)
print('Original PSID generated:',len(single),'bytes; play at',hex(asm.labels['play']))

# Three-chip canon: chip 2 answers a fifth up on a sawtooth one bar later,
# chip 3 an octave down on a triangle two bars later. Only chip 1 carries drums.
asm=Assembler()
asm.label('init'); asm.jsr('ainit'); asm.jsr('binit'); asm.jsr('cinit'); asm.emit(0x60)
asm.label('play'); asm.jsr('aplay'); asm.jsr('bplay'); asm.jsr('cplay'); asm.emit(0x60)
voice_routine(asm,'a',0xD400,0xFB)
voice_routine(asm,'b',0xD420,0xFC,transpose=7,lead_wave=0x21,drums=False,start=64)
voice_routine(asm,'c',0xD440,0xFD,transpose=-12,lead_wave=0x11,drums=False,start=128)
code=asm.resolve()
# Flags: PAL, SID1 8580, SID2 6581, SID3 8580. Extra SIDs at $D420 and $D440.
triple=header(4,asm.labels['init'],asm.labels['play'],0x04|0x20|0x40|0x200,'Phosphor dreams 3SID','2026 - original 3SID canon',bytes([0x42,0x44]))+code
(root/'tests/music/phosphor-dreams-3sid.sid').write_bytes(triple)
print('Original 3SID PSID generated:',len(triple),'bytes; play at',hex(asm.labels['play']))
