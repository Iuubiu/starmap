/** 冷启动（无 microKpId）时后端产什么卡。 */
const API = 'http://127.0.0.1:3001';
const sid = `ses-cold-${Date.now()}`;
for (const utterance of ['给我一张关卡，我想做题。', '先别给答案，问我一个问题，看我懂不懂。']) {
  const r = await fetch(`${API}/api/v1/agent/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: sid, utterance, tier: 'P2' }),
  });
  const j = await r.json();
  console.log(utterance, '→', r.status, j.artifact?.kind ?? j.kind ?? JSON.stringify(j).slice(0, 200), '| microKpId=', j.artifact?.microKpId ?? j.microKpId);
}
