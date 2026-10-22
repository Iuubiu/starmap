const fs=require('fs');
const A='C:/Users/Yhwhy/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
const fd=fs.openSync(A,'r');
function dump(start,len,out){const b=Buffer.alloc(len);const n=fs.readSync(fd,b,0,len,start);fs.writeFileSync(out,b.slice(0,n));}
dump(92297000,60000,'.scratch/seg_frames.txt');
dump(93039000,40000,'.scratch/seg_list.txt');
fs.closeSync(fd);
console.log('ok');

