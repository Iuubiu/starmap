import fs from 'node:fs';
function walk(nodes, depth=0, out=[]) { for (const n of nodes) { out.push(n); if (n.children) walk(n.children, depth+1, out); } return out; }
for (const [book, needles] of [
  ['radiation-detectors-dinghonglin-2010', ['作用与地位']],
  ['nuclear-physics-experiment-methods-1997', ['带电粒子在靶物质中的慢化','第一节带电粒子']],
  ['analog-electronics-tongshibai-5e', ['晶体三极管模型及其参数']],
]) {
  const d = JSON.parse(fs.readFileSync(`content/${book}/toc.json`, 'utf8'));
  const all = walk(d.nodes);
  console.log(`\n=== ${book}  nodes=${all.length} ===`);
  for (const needle of needles) {
    const hits = all.filter(n => (n.name||'').includes(needle) || (n.nameOriginal||'').includes(needle));
    for (const h of hits) {
      const idx = all.indexOf(h);
      console.log('  HIT', JSON.stringify(h));
      for (let i = Math.max(0, idx-2); i <= Math.min(all.length-1, idx+2); i++) {
        console.log('     ctx', i, JSON.stringify(all[i]));
      }
    }
  }
}
