const fs=require('fs');
function frames(p){
  const b=fs.readFileSync(p);
  const magic=Buffer.from([0x28,0xb5,0x2f,0xfd]);
  let c=0,i=0;
  while((i=b.indexOf(magic,i))!==-1){c++;i+=4;}
  return {bytes:b.length,frames:c};
}
const S='C:/Users/Yhwhy/.dsh/sessions/--D-DeepSeek-starmap--';
console.log('trimmed', JSON.stringify(frames(S+'/session-55c776d2-6df9-450c-abcf-db3fe6001ef9/session.v4.jsonl.zstd')));
console.log('backup ', JSON.stringify(frames('D:/DeepSeek/starmap/.scratch/session-backup/session-55c776d2.v4.jsonl.zstd')));
for(const d of ['session-9d6c9179-0b13-44d8-8782-b9e054865526','session-44f94f9f-c3e0-4c82-a89e-1c22e5e3caa7','session-c99ef04b-f82a-4d69-93fd-467423849ee9']){
  const dir=S+'/'+d;
  console.log(d, fs.readdirSync(dir).join(','), (()=>{try{return JSON.stringify(frames(dir+'/session.v4.jsonl.zstd'))}catch(e){return 'no v4'}})());
}

