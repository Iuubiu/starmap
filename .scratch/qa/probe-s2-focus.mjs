import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ locale: 'zh-CN' });
await p.goto('http://localhost:5173/?kp=kp-bool', { waitUntil: 'domcontentloaded' });
const out = [];
for (const t of [0, 300, 800, 1500, 3000, 6000]) {
  await p.waitForTimeout(t === 0 ? 0 : t - (out.at(-1)?.t ?? 0));
  const txt = await p.evaluate(() => document.body.innerText);
  const m = txt.match(/当前知识点\s*(\S+)/);
  out.push({ t, badge: m ? m[1] : null, hasName: txt.includes('布尔代数基本运算') });
}
console.log(JSON.stringify(out, null, 1));
await b.close();
