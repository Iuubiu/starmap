const fs=require('fs');
const A='C:/Users/Yhwhy/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const fd=fs.openSync(A,'r');
const start=92315000, len=120000;
const b=Buffer.alloc(len); const n=fs.readSync(fd,b,0,len,start); fs.closeSync(fd);
const s=b.slice(0,n).toString('utf8');
process.stdout.write(s);

