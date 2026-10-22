/**
 * S2 死锁的最后一次确认：不经 UI、只打接口，看 microKpId 缺失时到底会产出什么卡。
 * 三组对照：(a) 不带 microKpId (b) 带 microKpId (c) 带一个不存在的 microKpId。
 */
const API = 'http://127.0.0.1:3001';

async function turn(body) {
  const res = await fetch(`${API}/api/v1/agent/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return {
    status: res.status,
    kind: json.artifact?.kind,
    artifactMicroKpId: json.artifact?.microKpId,
    levelId: json.artifact?.levelId,
    title: json.artifact?.title,
    rationale: json.artifact?.rationale,
  };
}

const stamp = Date.now();
console.log('(a) 无 microKpId   ', JSON.stringify(await turn({ sessionId: `ses-s2a-${stamp}`, utterance: '我想学吸收律，给我一张关卡。', tier: 'P2' })));
console.log('(b) 有 microKpId   ', JSON.stringify(await turn({ sessionId: `ses-s2b-${stamp}`, utterance: '我想学吸收律，给我一张关卡。', microKpId: 'kp-bool', tier: 'P2' })));
console.log('(c) 假 microKpId   ', JSON.stringify(await turn({ sessionId: `ses-s2c-${stamp}`, utterance: '我想学吸收律，给我一张关卡。', microKpId: 'kp-does-not-exist', tier: 'P2' })));

// kp-bool 是否真的有 level？没有关卡时 level_card 会退化成 probe_form。
const detail = await fetch(`${API}/api/v1/nodes/kp-bool`).then((r) => r.json()).catch(() => null);
console.log('kp-bool 有 levelId? ', JSON.stringify(detail?.levelId ?? detail?.level ?? null).slice(0, 200));
