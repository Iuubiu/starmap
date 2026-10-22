/** 验证「真实 UI 路径」能否从 level_card 会话继续拿到 probe_form（S2→S5 连续性）。 */
import { chromium } from '@playwright/test';

const API = 'http://127.0.0.1:3001';
const WEB = 'http://localhost:5173';
const stamp = Date.now();
const sessionId = `ses-cont-${stamp}`;

const seed = await fetch(`${API}/api/v1/agent/turns`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId, utterance: '给我一张关卡，我想做题。', microKpId: 'kp-bool', tier: 'P2' }),
}).then((r) => r.json());
console.log('seed kind =', seed.artifact?.kind, seed.artifact?.levelId);

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'zh-CN' });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));

await page.goto(WEB, { waitUntil: 'domcontentloaded' });
await page.evaluate((s) => localStorage.setItem('starmap.session', s), sessionId);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.locator('[aria-label^="第 1 轮"]').first().click();
await page.waitForTimeout(1200);

const kpBadge = await page.evaluate(() => {
  const el = Array.from(document.querySelectorAll('*')).find((n) => n.textContent?.trim() === '当前知识点');
  return el?.parentElement?.innerText.replace(/\s+/g, ' ') ?? '(no badge row)';
});
console.log('kp 行 =', kpBadge);

// 从 UI 提交第二句
await page.getByPlaceholder(/说说你想学什么/).fill('先别给答案，问我一个问题，看我懂不懂。');
await page.getByRole('button', { name: '提交这一轮' }).click();
await page.waitForTimeout(8000);

const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('第二轮卡含「追问」:', txt.includes('追问'), '| 含「提示等级」:', /提示等级/.test(txt));
console.log('有追问作答输入框:', (await page.getByLabel('追问作答').count()) > 0);
const btns = await page.locator('button').evaluateAll((ns) => ns.map((n) => n.textContent.trim()).filter(Boolean));
console.log('按钮:', JSON.stringify(btns));
console.log('errors:', errs.filter((e) => !e.includes('Keyborg')).join(' | ') || '(none)');
await browser.close();
