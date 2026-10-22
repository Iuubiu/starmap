/** 核对：关卡卡上的「题目数」与实际关卡里的题数是否一致。 */
const API = 'http://127.0.0.1:3001';

const turn = await (
  await fetch(`${API}/api/v1/agent/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: `ses-card-${Date.now()}`,
      utterance: '给我一张关卡，我想做题。',
      microKpId: 'kp-bool',
      tier: 'P1',
    }),
  })
).json();

const a = turn.artifact;
console.log('卡 kind =', a?.kind, '| levelId =', a?.levelId, '| 卡上题目数 =', a?.itemCount);

const detail = await (await fetch(`${API}/api/v1/levels/${a.levelId}`)).json();
const spec = detail.level?.spec ?? detail.spec ?? detail;
const items = spec.items ?? [];
console.log('关卡 spec.items 长度 =', items.length);
console.log('关卡 spec.steps 长度 =', (spec.steps ?? []).length);
const kinds = {};
for (const it of items) kinds[it.kind] = (kinds[it.kind] ?? 0) + 1;
console.log('题种分布 =', kinds);
const judged = items.filter((i) => (spec.steps ?? []).some((s) => (s.itemIds ?? []).includes(i.id)));
console.log('被 steps 引用的题数 =', judged.length);
console.log('卡上 estimatedMinutes =', a?.estimatedMinutes, '| firstStepKind =', a?.firstStepKind);
