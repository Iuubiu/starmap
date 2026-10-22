const hex = (h) => { const s = h.replace('#',''); return [0,2,4].map(i => parseInt(s.slice(i,i+2),16)); };
const lin = (c) => { c/=255; return c<=0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4; };
const lum = (h) => { const [r,g,b] = hex(h); return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b); };
const cr = (a,b) => { const x=lum(a), y=lum(b); const hi=Math.max(x,y), lo=Math.min(x,y); return (hi+0.05)/(lo+0.05); };
const f = (n) => Math.round(n*100)/100;
const D = { canvas:'#0B0B0F', surface:'#15151A', elevated:'#1C1C22', hover:'#22222A', selected:'#2A2A33', soft:'#2A1E0C' };
const L = { canvas:'#ECEDF0', surface:'#FFFFFF', elevated:'#F7F7F9', hover:'#F1F1F4', selected:'#FBEAEA', soft:'#FBF0DF' };
for (const [name, p, cands] of [
  ['DARK', D, { warning:'#F5A524', captain:'#E09D00' }],
  ['LIGHT', L, { warning:'#8A5200', captain:'#A87600' }],
]) {
  console.log('==', name);
  for (const [k, c] of Object.entries(cands)) {
    const vals = Object.entries(p).map(([bg, v]) => [bg, f(cr(c, v))]);
    const worst = Math.min(...vals.map(([, v]) => v));
    console.log(' ', k, c, JSON.stringify(Object.fromEntries(vals)), 'worst', worst);
  }
}
