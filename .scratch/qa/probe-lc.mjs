const API = 'http://127.0.0.1:3001';
const ses = 'ses-qa-lc-' + Date.now();
for (const u of ['给我一张关卡，我想做题。', '我想练布尔代数吸收律', '出一张关于布尔代数的关卡']) {
  const r = await fetch(`${API}/api/v1/agent/turns`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: ses, utterance: u, microKpId: 'kp-bool', tier: 'P2' }),
  });
  const j = await r.json();
  console.log(r.status, j.artifact?.kind, '|', j.artifact?.title, '| level:', j.artifact?.levelId ?? '-', '| items:', j.artifact?.itemCount ?? '-');
}
