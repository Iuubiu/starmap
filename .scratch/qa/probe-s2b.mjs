const API='http://127.0.0.1:3001';
// 找一个有 leaf 关卡的微知识点
const g=await (await fetch(`${API}/api/v1/graph?focus=kp-bool&hops=3`)).json();
const leaves=g.nodes.filter(n=>n.percent!==null).slice(0,3);
console.log('candidates', leaves.map(n=>n.microKpId+'|'+n.name+'|'+n.state));
for(const kp of leaves){
  const ses='ses-s2-'+Date.now()+'-'+Math.random().toString(36).slice(2,6);
  const r=await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:'我想开始学这个知识点，给我安排一关。',microKpId:kp.microKpId,tier:'P2'})});
  const b=await r.json();
  console.log(JSON.stringify({kp:kp.microKpId,kind:b.artifact?.kind,title:b.artifact?.title,levelId:b.artifact?.levelId,itemCount:b.artifact?.itemCount,rationale:b.artifact?.rationale?.slice(0,40)}));
}
