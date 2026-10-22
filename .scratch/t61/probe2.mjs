import fs from 'node:fs';
import path from 'node:path';

const BOOKS = fs.readdirSync('content').filter(d => fs.existsSync(path.join('content', d, 'toc.json')));
function walk(nodes, out = []) { for (const n of nodes) { out.push(n); if (n.children) walk(n.children, out); } return out; }

const ids = [
  'kp-tongshibai-5e-p598-晶体三极管模型及其参数',
  'kp-methods-1997-p28-带电粒子在靶物质中的慢化',
  'kp-methods-1997-p30-重带电粒子在物质中的能量损失',
  'kp-methods-1997-p44-重离子的电子阻止本领',
  'kp-methods-1997-p20-倍增过程统计学',
  'kp-methods-1997-p375-中子全截面测量',
  'kp-methods-1997-p325-概述',
  'kp-chenboxian-2011-13-4',
  'kp-jichangsong-1990-p472-光导纤维光导',
  'kp-jichangsong-1990-4-2-1',
  'kp-dinghonglin-2010-p1-作用与地位',
  'kp-dinghonglin-2010-1-1',
];
for (const book of BOOKS) {
  const d = JSON.parse(fs.readFileSync(path.join('content', book, 'toc.json'), 'utf8'));
  const all = walk(d.nodes);
  const hit = all.filter(n => ids.includes(n.microKpId));
  if (!hit.length) continue;
  console.log(`\n########## ${book}  (nodes=${all.length}) ##########`);
  for (const h of hit) {
    const i = all.indexOf(h);
    console.log(`--- idx=${i} ---`);
    for (let j = Math.max(0, i - 3); j <= Math.min(all.length - 1, i + 2); j++) {
      const n = all[j];
      const mark = j === i ? '>>>' : '   ';
      console.log(`${mark} [${j}] id=${n.microKpId}`);
      console.log(`     name=${JSON.stringify(n.name)} num=${JSON.stringify(n.num)} p=${n.printedPage} depth=${n.depth} parent=${n.parentId} leaf=${n.isLeaf} ord=${n.ordinal}`);
    }
  }
}
