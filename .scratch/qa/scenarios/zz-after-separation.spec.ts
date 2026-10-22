import { expect, test } from '@playwright/test';

/**
 * 英文书移除后的界面自检。
 *
 * 目的不是「回归所有功能」，而是回答一个问题：库里 4030 个知识点、14 本中文书
 * 之后，三个最关键页面（数据库 / 地图 / 看板）是否还在正常展示，以及是否还有
 * 英文书的残留（节点数、书名、推荐项）。
 */
const settled = async (page: import('@playwright/test').Page) => {
  await page
    .waitForFunction(
      () => document.querySelectorAll('[role="progressbar"]:not([aria-valuenow])').length === 0,
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => undefined);
};

test('英文书移除后：数据库页只列 14 本中文书', async ({ page }) => {
  await page.goto('/database');
  await settled(page);
  await page.waitForTimeout(600);

  const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  const rows = await page.locator('main table tbody tr').count();
  await page.screenshot({ path: '.scratch/qa/shots/after-sep-database.png', fullPage: false });
  console.log(JSON.stringify({ page: 'database', rows, hasKanghua: body.includes('康华光') }));

  // 115 = 14 本中文书 + 101 篇论文；来源表本来就同时收录两类
  expect(rows).toBe(115);
  expect(body).toContain('康华光');
  // 英文书的作者/书名不应再出现在来源表里
  for (const name of ['Knoll', 'Grupen', 'Ahmed', 'Leo', 'Leroy', 'Tsoulfanidis']) {
    expect(body).not.toContain(name);
  }
});

test('英文书移除后：地图只剩中文书的 3086 个知识点', async ({ page }) => {
  await page.goto('/map');
  await settled(page);
  await page.waitForTimeout(2500);

  const nodes = await page.locator('[data-node-count]').first().getAttribute('data-node-count');
  await page.screenshot({ path: '.scratch/qa/shots/after-sep-map.png' });
  console.log(JSON.stringify({ page: 'map', nodes }));

  expect(Number(nodes)).toBe(3086);
});

test('英文书移除后：看板推荐全是中文名', async ({ page }) => {
  await page.goto('/');
  await settled(page);
  await page.waitForTimeout(800);

  const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  await page.screenshot({ path: '.scratch/qa/shots/after-sep-board.png' });

  // 英文书的知识点名字里常见这些词；推荐项不应再出现
  for (const word of ['detector', 'Detector', 'scintillation', 'Spectrometry']) {
    expect(body).not.toContain(word);
  }
  console.log(JSON.stringify({ page: 'home', looksClean: true }));
});
