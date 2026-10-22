const API='http://127.0.0.1:3001';
let choice=0, free=0, other=0;
const us=['我完全不会，你出一个选择题考考我。','给我几选一的题。','能不能出个选择题？','我不会，给我选项让我挑。'];
for(let i=0;i<8;i++){
  const ses='ses-ch-'+Date.now()+'-'+i;
  const r=await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:us[i%us.length],microKpId:'kp-bool',tier:'P1'})});
  const b=await r.json();
  if(b.artifact?.kind==='probe_form'){ if(b.artifact.inputKind==='choice')choice++; else free++; }
  else other++;
  console.log(i, b.artifact?.kind, b.artifact?.inputKind ?? '', b.artifact?.choices?.length ?? '');
}
console.log('choice',choice,'free',free,'other',other);
