const fs=require('fs'), zlib=require('zlib');
function readAll(p){
  const buf=fs.readFileSync(p); const M=4247762216; const out=[]; let off=0;
  while(off<buf.length){
    const start=off; off+=4; const d=buf.readUInt8(off); off+=1;
    const cs=d>>>6, single=(d&32)!==0, chk=(d&4)!==0, df=d&3;
    off += (single?0:1)+(df===3?4:df)+(cs===0?(single?1:0):(1<<cs));
    for(;;){ const bh=buf.readUIntLE(off,3); off+=3; const last=bh&1, ty=(bh>>>1)&3, sz=bh>>>3; off += ty===1?1:sz; if(last) break; }
    if(chk) off+=4; out.push({start,end:off});
  }
  let t=''; for(const f of out) t+=zlib.zstdDecompressSync(buf.subarray(f.start,f.end)).toString('utf8');
  return t.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return {__bad:true}}});
}
const T=readAll('C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd');
const types={}; for(const r of T) types[r.type]=(types[r.type]||0)+1;
console.log(JSON.stringify(types));
const am=T.filter(r=>r.type==='assistant/message').slice(0,3);
for(const r of am){
  const keys=Object.keys(r); console.log('rec keys',keys,'data keys',Object.keys(r.data||{}));
  const m=r.data.message;
  console.log('message type',typeof m);
  if(typeof m==='string') console.log(m.slice(0,600));
  else console.log(JSON.stringify(m).slice(0,600));
  console.log('---');
}

