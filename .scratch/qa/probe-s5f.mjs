const API='http://127.0.0.1:3001';
// 直接看 probe 开始接口：POST /agent/probes 是否支持 choice
const r=await fetch(`${API}/api/v1/agent/probes`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({microKpId:'kp-bool',tier:'P1'})});
const b=await r.json();
console.log('probes POST', r.status, JSON.stringify(b).slice(0,300));
