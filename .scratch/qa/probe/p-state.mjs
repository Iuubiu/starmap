const API='http://127.0.0.1:3001';
const g=async(p)=>{const r=await fetch(API+p);return {s:r.status,b:await r.json().catch(()=>null)};};
const gr=await g('/api/v1/graph/nodes/kp-bool/mastery').catch(()=>null);
console.log('mastery', JSON.stringify(gr).slice(0,400));
const stats=await g('/api/v1/content/stats');
console.log('stats', JSON.stringify(stats.b).slice(0,300));
const tier=await g('/api/v1/tier');
console.log('tier', JSON.stringify(tier.b?.tier), tier.b?.source);
