import { chromium } from '@playwright/test';
const API='http://127.0.0.1:3001';
const ses='ses-s5d-'+Date.now();
await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:'我不太懂吸收律，你问我一个问题帮我理理。',microKpId:'kp-bool',tier:'P2'})});
const b=await chromium.launch(); const ctx=await b.newContext(); const p=await ctx.newPage();
const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Keyborg/.test(m.text()))errs.push(m.text());});
await p.goto('http://localhost:5173/');
await p.evaluate(s=>localStorage.setItem('starmap.session',s), ses);
await p.reload(); await p.waitForTimeout(2000);
await p.locator('[aria-label^="第 1 轮"]').first().click();
await p.waitForTimeout(2500);
const ta = p.getByLabel('追问作答');
console.log('追问作答 count:', await ta.count(), '| 提交这一问 count:', await p.getByRole('button',{name:'提交这一问的回答'}).count());
const txt=await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
console.log('提助等级 typo:', /提助等级/.test(txt), '| 追问记录:', /追问记录|第 1 轮/.test(txt));
if(await ta.count()){
  await ta.fill('因为 A=1 时 A 或 (A 与 B) 恒为 1，B 不影响结果。');
  const rep=p.waitForResponse(x=>x.url().includes('/replies')&&x.request().method()==='POST',{timeout:120000});
  await p.getByRole('button',{name:'提交这一问的回答'}).click();
  const res=await rep; const rb=await res.json();
  console.log('reply', res.status(), rb.replyKind, rb.action, rb.ladder?.level+'/'+rb.ladder?.cap, 'fallback', rb.fallbackApplied);
  await p.waitForTimeout(1500);
  console.log('textarea cleared:', (await ta.inputValue())==='');
  const t2=await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
  console.log('trail shown:', /第 1 轮/.test(t2), '| question changed:', rb.question?.slice(0,20));
}
console.log('errors:',errs);
await b.close();
