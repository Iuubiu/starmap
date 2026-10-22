/** 看 t49 修好后：不带 microKpId 的回合会落到哪个知识点、产出哪种卡。 */
const API = 'http://127.0.0.1:3001';
const sid = `ses-focus-${Date.now()}`;
const post = (p, b) =>
  fetch(`${API}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const utterances = [
  '我想学核电子学，从哪里开始',
  '给我一张关卡，我想做题。',
  '先别给答案，问我一个问题。',
];
for (const u of utterances) {
  const r = await post('/api/v1/agent/turns', { sessionId: sid, utterance: u, tier: 'P2' });
  const a = r.body.artifact ?? {};
  console.log(
    `[${r.status}] ${u}\n  kind=${a.kind} kp=${JSON.stringify(a.microKpId)} title=${JSON.stringify(
      a.title,
    )} levelId=${a.levelId ?? '-'} probeId=${a.probeId ?? '-'}`,
  );
}
