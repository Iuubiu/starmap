/** 带显式 microKpId 时，各种说法分别产出哪种卡（S2 需要 level_card）。 */
const API = 'http://127.0.0.1:3001';
const sid = `ses-focus2-${Date.now()}`;
const post = (p, b) =>
  fetch(`${API}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const utterances = [
  '给我一张关卡，我想做题。',
  '我想练一练布尔代数。',
  '先别给答案，问我一个问题。',
];
for (const u of utterances) {
  const r = await post('/api/v1/agent/turns', {
    sessionId: sid,
    utterance: u,
    microKpId: 'kp-bool',
    tier: 'P2',
  });
  const a = r.body.artifact ?? {};
  console.log(
    `[${r.status}] ${u}\n  kind=${a.kind} kp=${JSON.stringify(a.microKpId)} title=${JSON.stringify(
      a.title,
    )} levelId=${a.levelId ?? '-'} items=${a.itemCount ?? '-'} rationale=${JSON.stringify(
      (a.rationale ?? '').slice(0, 40),
    )}`,
  );
}
