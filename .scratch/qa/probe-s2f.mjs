const API='http://127.0.0.1:3001';
const us=[
 '我想学布尔代数里的吸收律，帮我看看该从哪儿开始。',
 '前置放大器为什么必须紧贴探测器？',
 '我想学触发器，从哪儿开始？',
 '吸收律是什么',
 '布尔代数',
];
for(const u of us){
  const ses='ses-s2f-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
  const r=await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:u,microKpId:null,tier:'P2'})});
  const b=await r.json();
  console.log(JSON.stringify({u:u.slice(0,18),kind:b.artifact?.kind,kp:b.artifact?.microKpId,title:b.artifact?.title}));
}
