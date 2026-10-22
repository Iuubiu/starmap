/**
 * 首轮形态三档对照：同一张关卡，P1 / P2 / P3 各自「一进来看到什么」。
 *
 * 为什么要这个探针：tier 的 `firstRoundShape` 是服务端参数，光看
 * `GET /api/v1/tier` 的数字证明不了界面上真不一样。这里量四件在屏幕上
 * 能看见的事实：起始段、P3 的跳段横幅、讲解卡是否被收起/待补全、选项的纵向偏移。
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const LEVEL = 'lv-bool-laws';
const TIERS = ['P1', 'P2', 'P3'] as const;

for (const tier of TIERS) {
  test(`首屏对照 ${tier}`, async ({ page }) => {
    execFileSync('node', ['../../.scratch/demo-set-tier.mjs', tier], { cwd: process.cwd(), stdio: 'pipe' });

    await page.goto(`/level/${LEVEL}`);
    await expect(page.locator('body')).toContainText(/第 \d 段 · /, { timeout: 30_000 });
    await page.waitForTimeout(600);

    const facts = await page.evaluate(() => {
      const txt = document.body.innerText.replace(/\s+/g, ' ');
      const seg = txt.match(/第 (\d) 段 · ([^\s·]+)/);
      const skip = txt.match(/这一档直接从第 (\d) 段开始/);
      const faded = (txt.match(/这一步留给你补/g) ?? []).length;
      const collapsed = (txt.match(/点开看这一段讲解/g) ?? []).length;
      const radio = document.querySelector('[role="radio"], input[type="radio"], [role="checkbox"]');
      const rect = radio ? radio.getBoundingClientRect() : null;
      return {
        startSegment: seg ? Number(seg[1]) : null,
        startSegmentName: seg ? seg[2] : null,
        skipBanner: skip ? Number(skip[1]) : null,
        fadedCards: faded,
        collapsedCards: collapsed,
        firstOptionY: rect ? Math.round(rect.top) : null,
        viewportTextLen: document.body.innerText.replace(/\s+/g, '').length,
      };
    });

    await page.screenshot({ path: `../../.scratch/qa/shots/first-screen-${tier}.png` });
    console.log(`FIRST_SCREEN ${JSON.stringify({ tier, ...facts })}`);
    expect(facts.startSegment).not.toBeNull();
  });
}
