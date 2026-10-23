/**
 * 票 87：学习页 / 学习记录页六项硬指标的**实测**脚本（不靠目测）。
 *
 * 两侧都在 1240x700 的同一视口里量：
 *   - 样例：`.scratch/design/light-v1.html` 的第 1 个 `.stage`（学习页）
 *           与第 2 个 `.stage`（学习记录页）。cx-1/cx-2.png 就是这两个元素
 *           的实拍（都是 1240x700）。
 *   - 实装：`http://localhost:5173/` 与 `/learning`（先写 `profileDone=1` 过欢迎页）。
 *
 * 实装侧的类名是 Fluent 的哈希类，所以按 `sm-*` 语义类 + 结构位置取。
 */
import { chromium } from '@playwright/test';

const DESIGN = 'file:///D:/DeepSeek/starmap/.scratch/design/light-v1.html';
const APP = 'http://localhost:5173';
const VW = 1240;
const VH = 700;

const MEASURE = `(spec) => {
  const out = {};
  for (const [key, sel] of Object.entries(spec)) {
    if (!sel) { out[key] = null; continue; }
    let el = null;
    try { el = document.querySelector(sel); } catch { el = null; }
    if (!el) { out[key] = null; continue; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[key] = {
      x: +r.x.toFixed(1), y: +r.y.toFixed(1),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      radius: cs.borderTopLeftRadius,
      fontSize: cs.fontSize, lineHeight: cs.lineHeight,
      pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) => parseFloat(v) || 0).join('/'),
      gap: cs.gap,
      bg: cs.backgroundColor,
    };
  }
  return out;
}`;

/** 留白占比：正文/卡片这类「实心块」占视口的面积比 + 主栏两侧外边距。 */
const GAP_RATIO = `(rootSel) => {
  const vw = innerWidth, vh = innerHeight;
  const root = document.querySelector(rootSel) || document.body;
  const blocks = [...root.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const opaque = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    return (opaque || radius >= 8) && r.width > 150 && r.height > 40;
  });
  // 只取最外层（父节点不在集合里），避免嵌套块重复计面积
  const set = new Set(blocks);
  const outer = blocks.filter((el) => !set.has(el.parentElement));
  const area = outer.reduce((s, el) => { const r = el.getBoundingClientRect(); return s + r.width * r.height; }, 0);
  return { viewport: [vw, vh], outerBlocks: outer.length, ratio: +(area / (vw * vh)).toFixed(3) };
}`;

// ---------- 样例侧 ----------
const D_LEARN = {
  rail: '.stage:nth-of-type(1) .rail',
  side: '.stage:nth-of-type(1) .side',
  main: '.stage:nth-of-type(1) .main',
  h1: '.stage:nth-of-type(1) .hd h1',
  col: '.stage:nth-of-type(1) .col',
  me: '.stage:nth-of-type(1) .me',
  ai: '.stage:nth-of-type(1) .ai',
  who: '.stage:nth-of-type(1) .ai .who',
  card: '.stage:nth-of-type(1) .card',
  cardH3: '.stage:nth-of-type(1) .card h3',
  cardTag: '.stage:nth-of-type(1) .card .tag',
  meta: '.stage:nth-of-type(1) .card .meta',
  metaLabel: '.stage:nth-of-type(1) .card .meta div',
  metaB: '.stage:nth-of-type(1) .card .meta b',
  cardP: '.stage:nth-of-type(1) .card p',
  go: '.stage:nth-of-type(1) .card .go',
  cbox: '.stage:nth-of-type(1) .cbox',
  ph: '.stage:nth-of-type(1) .cbox .ph',
  crow: '.stage:nth-of-type(1) .crow',
  plus: '.stage:nth-of-type(1) .plus',
  perm: '.stage:nth-of-type(1) .perm',
  pill: '.stage:nth-of-type(1) .pill',
  mic: '.stage:nth-of-type(1) .mic',
  send: '.stage:nth-of-type(1) .send',
  tools: '.stage:nth-of-type(1) .tools',
  log: '.stage:nth-of-type(1) .log',
  logH4: '.stage:nth-of-type(1) .log h4',
  kp: '.stage:nth-of-type(1) .log .kp',
};

const D_RECORDS = {
  rail: '.stage:nth-of-type(2) .rail',
  two: '.stage:nth-of-type(2) .two',
  rlist: '.stage:nth-of-type(2) .rlist',
  rlistH1: '.stage:nth-of-type(2) .rlist h1',
  rlistG: '.stage:nth-of-type(2) .rlist .g',
  r: '.stage:nth-of-type(2) .rlist .r',
  rSmall: '.stage:nth-of-type(2) .rlist .r small',
  preview: '.stage:nth-of-type(2) .preview',
  h2: '.stage:nth-of-type(2) .preview h2',
  tip: '.stage:nth-of-type(2) .preview .tip',
  card: '.stage:nth-of-type(2) .preview .card',
  cbox: '.stage:nth-of-type(2) .cbox',
  ph: '.stage:nth-of-type(2) .cbox .ph',
  crow: '.stage:nth-of-type(2) .crow',
  send: '.stage:nth-of-type(2) .send',
  tools: '.stage:nth-of-type(2) .tools',
};

// ---------- 实装侧 ----------
const A_SHELL = {
  rail: '.sm-rail',
  stage: '.sm-stage',
  main: '.sm-main',
  content: '.sm-content',
};

const A_LEARN = {
  ...A_SHELL,
  h1: '.sm-main h1',
  cbox: '.sm-composer-box',
  input: '.sm-composer-input',
  crow: '.sm-composer-row',
  chip: '.sm-composer-chip',
  send: '.sm-composer-send',
  toolbar: '.sm-composer-toolbar',
  tool: '.sm-composer-tool',
  sidebar: '.sm-study-sidebar',
};

const A_RECORDS = {
  ...A_SHELL,
  h1: '.sm-main h1',
  cbox: '.sm-composer-box',
  input: '.sm-composer-input',
  crow: '.sm-composer-row',
  send: '.sm-composer-send',
  toolbar: '.sm-composer-toolbar',
};

async function measureDesign(browser, spec, index) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.goto(DESIGN);
  const out = await page.evaluate(new Function('return ' + MEASURE)(), spec);
  const gap = await page.evaluate(new Function('return ' + GAP_RATIO)(), `.stage:nth-of-type(${index + 1})`);
  await page.close();
  return { out, gap };
}

async function measureApp(browser, url, spec) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('profileDone', '1');
    } catch {
      /* 隐私模式忽略 */
    }
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const out = await page.evaluate(new Function('return ' + MEASURE)(), spec);
  const gap = await page.evaluate(new Function('return ' + GAP_RATIO)(), '.sm-main');
  await page.close();
  return { out, gap };
}

const browser = await chromium.launch();
const dLearn = await measureDesign(browser, D_LEARN, 0);
const dRecords = await measureDesign(browser, D_RECORDS, 1);
const aLearn = await measureApp(browser, APP + '/', A_LEARN);
const aRecords = await measureApp(browser, APP + '/learning', A_RECORDS);
await browser.close();

const fmt = (v) =>
  v == null
    ? 'null'
    : `x=${v.x} y=${v.y} w=${v.w} h=${v.h} r=${v.radius} fs=${v.fontSize}/${v.lineHeight} pad=${v.pad} gap=${v.gap}`;

for (const [title, d, a] of [
  ['学习页', dLearn, aLearn],
  ['学习记录页', dRecords, aRecords],
]) {
  console.log(`\n########## ${title} ##########`);
  for (const k of new Set([...Object.keys(d.out), ...Object.keys(a.out)])) {
    console.log(`-- ${k}`);
    console.log(`   样例 ${fmt(d.out[k])}`);
    console.log(`   实装 ${fmt(a.out[k])}`);
  }
  console.log(`   样例留白占比 ${JSON.stringify(d.gap)}`);
  console.log(`   实装留白占比 ${JSON.stringify(a.gap)}`);
}

console.log('\n########## JSON ##########');
console.log(JSON.stringify({ dLearn, dRecords, aLearn, aRecords }, null, 1));
