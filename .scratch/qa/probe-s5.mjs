const API='http://127.0.0.1:3001';
const tries=[
 ['kp-bool','我不太懂吸收律，能问我一个问题帮我理理吗？'],
 ['kp-bool','我卡住了，你问我一个具体的问题。'],
 ['kp-bool','先别给我关卡，先问我一两个问题看看我哪里不会。'],
 ['kp-jichangsong-1990-11-8','我不明白前置放大器为什么需要这个，你问我点东西。'],
];
for(const [kp,u] of tries){
  const ses='ses-s5-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
  const r=await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:u,microKpId:kp,tier:'P2'})});
  const b=await r.json();
  console.log(JSON.stringify({kp,kind:b.artifact?.kind,q:b.artifact?.question?.slice(0,30),inputKind:b.artifact?.inputKind,choices:b.artifact?.choices?.length,probeId:b.artifact?.probeId}));
}
