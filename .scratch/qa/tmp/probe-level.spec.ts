import { test } from '@playwright/test';

test('probe level flow', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('starmap.theme', 'dark'));
  await page.goto('/level/lv-bool-laws');
  await page.waitForTimeout(3000);
  for (let i = 0; i < 8; i += 1) {
    const info = await page.evaluate(() => {
      const txt = document.body.innerText.replace(/\s+/g, ' ');
      const seg = /第 (\d+) 段 · ([^\s·]+)/.exec(txt);
      const btns = Array.from(document.querySelectorAll('button')).map((b) => ({
        t: (b.textContent ?? '').trim().slice(0, 14),
        dis: (b as HTMLButtonElement).disabled,
      })).filter((b) => b.t.includes('进入下一段') || b.t.includes('提交答案'));
      return {
        seg: seg ? `${seg[1]}:${seg[2]}` : null,
        radios: document.querySelectorAll('[role="radio"]').length,
        btns,
        textLen: txt.length,
      };
    });
    console.log(`STEP ${i} ${JSON.stringify(info)}`);
    const next = page.locator('button:has-text("进入下一段")');
    if ((await next.count()) === 0) { console.log('no next button'); break; }
    if (!(await next.isEnabled())) {
      const radios = page.locator('[role="radio"]');
      const total = await radios.count();
      for (let k = 0; k < total; k += 1) {
        const submit = page.locator('button:has-text("提交答案")').first();
        if ((await submit.count()) === 0) break;
        await radios.nth(k).click();
        await submit.click();
        await page.waitForTimeout(200);
      }
      console.log('after answering, enabled=', await next.isEnabled());
    }
    if (await next.isEnabled()) { await next.click(); await page.waitForTimeout(400); }
  }
});
