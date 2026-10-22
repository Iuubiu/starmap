import { chromium } from '@playwright/test';
const API='http://127.0.0.1:3001';
const ses='ses-s2i-'+Date.now();
const r=await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:'给我安排一关，我想直接做题。',microKpId:'kp-bool',tier:'P2'})});
const body=await r.json();
console.log('API kind:', body.artifact?.kind, 'levelId:', body.artifact?.levelId);
const b=await chromium.launch();
const ctx=await b.newContext();
const p=await ctx.newPage();
const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:5173/');
await p.evaluate(s=>localStorage.setItem('starmap.session',s), ses);
await p.reload(); await p.waitForTimeout(2500);
const txt=await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
console.log('card visible:', /关卡/.test(txt));
console.log('has 进入关卡/去关卡/开始:', /进入关卡|去关卡|开始这一关/.test(txt));
const btns=await p.locator('button').evaluateAll(ns=>ns.map(n=>n.textContent.trim()).filter(Boolean));
console.log('buttons:',JSON.stringify(btns));
// 点日志行回看
const row=p.locator('[aria-label^="第 1 轮"]').first();
if(await row.count()){ await row.click(); await p.waitForTimeout(2000); }
const txt2=await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
console.log('after recall has level card:', /预计用时/.test(txt2), '| rationale visible:', /适合直接/.test(txt2)||/掌握/.test(txt2));
console.log('buttons after recall:',JSON.stringify(await p.locator('button').evaluateAll(ns=>ns.map(n=>n.textContent.trim()).filter(Boolean))));
console.log('errors:',errs);
await b.close();
