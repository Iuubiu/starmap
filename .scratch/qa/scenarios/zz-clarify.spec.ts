/**
 * 票 81：问津卡的选项一键作答（真浏览器 + 真后端）。
 *
 * 为什么不在单测里做：验收要的两件事都是**跨进程**的 ——
 * 「点一下发出且只发出一轮」（数真实 `POST /api/v1/agent/turns` 请求）
 * 与「连点只发一次」（React 重渲之前的时间窗）。jsdom 里只能数 mock。
 *
 * 依赖：dev API 在 127.0.0.1:3001、前端在 localhost:5173。每轮要等模型，
 * 超时给足 180s；同一浏览器上下文里 localStorage 会被复用，所以每个用例
 * 都重新清掉 `starmap.session` 拿新会话，避免上一轮已确立的意图把问津跳过。
 */
import { expect, test, type Page } from '@playwright/test';

const SHOT = '../../.scratch/qa/shots/clarify-choice.png';
const TIMEOUT = 180_000;

function countTurnRequests(page: Page): { readonly value: number } {
  const counter = { value: 0 };
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes('/api/v1/agent/turns')
    ) {
      counter.value += 1;
    }
  });
  return counter;
}

async function freshHome(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('profileDone', '1');
      localStorage.removeItem('starmap.session');
    } catch {
      /* 隐私模式下 localStorage 会抛，忽略即可：这只是让首访闸门别挡路。 */
    }
  });
  await page.goto('/');
  await expect(page.getByLabel('这一轮想说的话')).toBeVisible();
}

/** 发一句宽泛的「我想学…」，等服务端问津。 */
async function askTheWay(page: Page) {
  await page.getByLabel('这一轮想说的话').fill('我想学布尔代数');
  await page.getByRole('button', { name: '提交这一轮' }).click();
  const options = page.getByRole('button', { name: /^选择：/ });
  await expect(options.first()).toBeVisible({ timeout: TIMEOUT });
  await expect(options).toHaveCount(4);
  return options;
}

test('点第 2 个选项：只发一轮、输入框不被写入，下一张卡出现', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await freshHome(page);
  const counter = countTurnRequests(page);

  const options = await askTheWay(page);

  // 键盘可达：Tab 序列里能落到选项上（不是只能拿鼠标点）。
  await options.nth(1).focus();
  await expect(options.nth(1)).toBeFocused();

  // 截图：展开的问津卡 + 悬停态（第二项高亮）。
  await options.nth(1).hover();
  await page.screenshot({ path: SHOT });

  const before = counter.value;
  await options.nth(1).click();

  // 下一轮真的回来了：学习日志出现第 2 轮（卡片按轮次渲染，不是气泡）。
  await expect(page.getByRole('button', { name: /第 2 轮/ })).toBeVisible({
    timeout: TIMEOUT,
  });
  expect(counter.value - before).toBe(1);

  // 选项原文不该被抄进输入框（否则下一轮会把选项当新问题再发一遍）。
  await expect(page.getByLabel('这一轮想说的话')).toHaveValue('');
});

test('发送中连点两次：只发出 1 次请求', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await freshHome(page);
  const counter = countTurnRequests(page);

  await askTheWay(page);

  const before = counter.value;
  // 同一个任务里同步点两下：第二下发生在 React 重渲之前（按钮还没 disabled），
  // 靠的是 HomePage 里那个同步置位的 ref 守卫。
  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[aria-label^="选择："]'),
    );
    const second = buttons[1];
    second?.click();
    second?.click();
  });

  await expect(page.getByRole('button', { name: /第 2 轮/ })).toBeVisible({
    timeout: TIMEOUT,
  });
  expect(counter.value - before).toBe(1);
});
