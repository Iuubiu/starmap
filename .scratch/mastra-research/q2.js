const r=await fetch('https://registry.npmjs.org/@mastra/core');const j=await r.json();
const t=j.time;const vs=Object.keys(j.versions).filter(v=>/^\d+\.\d+\.\d+$/.test(v));
const ones=vs.filter(v=>v.startsWith('1.'));
console.log('1.x stable count',ones.length);
console.log('first 1.0.0 date',t['1.0.0']);
console.log('0.x last', vs.filter(v=>v.startsWith('0.')).slice(-1)[0], t[vs.filter(v=>v.startsWith('0.')).slice(-1)[0]]);
// minor cadence
const minors={};for(const v of ones){const m=v.split('.').slice(0,2).join('.');minors[m]=minors[m]||t[v];}
const entries=Object.entries(minors).sort((a,b)=>new Date(a[1])-new Date(b[1]));
console.log('minor count',entries.length);
console.log(entries.slice(-30).map(([m,d])=>m+' '+d.slice(0,10)).join('\n'));
// patch releases per week over last 8 weeks
const now=new Date('2026-10-20');
let per=[];
for(let i=0;i<8;i++){const start=new Date(now-i*7*864e5),end=new Date(now-(i-1)*7*864e5);
 const c=vs.filter(v=>{const d=new Date(t[v]);return d>start&&d<=end;}).length;per.push(`week-${i}: ${c} releases`);}
console.log(per.reverse().join('\n'));
