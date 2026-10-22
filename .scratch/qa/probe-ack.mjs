/** 确认 acknowledge 那一轮的响应形状：question 是不是同一个问题、ladder 怎么变。 */
const API = 'http://127.0.0.1:3001';

const post = async (p, body) => {
  const res = await fetch(`${API}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const start = await post('/api/v1/agent/probes', { microKpId: 'kp-bool', tier: 'P1' });
console.log('start', start.status, JSON.stringify(start.body));
const probeId = start.body.probeId;
const q1 = start.body.ladder ? null : null;

for (const [label, replyText] of [
  ['答对', '吸收律是 A + A·B = A，因为 A(1+B) = A'],
  ['再说一遍', '就是 A 加 A 与 B 等于 A'],
  ['不知道', '不知道'],
]) {
  const r = await post(`/api/v1/agent/probes/${probeId}/replies`, { replyText });
  console.log(
    label,
    r.status,
    JSON.stringify({
      replyKind: r.body?.replyKind,
      action: r.body?.action,
      actionReason: r.body?.actionReason,
      question: r.body?.question,
      ladder: r.body?.ladder,
    }),
  );
}
