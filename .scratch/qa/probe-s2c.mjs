const API='http://127.0.0.1:3001';
const ses='ses-s2c-'+Date.now();
const r=await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:'我想开始学这个知识点，给我安排一关。',microKpId:'kp-bool',tier:'P2'})});
const b=await r.json();
console.log('languageCheck', JSON.stringify(b.languageCheck));
console.log('visibleResponse', b.visibleResponse);
console.log('visibleResponseKind', b.visibleResponseKind);
console.log('actions', JSON.stringify(b.actions));
console.log('artifact', JSON.stringify(b.artifact,null,1));
// 关卡详情
const lv=await (await fetch(`${API}/api/v1/levels/${b.artifact.levelId}`)).json();
console.log('level keys', Object.keys(lv));
console.log('level title', lv.level?.title ?? lv.title, 'items', (lv.level?.spec?.items??lv.spec?.items??[]).length);
