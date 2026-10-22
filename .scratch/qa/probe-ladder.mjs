const API='http://127.0.0.1:3001';
const s=await (await fetch(`${API}/api/v1/agent/probes`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({microKpId:'kp-bool',tier:'P1'})})).json();
const pid=s.probeId;
const answers=['不知道','还是不会','完全没头绪','我放弃了','我有点烦了'];
for(const a of answers){
  const r=await fetch(`${API}/api/v1/agent/probes/${pid}/replies`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({replyText:a})});
  const b=await r.json();
  console.log(JSON.stringify({a,replyKind:b.replyKind,action:b.action,level:b.ladder.level,cap:b.ladder.cap,exited:b.ladder.exited,fallback:b.fallbackApplied,q:(b.question??'').slice(0,24)}));
  if(b.ladder.exited) break;
}
