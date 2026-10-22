import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('http://localhost:5173/');
// 1. 首页第一轮：graph_focus，kp 为空
await p.getByLabel('这一轮想说的话').fill('我想学布尔代数里的吸收律。');
let r = p.waitForResponse(x=>x.url().includes('/agent/turns')&&x.request().method()==='POST',{timeout:240000});
await p.getByRole('button',{name:'提交这一轮'}).click();
let body = await (await r).json();
console.log('t1 kind', body.artifact?.kind, 'kp=', JSON.stringify(body.artifact?.microKpId));
await p.waitForTimeout(1500);
// 2. 点「去地图选」
await p.getByRole('button',{name:'去地图选'}).click();
await p.waitForTimeout(1500);
console.log('url after 去地图选:', p.url());
// 3. 在地图上点一个节点
const node = p.locator('[data-node-id]').first();
await node.click();
await p.waitForTimeout(1500);
console.log('url after node click:', p.url());
// 4. 回「学习」标签
await p.getByRole('tab',{name:'学习',exact:true}).click();
await p.waitForTimeout(1500);
console.log('url back:', p.url());
const ctx = await p.evaluate(()=>document.body.innerText.match(/当前知识点[^\n]{0,40}/)?.[0] ?? 'n/a');
console.log('context row:', ctx);
await b.close();
