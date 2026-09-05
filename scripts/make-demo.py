"""Assemble a small original three-voice PSID study with no external music assets."""
from pathlib import Path
import struct, math
root=Path(__file__).resolve().parents[1]
code=bytearray(); labels={}; fixes=[]; base=0x1000
def emit(*values): code.extend(values)
def label(name): labels[name]=base+len(code)
def lda(value): emit(0xA9,value)
def sta(addr): emit(0x8D,addr&255,addr>>8)
def table(name): emit(0xBD,0,0); fixes.append((len(code)-2,name))
label('init')
emit(0xA2,0x18); lda(0)
label('clear'); emit(0x9D,0,0xD4,0xCA,0x10,0xFA)
sta(0xFB)
for reg,value in [(0xD405,0x08),(0xD406,0x98),(0xD40C,0x09),(0xD40D,0xA8),(0xD413,0x04),(0xD414,0x04),(0xD402,0),(0xD403,8),(0xD417,0x53),(0xD418,0x1F)]: lda(value);sta(reg)
emit(0x60)
label('play'); emit(0xE6,0xFB,0xA5,0xFB,0x29,7)
emit(0xC9,6,0xD0,10); lda(0x40);sta(0xD404);lda(0x10);sta(0xD40B)
emit(0xA5,0xFB,0x29,7,0xD0,0); skip=len(code)-1
emit(0xA5,0xFB,0x4A,0x4A,0x4A,0xAA)
table('leadlo');sta(0xD400);table('leadhi');sta(0xD401)
table('basslo');sta(0xD407);table('basshi');sta(0xD408)
lda(0x41);sta(0xD404);lda(0x11);sta(0xD40B)
code[skip]=(len(code)-skip-1)&255
emit(0xA5,0xFB,0x29,0x0F,0xD0,0); drumskip=len(code)-1
lda(0x81);sta(0xD412);lda(0x60);sta(0xD40F);lda(0x04);sta(0xD414)
code[drumskip]=(len(code)-drumskip-1)&255
emit(0xA5,0xFB,0x29,0x0F,0xC9,2,0xD0,5);lda(0x80);sta(0xD412)
# Slow filter sweep and pulse-width modulation.
emit(0xA5,0xFB);sta(0xD402);emit(0x4A,0x18,0x69,0x30);sta(0xD416);emit(0x60)
lead=[64,67,71,76,71,67,64,62,60,64,67,72,67,64,60,62,57,60,64,69,64,60,57,59,59,62,66,71,69,66,62,59]
bass=[40]*8+[36]*8+[33]*8+[35]*8
def freq(n): return round(440*2**((n-69)/12)*16777216/985248)
for name,notes,high in [('leadlo',lead,False),('leadhi',lead,True),('basslo',bass,False),('basshi',bass,True)]:
 label(name)
 for note in notes: emit((freq(note)>>8)&255 if high else freq(note)&255)
for pos,name in fixes: code[pos:pos+2]=struct.pack('<H',labels[name])
header=bytearray(124);header[:4]=b'PSID'
for off,value in [(4,2),(6,124),(8,base),(10,labels['init']),(12,labels['play']),(14,1),(16,1),(118,0x24)]:header[off:off+2]=struct.pack('>H',value)
for off,text in [(22,'Phosphor dreams'),(54,'SID Observatory'),(86,'2026 - original procedural study')]:header[off:off+len(text)]=text.encode('ascii')
(root/'dist/music').mkdir(exist_ok=True)
(root/'dist/music/phosphor-dreams.sid').write_bytes(header+code)
print('Original PSID generated:',len(header+code),'bytes; play at',hex(labels['play']))
