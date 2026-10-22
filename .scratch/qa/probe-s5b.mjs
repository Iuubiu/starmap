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
  await p.waitForTimeout(2000);
  return body;
}
const t = await turn('我不太懂吸收律，你问我一个问题帮我理理。');
console.log('kind', t.artifact?.kind, 'probeId', t.artifact?.probeId, 'inputKind', t.artifact?.inputKind);
const hasTextarea = await p.getByLabel('追问作答').count();
const hasSubmit = await p.getByRole('button',{name:'提交这一问的回答'}).count();
console.log('追问作答 textarea:', hasTextarea, '提交这一问的回答:', hasSubmit);
const text = await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
console.log('has 提示等级:', /提助等级|提示等级/.test(text));
console.log('errors:', errs.filter(e=>!/Keyborg/.test(e)));
await b.close();
