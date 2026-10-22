const fs=require('fs');
const S='C:/Users/Yhwhy/.dsh';
const dirs=fs.readdirSync(S+'/sessions/--D-DeepSeek-starmap--').filter(d=>d.startsWith('session-')||/^[0-9a-f]{8}-/.test(d));
const cache=new Set(fs.readdirSync(S+'/storages/session_projcache/sessions'));
for(const d of dirs){
  const id=d.replace(/^session-/,'');
  console.log(d, cache.has(id+'.json')?'CACHED':'no-cache');
}
console.log('--- cache files whose id has no dir (starmap only check) ---');

