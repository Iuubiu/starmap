import fs from 'node:fs';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

const data = JSON.parse(fs.readFileSync('D:/DeepSeek/starmap/.scratch/graph.json', 'utf8'));
const nodes = data.nodes;
const edges = data.edges;
const R = 1;

function spread(g) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  g.forEachNode((k, a) => {
    if (a.x < minX) minX = a.x;
    if (a.x > maxX) maxX = a.x;
    if (a.y < minY) minY = a.y;
    if (a.y > maxY) maxY = a.y;
  });
  return { w: maxX - minX, h: maxY - minY };
}

function run(label, settings, iters) {
  const g = new Graph({ multi: false, type: 'directed' });
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    g.addNode(n.microKpId, { x: Math.cos(a) * R, y: Math.sin(a) * R, size: 6 });
  });
  for (const e of edges) {
    if (!g.hasNode(e.from) || !g.hasNode(e.to)) continue;
    if (g.hasEdge(e.from, e.to)) continue;
    g.addEdge(e.from, e.to);
  }
  forceAtlas2.assign(g, { iterations: iters, settings });
  const s = spread(g);
  const span = Math.max(s.w, s.h);
  const px = 860 / span;
  console.log(`${label.padEnd(50)} span=${span.toFixed(0).padStart(7)}  node_px=${(6 * px).toFixed(2).padStart(7)}`);
}

console.log('nodes=' + nodes.length + ' edges=' + edges.length);
console.log('');
console.log('baseline (current production):');
run('sr=10 slow=2 grav=0.5 240it', { barnesHutOptimize: true, barnesHutTheta: 0.5, scalingRatio: 10, slowDown: 2, gravity: 0.5 }, 240);

console.log('');
console.log('scalingRatio sweep:');
for (const sr of [0.1, 0.5, 1, 2, 5]) {
  run(`sr=${sr} slow=2 grav=0.5 240it`, { barnesHutOptimize: true, barnesHutTheta: 0.5, scalingRatio: sr, slowDown: 2, gravity: 0.5 }, 240);
}

console.log('');
console.log('gravity sweep:');
for (const gr of [2, 5, 10, 20]) {
  run(`sr=10 slow=2 grav=${gr} 240it`, { barnesHutOptimize: true, barnesHutTheta: 0.5, scalingRatio: 10, slowDown: 2, gravity: gr }, 240);
}

console.log('');
console.log('combined:');
for (const [sr, gr] of [[0.5, 10], [1, 5], [1, 10], [2, 10], [1, 20]]) {
  run(`sr=${sr} slow=2 grav=${gr} 240it`, { barnesHutOptimize: true, barnesHutTheta: 0.5, scalingRatio: sr, slowDown: 2, gravity: gr }, 240);
}

console.log('');
console.log('iterations (sr=1 grav=10):');
for (const it of [60, 120, 240, 480]) {
  run(`iters=${it}`, { barnesHutOptimize: true, barnesHutTheta: 0.5, scalingRatio: 1, slowDown: 2, gravity: 10 }, it);
}
