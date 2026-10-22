const API = 'http://127.0.0.1:3001';
const ses = 'ses-qa-rot-' + Date.now();
const utts = [
  '给我一张关卡，我想做题。',
  '我想练布尔代数',
  '给我一张关卡',
  '有练习题吗',
  '我想做点题巩固一下',
];
for (const u of utts) {
  const r = await fetch(`${API}/api/v1/agent/turns`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: ses, utterance: u, tier: 'P2' }),
  });
  const j = await r.json();
  console.log(r.status, j.artifact?.kind, '|', j.artifact?.microKpId, '|', j.artifact?.title, '| level:', j.artifact?.levelId ?? '-');
}
