const fs=require('fs'), zlib=require('zlib');
const p='C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd';
const buf=fs.readFileSync(p);
const ZSTD_MAGIC=4247762216;
function scan(buf){
  const frames=[]; let off=0;
  while(off<buf.length){
    const start=off;
    if(buf.length-off<4) return {frames,tornStart:start};
    if(buf.readUInt32LE(off)!==ZSTD_MAGIC) throw new Error('invalid frame magic at byte '+off);
    off+=4;
    if(off===buf.length) return {frames,tornStart:start};
    const d=buf.readUInt8(off); off+=1;
    if((d&24)!==0) throw new Error('reserved frame-header bit at '+off);
    const csFlag=d>>>6, single=(d&32)!==0, checksum=(d&4)!==0, dictFlag=d&3;
    const dictBytes=dictFlag===3?4:dictFlag;
    const csBytes=csFlag===0?(single?1:0):(1<<csFlag);
    const rem=(single?0:1)+dictBytes+csBytes;
    if(buf.length-off<rem) return {frames,tornStart:start};
    off+=rem;
    for(;;){
      if(buf.length-off<3) return {frames,tornStart:start};
      const bh=buf.readUIntLE(off,3); off+=3;
      const last=(bh&1)!==0, type=(bh>>>1)&3, size=bh>>>3;
      if(type===3) throw new Error('reserved block type at '+(off-3));
      const payload=type===1?1:size;
      if(buf.length-off<payload) return {frames,tornStart:start};
      off+=payload;
      if(last) break;
    }
    if(checksum){ if(buf.length-off<4) return {frames,tornStart:start}; off+=4; }
    frames.push({start,end:off});
  }
  return {frames};
}
const res=scan(buf);
console.log('frames',res.frames.length,'tornStart',res.tornStart, 'checksums?');
const descs=res.frames.map(f=>buf.readUInt8(f.start+4));
console.log('descriptors',descs);
let text='';
for(const f of res.frames){ text += zlib.zstdDecompressSync(buf.subarray(f.start,f.end)).toString('utf8'); }
const lines=text.split('\n').filter(l=>l.length);
console.log('lines',lines.length,'bytes',text.length);
let bad=0, first=null, last=null, prevSeq=null, seqBreaks=0;
for(const l of lines){
  let o; try{o=JSON.parse(l);}catch(e){bad++;continue;}
  if(!first) first=o.type;
  last=o.type;
  if(typeof o.seq==='number'){ if(prevSeq!==null && o.seq!==prevSeq+1) seqBreaks++; prevSeq=o.seq; }
}
console.log(JSON.stringify({bad,first,last,prevSeq,seqBreaks}));

