import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const OUT = '.scratch/qa/shots';

/**
 * 清空学习数据之后，首屏应当回到「什么都没学过」的状态。
 * 这不是为了好看，而是演示的第一步：用户看到的第一个界面必须是干净的起点，
 * 否则「三种学习者学同一个知识点」无从谈起——库里有他自己的掌握度，卡片就会
 * 直接跳到「你已经掌握了」。
 */
test('清空学习数据后，首屏回到干净起点', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const body = await page.locator('main').innerText();
  const log = await page.locator('body').innerText();
  writeFileSync(`${OUT}/clean-home.txt`, log, 'utf8');
  await page.screenshot({ path: `${OUT}/clean-home.png`, fullPage: false });

  // 首屏不该再出现「你已经掌握」这类基于旧数据的判断
  expect(body).not.toMatch(/掌握度已经满了|已经掌握/);
  // 会话应当是新开的（0 轮记录）
  expect(body).toMatch(/0 轮记录|还没有记录/);

  await page.goto('/board', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const board = await page.locator('main').innerText();
  writeFileSync(`${OUT}/clean-board.txt`, board, 'utf8');
  await page.screenshot({ path: `${OUT}/clean-board.png` });

  // 看板：今日摘要应当是 0，而不是我探针跑出来的 138
  expect(board).toMatch(/今天答了\s*0|0\s*\n?\s*题/);
  expect(board).not.toMatch(/138/);

  console.log('CLEAN_BOARD_HEAD ' + board.slice(0, 400).replace(/\s+/g, ' '));
});
