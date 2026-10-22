// t44 干净的 2×2 矩阵：种子形状 × FA2 参数，在多个规模上量可分辨度。
// 目的：诚实区分「谁在起决定作用」，并据此定测试阈值与反向验证口径。
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

const W = 860;
const H = 480;
const PAD = 40;
const GOLD = Math.PI * (3 - Math.sqrt(5));
const K = 241.3;
const diameter = (n) => Math.max(2, Math.min(9, K / Math.sqrt(Math.max(1, n))));

const disk = (count) => {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const r = Math.sqrt((i + 0.5) / count);
    const a = i * GOLD;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return out;
};
const ring = (count) => {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    out.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return out;
};
const lcg = (s0) => {
  let s = s0 >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

function synthetic(count, edgeTarget, seedVal) {
  const graph = new Graph({ multi: false, type: 'directed' });
  for (let i = 0; i < count; i += 1) graph.addNode(`n${i}`, {});
  const rand = lcg(seedVal);
  const used = new Set();
  const take = (size) => {
    for (let t = 0; t < 400; t += 1) {
      const start = Math.floor(rand() * (count - size - 1));
      let free = true;
      for (let k = 0; k < size; k += 1) {
        if (used.has(start + k)) {
          free = false;
          break;
        }
      }
      if (free) {
        for (let k = 0; k < size; k += 1) used.add(start + k);
        return start;
      }
    }
    return null;
  };
  let made = 0;
  const chain = (size) => {
    if (made >= edgeTarget) return;
    const start = take(size);
    if (start === null) return;
    for (let k = 1; k < size && made < edgeTarget; k += 1) {
      graph.addEdge(`n${start + k - 1}`, `n${start + k}`);
      made += 1;
    }
  };
  const scale = count / 5000;
  for (let i = 0; i < Math.round(61 * scale); i += 1) chain(2);
  for (let i = 0; i < Math.round(29 * scale); i += 1) chain(4);
  for (let i = 0; i < Math.round(3 * scale); i += 1) chain(8);
  for (let i = 0; i < Math.round(3 * scale); i += 1) chain(15);
  chain(24);
  let guard = 0;
  while (made < edgeTarget && guard < 8000) {
    guard += 1;
    chain(2);
  }
  return graph;
}

function project(graph) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  graph.forEachNode((_, a) => {
    if (a.x < minX) minX = a.x;
    if (a.x > maxX) maxX = a.x;
    if (a.y < minY) minY = a.y;
    if (a.y > maxY) maxY = a.y;
  });
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = Math.min((W - 2 * PAD) / span, (H - 2 * PAD) / span);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const pts = [];
  graph.forEachNode((_, a) => {
    pts.push({ x: W / 2 + (a.x - cx) * scale, y: H / 2 + (a.y - cy) * scale });
  });
  return pts;
}

function separable(graph, d) {
  const pts = project(graph);
  const n = pts.length;
  const nn = new Array(n).fill(Infinity);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dist = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (dist < nn[i]) nn[i] = dist;
      if (dist < nn[j]) nn[j] = dist;
    }
  }
  return nn.filter((v) => v >= d).length / n;
}

const NEW = { scalingRatio: 4, gravity: 1 };
const OLD = { scalingRatio: 10, gravity: 0.5 };

for (const [N, E] of [
  [1200, 66],
  [3000, 165],
  [5000, 275],
]) {
  const d = diameter(N);
  const rows = [];
  for (const [seedName, seedFn] of [
    ['disk', disk],
    ['ring', ring],
  ]) {
    for (const [setName, settings] of [
      ['new(sr4/g1)', NEW],
      ['old(sr10/g0.5)', OLD],
    ]) {
      const vals = [];
      for (const sv of [20261022, 7, 991]) {
        const g = synthetic(N, E, sv);
        const pos = seedFn(N);
        let i = 0;
        g.forEachNode((k) => {
          g.setNodeAttribute(k, 'x', pos[i].x);
          g.setNodeAttribute(k, 'y', pos[i].y);
          i += 1;
        });
        forceAtlas2.assign(g, {
          iterations: 60,
          settings: { ...settings, barnesHutOptimize: true, barnesHutTheta: 0.5, slowDown: 2 },
        });
        vals.push(separable(g, d) * 100);
      }
      rows.push(`${seedName}+${setName}=${vals.map((v) => v.toFixed(1)).join('/')}`);
    }
  }
  // 种子态（0 轮）
  const seedOnly = [];
  for (const [seedName, seedFn] of [
    ['disk', disk],
    ['ring', ring],
  ]) {
    const g = synthetic(N, E, 20261022);
    const pos = seedFn(N);
    let i = 0;
    g.forEachNode((k) => {
      g.setNodeAttribute(k, 'x', pos[i].x);
      g.setNodeAttribute(k, 'y', pos[i].y);
      i += 1;
    });
    seedOnly.push(`${seedName}=${(separable(g, d) * 100).toFixed(1)}`);
  }
  console.log(`n=${String(N).padStart(4)} d=${d.toFixed(2)}  0轮: ${seedOnly.join(' / ')}`);
  console.log(`            60轮: ${rows.join('  ')}`);

  // 尺寸回归：如果 nodeDiameter 退回固定 7-9px 会怎样
  const g = synthetic(N, E, 20261022);
  const pos = disk(N);
  let i = 0;
  g.forEachNode((k) => {
    g.setNodeAttribute(k, 'x', pos[i].x);
    g.setNodeAttribute(k, 'y', pos[i].y);
    i += 1;
  });
  forceAtlas2.assign(g, {
    iterations: 60,
    settings: { ...NEW, barnesHutOptimize: true, barnesHutTheta: 0.5, slowDown: 2 },
  });
  const at7 = separable(g, 7) * 100;
  const at9 = separable(g, 9) * 100;
  console.log(`            d=7(旧固定) sep=${at7.toFixed(1)}%   d=9 sep=${at9.toFixed(1)}%`);
}
