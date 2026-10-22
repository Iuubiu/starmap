// 量一次真实回合的端到端耗时（含模型），给「演示会不会卡」提供数字。
const utt = ['我想学布尔代数', '吸收律是什么意思', '能给我一道练习题吗', '这个和德摩根律什么关系', '下一步学什么', '帮我复习一下'];
const sid = `ses-demo-lat-${Date.now()}`;
const out = [];
for (const [i, u] of utt.entries()) {
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:3001/api/v1/agent/turns', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: sid, utterance: u, tier: 'P3', turnId: `lat-${i}-${Date.now()}` }),
  });
  const ms = Date.now() - t0;
  const body = await res.json().catch(() => ({}));
  out.push({ i, ms, status: res.status, kind: body.artifact?.kind ?? body.errorCard ? 'error_card' : (body.artifact?.kind ?? 'none'), degraded: !!body.degraded });
  console.log(`${String(i).padStart(2)} ${String(ms).padStart(6)}ms ${res.status} kind=${body.artifact?.kind ?? '-'} degraded=${!!body.degraded}`);
}
const ms = out.map(o => o.ms).sort((a,b)=>a-b);
console.log(`\nmin=${ms[0]} p50=${ms[Math.floor(ms.length/2)]} max=${ms[ms.length-1]} degraded=${out.filter(o=>o.degraded).length}/${out.length}`);
