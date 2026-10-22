import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage();
const log=[];
await p.goto('http://localhost:5173/');
async function turn(text){
  await p.getByLabel('这一轮想说的话').fill(text);
  const r = p.waitForResponse(x=>x.url().includes('/agent/turns')&&x.request().method()==='POST',{timeout:240000});
  await p.getByRole('button',{name:'提交这一轮'}).click();
  const req = (await r).request().postData();
  const body = await (await r).json();
  await p.waitForTimeout(1500);
  const ctx = await p.evaluate(()=>{
    const el=[...document.querySelectorAll('*')].find(e=>e.textContent?.trim()==='当前知识点');
    return el?.parentElement?.innerText.replace(/\s+/g,' ') ?? 'n/a';
  });
  log.push({text:text.slice(0,14), sentKp: JSON.parse(req).microKpId, kind: body.artifact?.kind, artKp: body.artifact?.microKpId, ctxRow: ctx});
  return body;
}
await turn('我想学布尔代数里的吸收律。');
// 去地图点节点再回来
await p.getByRole('button',{name:'去地图选'}).click(); await p.waitForTimeout(1200);
await p.locator('[data-node-id="kp-bool"]').first().click(); await p.waitForTimeout(1200);
await p.getByRole('tab',{name:'学习',exact:true}).click(); await p.waitForTimeout(1500);
await turn('给我安排一关，我想直接做题。');
await turn('我不太懂，你问我一个问题。');
console.log(JSON.stringify(log,null,1));
await b.close();
