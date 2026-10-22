/** 两轮流程：第一轮不选 kp（服务端按推荐挑焦点），第二轮带上一轮的 kp 要关卡。 */
const API = 'http://127.0.0.1:3001';
const sid = `ses-two-${Date.now()}`;
const post = (p, b) =>
  fetch(`${API}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const t1 = await post('/api/v1/agent/turns', {
  sessionId: sid,
  utterance: '我想学核电子学，从哪里开始',
  tier: 'P2',
});
const kp = t1.body.artifact?.microKpId || '';
console.log(`轮1: kind=${t1.body.artifact?.kind} kp=${JSON.stringify(kp)}`);

for (const u of ['给我一张关卡，我想做题。', '我想练一练这个知识点。']) {
  const t2 = await post('/api/v1/agent/turns', { sessionId: sid, utterance: u, microKpId: kp, tier: 'P2' });
  const a = t2.body.artifact ?? {};
  console.log(
    `轮2「${u}」: kind=${a.kind} levelId=${a.levelId ?? '-'} items=${a.itemCount ?? '-'} title=${JSON.stringify(a.title)}`,
  );
}
