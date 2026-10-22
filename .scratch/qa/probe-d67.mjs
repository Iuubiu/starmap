import { chromium } from '@playwright/test';
const API='http://127.0.0.1:3001';
const b=await chromium.launch(); const p=await (await b.newContext()).newPage();
await p.goto('http://localhost:5173/');
// 用 UI 提交一轮，但先通过 localStorage 注入 kp? 不行——没有入口。改用 API 预置会话再刷新后点击日志。
const ses='ses-d67-'+Date.now();
await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:'我不太懂吸收律，你问我一个问题。',microKpId:'kp-bool',tier:'P2'})});
await p.evaluate(s=>localStorage.setItem('starmap.session',s), ses);
await p.reload(); await p.waitForTimeout(2500);
await p.locator('[aria-label^="第 1 轮"]').first().click();
await p.waitForTimeout(2500);
const ta=p.getByLabel('追问作答');
console.log('D6 probe panel after log recall:', await ta.count());
// D7: 看 judge
await ta.fill('因为 A=1 时 A 或 (A 与 B) 恒为 1。');
const rep=p.waitForResponse(x=>x.url().includes('/replies')&&x.request().method()==='POST',{timeout:120000});
await p.getByRole('button',{name:'提交这一问的回答'}).click();
const rb=await (await rep).json();
console.log('D7', JSON.stringify({replyKind:rb.replyKind,action:rb.action,judge:rb.judge,fallback:rb.fallbackApplied,ladder:rb.ladder}));
await b.close();
