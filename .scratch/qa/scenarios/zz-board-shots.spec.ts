/**
 * 票 80 的截图探针（临时文件，跑完可删）。
 *
 * 只做两件事：打开 `/me`，等看板的三块出现，按 1280×800 截一张图，并把关键
 * 数字（分母、三数、层数、书数）打印出来 —— 截图里的分母必须能和库里
 * `SELECT count(*) FROM app.knowledge_points WHERE is_leaf` 对上。
 *
 * 空数据那张图由外部先清空 attempts 再跑一次（`BOARD_SHOT=board-empty`）。
 */
import { expect, test } from '@playwright/test';

const SHOT = process.env.BOARD_SHOT ?? 'board-with-data';

test.use({ viewport: { width: 1280, height: 800 } });

test('个人看板截图', async ({ page }) => {
  // 这张图要的是看板本身，不要被「初识」引导拦走。
  await page.addInitScript(() => {
    window.localStorage.setItem('profileDone', '1');
  });

  await page.goto('/me');
  const board = page.getByRole('region', { name: '个人看板' });
  await expect(board).toBeVisible();

  const total = board.getByRole('region', { name: '总进度' });
  await expect(total).toBeVisible({ timeout: 15_000 });

  const numbers = await total.innerText();
  const layers = await board.getByRole('region', { name: '学科进度' }).innerText();
  const books = await board.getByRole('region', { name: '课本进度' }).innerText();
  console.log(
    JSON.stringify({
      shot: SHOT,
      total: numbers.replaceAll(/\s+/g, ' ').slice(0, 200),
      layerRows: layers.split('\n').filter((line) => line.includes('/')).length,
      bookRows: books.split('\n').filter((line) => line.includes('/')).length,
      empty: await total.getByTestId('board-empty').count(),
    }),
  );

  await total.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `../../.scratch/qa/shots/${SHOT}.png` });
});
