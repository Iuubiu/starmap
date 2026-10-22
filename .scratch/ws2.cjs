const fs=require('fs');
const j=JSON.parse(fs.readFileSync('C:/Users/Yhwhy/.dsh/storages/workspace.json','utf8'));
console.log('tables:',Object.keys(j.tables));
for(const [k,v] of Object.entries(j.tables)){
  const keys=Object.keys(v||{});
  console.log('--',k,keys.length, 'sample:', JSON.stringify(v[keys[0]]||{}).slice(0,300));
}
const ws=j.tables.workspaces['1b09a0cd-734a-4e80-8138-5978fa391f20'];
console.log('starmap sessionIds', JSON.stringify(ws.sessionIds));

