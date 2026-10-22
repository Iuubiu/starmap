const API='http://127.0.0.1:3001';
async function turn(ses,kp,u){const r=await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:u,microKpId:kp,tier:'P2'})});return r.json();}
// 5 次同样的意图，看稳定性
for(let i=0;i<5;i++){
  const ses='ses-stab-'+Date.now()+'-'+i;
  const b=await turn(ses,'kp-bool','给我安排一关，我想直接做题。');
  console.log(i, b.artifact?.kind, b.artifact?.levelId ?? '');
}
