/** 找出「带 microKpId 时」哪些话会产出 probe_form / level_card，供 S2/S5 场景用确定性输入。 */
const API = 'http://127.0.0.1:3001';
const stamp = Date.now();
const utterances = [
  '给我一张关卡，我想做题。',
  '我想练一道关于吸收律的题。',
  '先考考我，看我懂不懂吸收律。',
  '别给答案，先问我一个问题。',
  '你问我一个概念性的问题吧。',
  '我想检验一下自己，你出个问题。',
];
for (const [i, utterance] of utterances.entries()) {
  const res = await fetch(`${API}/api/v1/agent/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: `ses-kinds-${stamp}-${i}`, utterance, microKpId: 'kp-bool', tier: 'P2' }),
  });
  const json = await res.json();
  const a = json.artifact ?? {};
  console.log(
    `${res.status} kind=${a.kind} levelId=${a.levelId ?? '-'} probeId=${a.probeId ?? '-'} q=${JSON.stringify((a.question ?? '').slice(0, 30))} :: ${utterance}`,
  );
}
