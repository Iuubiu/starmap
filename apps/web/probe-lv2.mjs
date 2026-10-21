import { chromium } from '@playwright/test';

const b = await chromium.launch();
const p = await (await b.newContext({ baseURL: 'http://localhost:5173', locale: 'zh-CN' })).newPage();
await p.goto('/level/lv-bool-laws');
await p.waitForTimeout(2500);

for (let i = 0; i < 10; i += 1) {
  const btns = await p.getByRole('button').all();
  const info = [];
  for (const x of btns) {
    const vis = await x.isVisible();
    if (!vis) continue;
    info.push(`${JSON.stringify(await x.innerText())}${(await x.isDisabled()) ? '(dis)' : ''}`);
  }
  console.log(`step ${i}: ${info.join(' | ')}`);
  console.log('   radios:', await p.getByRole('radio').count(), 'textboxes:', await p.getByRole('textbox').count());

  const submit = p.getByRole('button', { name: '提交答案' });
  if (await submit.isVisible().catch(() => false)) {
    const r = p.getByRole('radio');
    if (await r.count()) await r.first().click();
    await submit.click();
    await p.waitForTimeout(700);
    console.log('   >>> submitted');
    continue;
  }
  const adv = p.getByRole('button', { name: /进入下一段|开始这一段|下一段|看结果/ });
  const all = await adv.all();
  const vis = [];
  for (const a of all) vis.push(`${JSON.stringify(await a.innerText())}:${await a.isVisible()}`);
  console.log('   advance matches:', all.length, vis.join(','));
  try {
    await adv.first().click({ timeout: 3000 });
    await p.waitForTimeout(800);
  } catch (e) {
    console.log('   CLICK FAIL:', String(e).split('\n')[0]);
    break;
  }
}
await b.close();
