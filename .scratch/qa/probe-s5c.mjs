import { chromium } from '@playwright/test';
const API='http://127.0.0.1:3001';
const ses='ses-s5c-'+Date.now();
const r=await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:'我不太懂吸收律，你问我一个问题帮我理理。',microKpId:'kp-bool',tier:'P2'})});
const body=await r.json();
console.log('kind', body.artifact?.kind, 'probeId', body.artifact?.probeId, 'inputKind', body.artifact?.inputKind, 'choices', body.artifact?.choices?.length);
const b=await chromium.launch(); const ctx=await b.newContext(); const p=await ctx.newPage();
const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Keyborg/.test(m.text()))errs.push(m.text());});
await p.goto('http://localhost:5173/');
await p.evaluate(s=>localStorage.setItem('starmap.session',s), ses);
await p.reload(); await p.waitForTimeout(2500);
const ta = p.getByLabel('追问作答');
console.log('追问作答 textarea count:', await ta.count());
console.log('提交这一问的回答 count:', await p.getByRole('button',{name:'提交这一问的回答'}).count());
const txt=await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
console.log('提助等级(typo) present:', /提助等级/.test(txt), '| 提示等级:', /提示等级/.test(txt));
if(await ta.count()){
  await ta.fill('因为 A 或 (A 与 B) 里 A=1 时结果总是 1，B 取什么都不影响。');
  const rep=p.waitForResponse(x=>x.url().includes('/replies')&&x.request().method()==='POST',{timeout:120000});
  await p.getByRole('button',{name:'提交这一问的回答'}).click();
  const res=await rep; const rb=await res.json();
  console.log('reply status', res.status(), 'replyKind', rb.replyKind, 'action', rb.action, 'level', rb.ladder?.level+'/'+rb.ladder?.cap, 'fallback', rb.fallbackApplied, 'judge', JSON.stringify(rb.judge));
  await p.waitForTimeout(1500);
  const txt2=await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '));
  console.log('trail visible:', /第 1 轮/.test(txt2));
  console.log('textarea cleared:', (await ta.inputValue())==='');
}
console.log('errors:',errs);
await b.close();
