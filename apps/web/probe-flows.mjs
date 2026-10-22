import { chromium } from '@playwright/test';

const b = await chromium.launch();
const p = await (await b.newContext({ baseURL: 'http://localhost:5173', locale: 'zh-CN' })).newPage();

// ---- 1. placement: 重新定级 -> 自评 -> 开始答题 -> 判定
await p.goto('/placement');
await p.waitForTimeout(2500);
await p.getByRole('button', { name: /开始答题|开始定级|重新定级/ }).first().click();
await p.waitForTimeout(1200);
console.log('after 重新定级: group count =', await p.getByRole('group').count());
const names = await p.getByRole('group').all();
for (const g of names) console.log('   group label =', await g.getAttribute('aria-label'));
console.log('   radiogroups =', await p.getByRole('radiogroup').count());
console.log('   buttons =', (await p.getByRole('button').all()).length);
for (const x of await p.getByRole('button').all()) console.log('      ', JSON.stringify(await x.innerText()), 'dis=', await x.isDisabled());

const groups = p.getByRole('radiogroup');
const n = await groups.count();
for (let i = 0; i < n; i += 1) {
  const r = groups.nth(i).getByRole('radio');
  if (await r.count()) await r.first().click();
}
const submitSelf = p.getByRole('button', { name: '提交自评' });
console.log('提交自评 visible:', await submitSelf.isVisible().catch(() => false));
if (await submitSelf.isVisible().catch(() => false)) {
  await submitSelf.click();
  await p.waitForTimeout(1500);
}
const startQuiz = p.getByRole('button', { name: /开始答题|开始定级/ });
console.log('开始答题 visible:', await startQuiz.first().isVisible().catch(() => false));
if (await startQuiz.first().isVisible().catch(() => false)) {
  await startQuiz.first().click();
  await p.waitForTimeout(2500);
}
console.log('定级题 region:', await p.getByRole('region', { name: '定级题' }).count());
const qr = p.getByRole('radiogroup', { name: '这道题的选项' }).getByRole('radio');
console.log('定级题 radios:', await qr.count());
if (await qr.count()) {
  await qr.first().click();
  await p.getByRole('button', { name: /提交答案/ }).first().click();
  await p.waitForTimeout(2000);
  const judge = p.getByRole('region', { name: '这道题的判定' });
  console.log('判定 region:', await judge.count());
  console.log('判定 text:', (await judge.innerText().catch(() => '')).slice(0, 200));
}

// ---- 2. skills: 等名字出现
await p.goto('/skills');
await p.waitForTimeout(3000);
for (const nm of ['question-author', 'socratic-tutor']) {
  console.log('skills', nm, 'count=', await p.getByText(nm, { exact: false }).count());
}

// ---- 3. review: 文案
await p.goto('/review');
await p.waitForTimeout(1500);
console.log('review body:', (await p.locator('body').innerText()).slice(0, 200).replace(/\n/g, ' | '));

await b.close();
