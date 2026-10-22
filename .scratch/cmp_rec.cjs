const fs=require('fs'), zlib=require('zlib');
function readAll(p){
  const buf=fs.readFileSync(p); const M=4247762216; const out=[]; let off=0;
  while(off<buf.length){
    const start=off; off+=4; const d=buf.readUInt8(off); off+=1;
    const cs=d>>>6, single=(d&32)!==0, chk=(d&4)!==0, df=d&3;
    off += (single?0:1)+(df===3?4:df)+(cs===0?(single?1:0):(1<<cs));
    for(;;){ const bh=buf.readUIntLE(off,3); off+=3; const last=bh&1, ty=(bh>>>1)&3, sz=bh>>>3; off += ty===1?1:sz; if(last) break; }
    if(chk) off+=4;
    out.push({start,end:off});
  }
  let t=''; for(const f of out) t+=zlib.zstdDecompressSync(buf.subarray(f.start,f.end)).toString('utf8');
  return t.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return {__bad:l.slice(0,80)}}});
}
const T=readAll('C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd');
const B=readAll('D:/DeepSeek/starmap/.scratch/session-backup/session-55c776d2.v4.jsonl.zstd');
console.log('counts',T.length,B.length);
// find first assistant/message with tool-call in trimmed turns<=10
function sample(arr){
  for(const r of arr){
    if(r.type==='assistant/message'){
      try{ const m=JSON.parse(r.data.message); if(m.content.some(c=>c.type==='tool-call')) return r; }catch(e){}
    }
  }
}
const ts=sample(T), bs=sample(B);
console.log('TRIMMED SEQ', ts.seq, JSON.stringify(ts).slice(0,900));
console.log('BACKUP  SEQ', bs.seq, JSON.stringify(bs).slice(0,900));

