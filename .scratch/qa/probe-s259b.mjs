/** S2/S5/S9 可复现路径：API 预置会话 → localStorage → 刷新 → 点日志行回看 → 断言控件。 */
import { chromium } from '@playwright/test';

const API = 'http://127.0.0.1:3001';
const WEB = 'http://localhost:5173';
const stamp = Date.now();

async function seed(utterance, kp) {
  const sessionId = `ses-s259b-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${API}/api/v1/agent/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, utterance, microKpId: kp, tier: 'P2' }),
  });
  const json = await res.json();
  return { sessionId, status: res.status, artifact: json.artifact, turnId: json.turnId };
}

const browser = await chromium.launch();

async function openWith(sessionId) {
  const ctx = await browser.newContext({ locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.evaluate((sid) => localStorage.setItem('starmap.session', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  return { page, ctx, errors };
}

// ---------- S2：关卡卡 ----------
const lvl = await seed('给我一张关卡，我想做题。', 'kp-bool');
console.log('S2 seed →', lvl.status, lvl.artifact?.kind, lvl.artifact?.levelId);
{
  const { page, ctx, errors } = await openWith(lvl.sessionId);
  const row = page.locator('[aria-label^="第 1 轮"]').first();
  console.log('S2 日志行可见:', await row.count(), '文本:', (await row.innerText().catch(() => '')).replace(/\s+/g, ' '));
  await row.click();
  await page.waitForTimeout(1500);
  const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('S2 卡区含「预计用时」:', txt.includes('预计用时'), '| 含「进入关卡」:', txt.includes('进入关卡'));
  const btns = await page.locator('button').evaluateAll((ns) => ns.map((n) => n.textContent.trim()).filter(Boolean));
  console.log('S2 按钮:', JSON.stringify(btns));
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')));
  console.log('S2 链接:', JSON.stringify(links));
  console.log('S2 卡区片段:', txt.slice(txt.indexOf('预计用时') - 60, txt.indexOf('预计用时') + 220));
  console.log('S2 errors:', errors.filter((e) => !e.includes('Keyborg')).join(' | ') || '(none)');
  await ctx.close();
}

// ---------- S5：追问表单 ----------
const prb = await seed('别给答案，先问我一个问题。', 'kp-bool');
console.log('\nS5 seed →', prb.status, prb.artifact?.kind, prb.artifact?.probeId, 'q=', (prb.artifact?.question ?? '').slice(0, 30));
{
  const { page, ctx, errors } = await openWith(prb.sessionId);
  const row = page.locator('[aria-label^="第 1 轮"]').first();
  await row.click();
  await page.waitForTimeout(1500);
  const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('S5 含「追问作答」输入框:', (await page.getByLabel('追问作答').count()) > 0);
  const btns = await page.locator('button').evaluateAll((ns) => ns.map((n) => n.textContent.trim()).filter(Boolean));
  console.log('S5 按钮:', JSON.stringify(btns));
  console.log('S5 文本片段:', txt.slice(0, 400));
  console.log('S5 errors:', errors.filter((e) => !e.includes('Keyborg')).join(' | ') || '(none)');
  await ctx.close();
}

// ---------- S9：会话恢复 ----------
{
  const ctx = await browser.newContext({ locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  const first = await page.evaluate(() => localStorage.getItem('starmap.session'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => localStorage.getItem('starmap.session'));
  console.log('\nS9 首次会话 id:', first, '| 刷新后:', after, '| 一致:', first === after);
  // 打一轮，刷新，看日志是否还在
  await page.getByPlaceholder(/说说你想学什么/).fill('我想学吸收律');
  await page.getByRole('button', { name: '提交这一轮' }).click();
  await page.waitForTimeout(4000);
  const beforeReload = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const afterReload = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const cnt = (s) => (s.match(/第 \d+ 轮|01 |02 /g) ?? []).length;
  console.log('S9 刷新前有「共 N 轮记录」:', /共 \d+ 轮记录/.exec(beforeReload)?.[0], '| 刷新后:', /共 \d+ 轮记录/.exec(afterReload)?.[0]);
  console.log('S9 刷新后日志区仍可见:', /学习日志/.test(afterReload));
  await ctx.close();
}

await browser.close();
