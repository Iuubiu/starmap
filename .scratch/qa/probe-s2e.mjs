import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('http://localhost:5173/');
async function turn(text){
  await p.getByLabel('这一轮想说的话').fill(text);
  const r = p.waitForResponse(x=>x.url().includes('/agent/turns')&&x.request().method()==='POST',{timeout:240000});
  await p.getByRole('button',{name:'提交这一轮'}).click();
  const res = await r; const body = await res.json();
  await p.waitForTimeout(2500);
  return body;
}
const t1 = await turn('我想学布尔代数里的吸收律，帮我看看该从哪儿开始。');
console.log('t1', t1.artifact?.kind, t1.artifact?.microKpId);
const t2 = await turn('给我安排一关，我想直接做题。');
console.log('t2', t2.artifact?.kind, t2.artifact?.levelId, '|', t2.artifact?.rationale?.slice(0,30));
const text = await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
console.log('HAS 进入关卡:', /进入关卡|去关卡|开始这一关/.test(text));
const btns = await p.locator('button').evaluateAll(ns=>ns.map(n=>n.textContent.trim()).filter(Boolean));
console.log('buttons:', JSON.stringify(btns));
const links = await p.locator('a').evaluateAll(ns=>ns.map(n=>n.getAttribute('href')).filter(Boolean));
console.log('links:', JSON.stringify(links));
console.log('errors:', errs.slice(0,3));
await b.close();
