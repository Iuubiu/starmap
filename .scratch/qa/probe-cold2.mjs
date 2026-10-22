const API = 'http://127.0.0.1:3001';
const ses = 'ses-qa-cold-' + Date.now();
async function turn(utterance) {
  const r = await fetch(`${API}/api/v1/agent/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: ses, utterance, tier: 'P2' }),
  });
  const j = await r.json();
  return { status: r.status, kind: j.artifact?.kind, kp: j.artifact?.microKpId, title: j.artifact?.title, levelId: j.artifact?.levelId, q: j.artifact?.question?.slice(0,60) };
}
console.log('cold  ', JSON.stringify(await turn('你好')));
console.log('lv    ', JSON.stringify(await turn('给我一张关卡，我想做题。')));
console.log('probe ', JSON.stringify(await turn('别给答案，先问我一个问题。')));
