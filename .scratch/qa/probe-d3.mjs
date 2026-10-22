import { chromium } from '@playwright/test';
const API='http://127.0.0.1:3001';
const ses='ses-d3-'+Date.now();
await fetch(`${API}/api/v1/agent/turns`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:ses,utterance:'我不太懂吸收律，你问我一个问题帮我理理。',microKpId:'kp-bool',tier:'P2'})});
const b=await chromium.launch(); const ctx=await b.newContext(); const p=await ctx.newPage();
await p.goto('http://localhost:5173/');
await p.evaluate(s=>localStorage.setItem('starmap.session',s), ses);
await p.reload(); await p.waitForTimeout(3000);
const center = await p.evaluate(()=>{
  const main=document.querySelector('main')??document.body;
  return main.innerText.replace(/\s+/g,' ').slice(0,300);
});
console.log('CENTER AFTER RELOAD:', center);
console.log('追问作答:', await p.getByLabel('追问作答').count());
console.log('空态文案 present:', /还没有记录|说一句你想学什么/.test(await p.evaluate(()=>document.body.innerText)));
await b.close();
