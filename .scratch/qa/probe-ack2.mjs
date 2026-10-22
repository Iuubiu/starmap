/** 验证追问答对后（acknowledge）面板是否还让人继续答同一个问题。 */
import { chromium } from '@playwright/test';

const API = 'http://127.0.0.1:3001';
const WEB = 'http://localhost:5173';
const stamp = Date.now();
const sessionId = `ses-ack-${stamp}`;

const t1 = await fetch(`${API}/api/v1/agent/turns`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId, utterance: '给我一张关卡，我想做题。', microKpId: 'kp-bool', tier: 'P2' }),
}).then((r) => r.json());
const t2 = await fetch(`${API}/api/v1/agent/turns`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId, utterance: '先别给答案，问我一个问题，看我懂不懂。', microKpId: 'kp-bool', tier: 'P2' }),
}).then((r) => r.json());
const probeId = t2.artifact?.probeId;
console.log('seed:', t1.artifact?.kind, '→', t2.artifact?.kind, probeId);
console.log('初始问题:', t2.artifact?.question);

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'zh-CN' });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(WEB, { waitUntil: 'domcontentloaded' });
await page.evaluate((s) => localStorage.setItem('starmap.session', s), sessionId);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.locator('[aria-label^="第 2 轮"]').first().click();
await page.waitForTimeout(1500);

const before = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('面板初始：有输入框', (await page.getByLabel('追问作答').count()) > 0);

// 用一个「像正确答案」的回答
await page.getByLabel('追问作答').fill('A + A·B = A，因为 A·(1+B) = A·1 = A，1+B 恒等于 1。');
await page.getByRole('button', { name: '提交这一问的回答' }).click();
await page.waitForTimeout(9000);

const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('--- 提交后可见文本（截取面板区）---');
const idx = after.indexOf('提助等级');
console.log(after.slice(Math.max(0, idx - 260), idx + 500));
console.log('提交后仍有输入框:', (await page.getByLabel('追问作答').count()) > 0);
const btns = await page.locator('button').evaluateAll((ns) => ns.map((n) => n.textContent.trim()).filter(Boolean));
console.log('按钮:', JSON.stringify(btns));
console.log('errors:', errs.join(' | ') || '(none)');

// 直接看接口返回
const apiAfter = await fetch(`${API}/api/v1/agent/probes/${probeId}`).then((r) => r.json()).catch((e) => ({ err: String(e) }));
console.log('GET probe →', JSON.stringify(apiAfter).slice(0, 500));
await browser.close();
