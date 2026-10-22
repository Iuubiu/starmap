import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
await p.goto('http://localhost:5173/');
async function turn(text){
  await p.getByLabel('这一轮想说的话').fill(text);
  const r = p.waitForResponse(x=>x.url().includes('/agent/turns')&&x.request().method()==='POST',{timeout:240000});
  await p.getByRole('button',{name:'提交这一轮'}).click();
  const body = await (await r).json();
  await p.waitForTimeout(1800);
  return body;
}
const t1 = await turn('我想学布尔代数里的吸收律。');
const t2 = await turn('我卡住了，帮我理一理。');
const before = await p.evaluate(()=>document.querySelectorAll('[aria-label^="第 "][aria-label*="轮"]').length);
const ses1 = await p.evaluate(()=>localStorage.getItem('starmap.session'));
const textBefore = await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
console.log('before rows:', before, 'session:', ses1);

// 刷新
await p.reload(); await p.waitForTimeout(2500);
const after = await p.evaluate(()=>document.querySelectorAll('[aria-label^="第 "][aria-label*="轮"]').length);
const ses2 = await p.evaluate(()=>localStorage.getItem('starmap.session'));
const textAfter = await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
console.log('after reload rows:', after, 'session:', ses2, 'same:', ses1===ses2);
console.log('log panel text after:', (textAfter.match(/学习日志.{0,120}/)||['n/a'])[0]);
// 直接查后端
const hist = await (await fetch(`http://127.0.0.1:3001/api/v1/agent/turns?sessionId=${ses1}`)).json();
console.log('server history items:', hist.items?.length);
await b.close();
