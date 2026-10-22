const fs=require('fs'), zlib=require('zlib');
function frames(p){
  const buf=fs.readFileSync(p); const M=4247762216; const out=[]; let off=0;
  while(off<buf.length){
    const start=off; off+=4; const d=buf.readUInt8(off); off+=1;
    const cs=d>>>6, single=(d&32)!==0, chk=(d&4)!==0, df=d&3;
    off += (single?0:1)+(df===3?4:df)+(cs===0?(single?1:0):(1<<cs));
    for(;;){ const bh=buf.readUIntLE(off,3); off+=3; const last=bh&1, ty=(bh>>>1)&3, sz=bh>>>3; off += ty===1?1:sz; if(last) break; }
    if(chk) off+=4;
    out.push({start,end:off});
  }
  return {buf,out};
}
function firstLine(p){ const {buf,out}=frames(p); return zlib.zstdDecompressSync(buf.subarray(out[0].start,out[0].end)).toString('utf8').split('\n')[0]; }
const t=firstLine('C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd');
const b=firstLine('D:/DeepSeek/starmap/.scratch/session-backup/session-55c776d2.v4.jsonl.zstd');
console.log('TRIMMED:', t.slice(0,1200));
console.log('BACKUP :', b.slice(0,1200));

