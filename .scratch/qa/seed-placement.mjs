/**
 * 演示前置：把「我一个人」的定级档案建出来（placement_profile 当前是空的）。
 *
 * 为什么需要它：`demo-set-tier.mjs` 只在**已有**定级档案时才能切档位；
 * 档案是定级流程的产物，不能凭空 INSERT（那等于手改数据库，验收明确禁止）。
 * 所以这里走一遍真实的定级接口：自评 → 建会话 → 逐题作答 → 拿到结果，
 * 档案由服务端自己 upsert。
 *
 * 用法：node .scratch/qa/seed-placement.mjs [--check]
 */
const API = 'http://127.0.0.1:3001';

async function j(pathname, init) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${pathname} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

if (process.argv.includes('--check')) {
  const p = await j('/api/v1/placement');
  console.log('PLACEMENT ' + JSON.stringify(p));
  process.exit(0);
}

const form = await j('/api/v1/placement/self-assessment');
// 每个问题选中间那个选项：既不装懂也不装不会，让档位来自真实作答。
const answers = form.questions.map((q) => ({
  questionId: q.id,
  optionId: q.options[Math.min(1, q.options.length - 1)].id,
}));

const first = await j('/api/v1/placement/sessions', {
  method: 'POST',
  body: JSON.stringify({ selfAssessment: answers }),
});

// 作答接口回的是 `{ itemId, correct, ..., session }` —— 会话在 `session` 里，
// 不是响应本身。第一版直接把响应当成会话，`session.item` 是 undefined，
// 循环立刻退出，于是 `result` 报 409「这次定级还没结束」。
let session = first;
let answered = 0;
while (session.item) {
  const item = session.item;
  // 一律选 0 号选项：种子档案只为了让 demo-set-tier 有行可切，
  // 档位随后由脚本覆盖，这里的正确率不影响演示。
  const reply = await j(`/api/v1/placement/sessions/${session.sessionId}/answers`, {
    method: 'POST',
    body: JSON.stringify({ itemId: item.itemId, answer: 0 }),
  });
  session = reply.session;
  answered += 1;
  if (answered > 30) throw new Error('定级没有停下来：超过 30 题');
}

const result = await j(`/api/v1/placement/sessions/${first.sessionId}/result`);
console.log(`SEEDED answered=${answered} tier=${result.tier} status=${result.status}`);
