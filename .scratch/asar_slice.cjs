const fs=require('fs');
const A='C:/Users/Yhwhy/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const fd=fs.openSync(A,'r');
function slice(start,len){const b=Buffer.alloc(len);const n=fs.readSync(fd,b,0,len,start);return b.slice(0,n).toString('latin1');}
const s=slice(92100000, 400000);
// find session store related keywords
for(const kw of ['jsonl.zstd','decodeFrame','for await (const frame','flushInto','appendLine']){
  let i=-1, count=0;
  while((i=s.indexOf(kw,i+1))!==-1 && count<6){console.log('--- kw',kw,'at',92100000+i); console.log(s.slice(Math.max(0,i-400), i+600).replace(/\n/g,'\n')); count++;}
}
fs.closeSync(fd);

