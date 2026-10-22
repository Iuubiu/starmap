/**
 * t43 归属证据之二：400ms 一次写回，画布会不会看起来「一顿一顿」。
 *
 * 用法：node probe-t43-step.mjs
 *
 * 做法：用真实快照（`.scratch/graph-3086.json`）在本地跑 FA2，按**两种写回间隔**
 * 分别取快照，算相邻两次写回之间每个节点的**净位移**（不是逐轮步长累加 ——
 * 节点可能来回晃，累加会高估）。
 *
 *   - 200ms 间隔 ≈ 每 20 轮迭代写回一次
 *   - 400ms 间隔 ≈ 每 40 轮迭代写回一次
 *
 * 判据：一次写回让节点平均移动 < 1 屏幕像素 → 人眼分辨不出这是一次跳变。
 */
import fs from 'node:fs';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

const SETTINGS = {
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  scalingRatio: 4,
  slowDown: 2,
  gravity: 1,
};

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\//, '');
const SNAPSHOT = fs.existsSync(`${ROOT}.scratch/graph-3086.json`)
  ? `${ROOT}.scratch/graph-3086.json`
  : `${ROOT}.scratch/graph.json`;
const data = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));

function buildGraph() {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const n = data.nodes.length;
  const g = new Graph({ multi: false, type: 'directed' });
  data.nodes.forEach((node, i) => {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * GOLDEN;
    g.addNode(node.microKpId, { x: Math.cos(a) * r, y: Math.sin(a) * r, size: 6 });
  });
  for (const e of data.edges) {
    if (!g.hasNode(e.from) || !g.hasNode(e.to)) continue;
    if (g.hasEdge(e.from, e.to)) continue;
    g.addEdge(e.from, e.to);
  }
  return g;
}

function project(g) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  g.forEachNode((_, a) => {
    minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x);
    minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y);
  });
  const PAD = 40;
  const w = 860 - PAD * 2, h = 480 - PAD * 2;
  const spanX = Math.max(maxX - minX, 1e-9), spanY = Math.max(maxY - minY, 1e-9);
  const scale = Math.min(w / spanX, h / spanY);
  const ox = PAD + (w - spanX * scale) / 2 - minX * scale;
  const oy = PAD + (h - spanY * scale) / 2 - minY * scale;
  const out = new Map();
  g.forEachNode((k, a) => out.set(k, { x: a.x * scale + ox, y: a.y * scale + oy }));
  return out;
}

/**
 * 跑 `syncIters` 轮写回一次，共 `budgetIters` 轮，返回每次写回的净位移。
 */
function measure(syncIters, budgetIters) {
  const g = buildGraph();
  let prev = project(g);
  const steps = [];
  for (let done = 0; done + syncIters <= budgetIters; done += syncIters) {
    forceAtlas2.assign(g, { iterations: syncIters, settings: SETTINGS });
    const cur = project(g);
    let sum = 0, max = 0;
    for (const [k, p] of cur) {
      const q = prev.get(k);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      sum += d;
      max = Math.max(max, d);
    }
    steps.push({
      iters: done + syncIters,
      mean: +(sum / cur.size).toFixed(2),
      max: +max.toFixed(2),
    });
    prev = cur;
  }
  return steps;
}

// 4s 预算：worker 里一轮迭代约 20ms（3086 节点），保守取 200 轮
const BUDGET = 200;
const at200 = measure(20, BUDGET); // RENDER_SYNC_MS = 200
const at400 = measure(40, BUDGET); // RENDER_SYNC_MS = 400

function summary(steps) {
  const means = steps.map((s) => s.mean);
  return {
    count: steps.length,
    meanOfMeans: +(means.reduce((a, b) => a + b, 0) / means.length).toFixed(2),
    maxMean: Math.max(...means),
    medianMean: means.slice().sort((a, b) => a - b)[Math.floor(means.length / 2)],
    steps,
  };
}

const s200 = summary(at200);
const s400 = summary(at400);

console.log(JSON.stringify({
  snapshot: SNAPSHOT,
  nodes: data.nodes.length,
  budgetIters: BUDGET,
  at200ms: s200,
  at400ms: s400,
  verdict: {
    firstSync200: at200[0],
    firstSync400: at400[0],
    steadyState400: s400.medianMean,
    note: '首帧写回（种子 → 20/40 轮）是最大的一次跳变；稳态期 400ms 的步长中位数见 steadyState400',
  },
}, null, 1));
