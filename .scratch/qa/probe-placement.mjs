const API = 'http://127.0.0.1:3001';
async function j(p, init) {
  const res = await fetch(`${API}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}
const form = (await j('/api/v1/placement/self-assessment')).body;
const answers = form.questions.map((q) => ({ questionId: q.id, optionId: q.options[Math.min(1, q.options.length - 1)].id }));
const first = await j('/api/v1/placement/sessions', { method: 'POST', body: JSON.stringify({ selfAssessment: answers }) });
console.log('start', first.status, JSON.stringify(first.body).slice(0, 300));
let s = first.body;
let n = 0;
while (s.item && n < 40) {
  const r = await j(`/api/v1/placement/sessions/${s.sessionId}/answers`, { method: 'POST', body: JSON.stringify({ itemId: s.item.itemId, answer: 0 }) });
  if (r.status !== 200 && r.status !== 201) { console.log('answer fail', r.status, JSON.stringify(r.body).slice(0,200)); break; }
  s = r.body.session;
  n++;
  console.log(n, 'answered=', s.answered, 'stop=', JSON.stringify(s.stop), 'remaining=', s.remainingItems);
}
const res = await j(`/api/v1/placement/sessions/${first.body.sessionId}/result`);
console.log('result', res.status, JSON.stringify(res.body).slice(0, 400));
