/** S2/S5/S9 的「可复现路径」最后确认：API 预置会话 → localStorage → 刷新 → 断言控件。 */
import { chromium } from '@playwright/test';

const API = 'http://127.0.0.1:3001';
const WEB = 'http://localhost:5173';
const stamp = Date.now();

async function seed(utterance, kp) {
  const sessionId = `ses-s259-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${API}/api/v1/agent/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, utterance, microKpId: kp, tier: 'P2' }),
  });
  const json = await res.json();
  return { sessionId, status: res.status, kind: json.artifact?.kind, artifact: json.artifact, turnId: json.turnId };
}

const browser = await chromium.launch();
const page = await browser.newPage({ locale: 'zh-CN' });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const lvl = await seed('给我一张关卡，我想做题。', 'kp-bool');
console.log('seed level_card →', lvl.status, lvl.kind, lvl.artifact?.levelId);

await page.goto(WEB, { waitUntil: 'domcontentloaded' });
await page.evaluate((sid) => localStorage.setItem('starmap.session', sid), lvl.sessionId);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('--- 首页文本（前 300）---\n' + body.slice(0, 300));

const links = await page.evaluate(() =>
  Array.from(document.querySelectorAll('a[href]')).map((a) => `${a.getAttribute('href')} :: ${(a.textContent ?? '').trim().slice(0, 20)}`),
);
console.log('--- 链接 ---\n' + links.join('\n'));

const buttons = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()).filter(Boolean),
);
console.log('--- 按钮 ---\n' + buttons.join(' | '));

// 关卡卡里的字段
const cardText = await page.evaluate(() => {
  const el = Array.from(document.querySelectorAll('*')).find((n) => (n.textContent ?? '').includes('预计用时'));
  return el ? el.closest('[class*="card"]')?.innerText ?? el.parentElement?.innerText ?? '' : '(没找到预计用时)';
});
console.log('--- 关卡卡文本 ---\n' + cardText.replace(/\s+/g, ' ').slice(0, 400));

// 直接去关卡页，确认 levelId 可用
const levelRes = await fetch(`${API}/api/v1/levels/${lvl.artifact.levelId}`);
console.log('GET /levels/' + lvl.artifact.levelId, levelRes.status);

console.log('--- errors ---\n' + (errors.join('\n') || '(none)'));
await browser.close();
