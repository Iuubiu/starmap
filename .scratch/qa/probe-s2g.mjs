const API='http://127.0.0.1:3001';
const us=[
 '我在学「布尔代数基本运算」这个知识点，给我安排一关。',
 '我在学布尔代数基本运算，接下来该做什么？',
 '吸收律属于哪个知识点？我想练它。',
 '布尔代数基本运算',
];
for(const u of us){
  const ses='ses-s2g-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
  const r=await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:u,microKpId:null,tier:'P2'})});
  const b=await r.json();
  console.log(JSON.stringify({u:u.slice(0,22),kind:b.artifact?.kind,kp:b.artifact?.microKpId,name:b.artifact?.name,title:b.artifact?.title}));
}
