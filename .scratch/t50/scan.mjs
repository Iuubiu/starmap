import fs from 'node:fs';
import path from 'node:path';

const CHINESE_BOOKS = fs.readdirSync('content').filter(d => {
  const m = path.join('content', d, 'toc.json');
  return fs.existsSync(m);
}).filter(d => !['ahmed-2e','debertin-1988','gilmore-2e-2008','grupen-2e-2008','knoll-3e-2000','knoll-4e-2010','leo-2e','lutz-2007','nakhostin-2018','nicholson-1974','rivetti-2015','spieler-2005','tsoulfanidis-4e'].includes(d));

function walk(nodes, out=[]) { for (const n of nodes) { out.push(n); if (n.children) walk(n.children, out); } return out; }
const flat = (d) => walk(d.nodes);

const PUNCT_LEAD = /^[、，。；：）)\]]/;
const reports = [];

for (const book of CHINESE_BOOKS) {
  const d = JSON.parse(fs.readFileSync(path.join('content', book, 'toc.json'), 'utf8'));
  const all = flat(d);
  // group by parent
  const byParent = new Map();
  for (const n of all) {
    const k = n.parentId ?? '__root__';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
  }
  for (const [parent, kids] of byParent) {
    for (let i = 1; i < kids.length; i++) {
      const prev = kids[i-1], cur = kids[i];
      const samePage = prev.printedPage === cur.printedPage;
      const nearPage = Math.abs((prev.printedPage??0) - (cur.printedPage??0)) <= 1;
      const curNoNum = !cur.num;
      const lead = PUNCT_LEAD.test(cur.name);
      const prevTrunc = /[、，的了和与及其之在中]$/.test(prev.name) || prev.name.length >= 18;
      if (lead) reports.push({book, kind:'LEAD_PUNCT', parent, prev, cur});
      else if (curNoNum && samePage && prevTrunc) reports.push({book, kind:'SAME_PAGE_TRUNC', parent, prev, cur});
      else if (curNoNum && nearPage && prevTrunc && prev.name.length >= 18) reports.push({book, kind:'NEAR_PAGE_TRUNC', parent, prev, cur});
    }
  }
}
const byKind = {};
for (const r of reports) (byKind[r.kind] ??= []).push(r);
for (const [k, v] of Object.entries(byKind)) {
  console.log(`\n===== ${k}  (${v.length}) =====`);
  for (const r of v) {
    console.log(`${r.book}`);
    console.log(`   prev ${JSON.stringify(r.prev.name)} num=${JSON.stringify(r.prev.num)} p=${r.prev.printedPage} id=${r.prev.microKpId}`);
    console.log(`   cur  ${JSON.stringify(r.cur.name)} num=${JSON.stringify(r.cur.num)} p=${r.cur.printedPage} id=${r.cur.microKpId}`);
  }
}
