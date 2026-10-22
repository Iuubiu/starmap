/** 直接打 reply 接口，看 acknowledge 那轮返回的 action / question 到底是什么。 */
const API = 'http://127.0.0.1:3001';
const sid = `ses-reply-${Date.now()}`;
const post = (p, b) =>
  fetch(`${API}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());

await post('/api/v1/agent/turns', { sessionId: sid, utterance: '给我一张关卡，我想做题。', microKpId: 'kp-bool', tier: 'P2' });
const t2 = await post('/api/v1/agent/turns', {
  sessionId: sid,
  utterance: '先别给答案，问我一个问题，看我懂不懂。',
  microKpId: 'kp-bool',
  tier: 'P2',
});
const probeId = t2.artifact?.probeId;
console.log('probe:', probeId, '| Q0:', t2.artifact?.question, '| kind:', t2.artifact?.inputKind);

const answers = [
  'A + A·B = A，因为 A·(1+B) = A·1 = A，1+B 恒等于 1。',
  '我想是 A 吧，因为 A 乘 1 还是 A。',
  '嗯……不太确定，可能是 A？',
];
for (const [i, replyText] of answers.entries()) {
  const r = await post(`/api/v1/agent/probes/${probeId}/replies`, { replyText });
  console.log(
    `轮 ${i + 1}: action=${r.action} replyKind=${r.replyKind} exited=${r.ladder?.exited} level=${r.ladder?.level}`,
  );
  console.log(`   question=${JSON.stringify(r.question)}`);
  console.log(`   reason=${r.actionReason}`);
}
