const fs=require('fs');
const S='C:/Users/Yhwhy/.dsh';
const j=JSON.parse(fs.readFileSync(S+'/storages/workspace.json','utf8'));
const t=j.tables.workspaces;
const target='session-55c776d2-6df9-450c-abcf-db3fe6001ef9';
for(const [id,w] of Object.entries(t)){
  console.log('ws',id,JSON.stringify(w.path),w.title,'sessions='+(w.sessionIds||[]).length,'HAS='+((w.sessionIds||[]).includes(target)));
}
console.log('archive has:',(j.global.archivedSessionIds||[]).includes(target));
const pc=S+'/storages/session_projcache/sessions';
const files=fs.readdirSync(pc);
console.log('projcache count',files.length,'target cache exists:',files.includes(target.replace('session-','')+'.json'));

