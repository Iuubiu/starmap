/** 找出「在真实 UI 上如何产出 level_card」：带 kp 与不带 kp 各试几种说法。 */
const API = 'http://127.0.0.1:3001';
const post = (b) =>
  fetch(`${API}/api/v1/agent/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(b),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const utterances = ['给我一张关卡，我想做题。', '我想练题', '出一张关卡给我', '我想做题'];
for (const kp of [null, 'kp-bool']) {
  const sid = `ses-lc3-${kp ?? 'none'}-${Date.now()}`;
  for (const u of utterances) {
    const b = { sessionId: sid, utterance: u, tier: 'P2' };
    if (kp) b.microKpId = kp;
    const r = await post(b);
    const a = r.body.artifact ?? {};
    console.log(
      `[${kp ?? '-'}] ${u}\n  ${r.status} kind=${a.kind} kp=${a.microKpId} levelId=${a.levelId ?? '-'}`,
    );
  }
}
