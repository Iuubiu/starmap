/**
 * 冷启动会话能不能自然产出 level_card？
 * 若 6 句话里一次都没出，就说明「模型自发填 plan.microKpId」这条路在真实提示词下不成立。
 */
const API = 'http://127.0.0.1:3001';
const stamp = Date.now();
const sessionId = `ses-s2n-${stamp}`;
const utterances = [
  '我想学布尔代数里的吸收律，直接给我一道题练练。',
  '带我做一关关于吸收律的练习吧。',
  '我想做题，关于逻辑代数基本律。',
  '吸收律我会一点，想通过做题巩固。',
  '给我一张关卡。',
  '我想练习 A + A·B = A 这类式子。',
];
for (const utterance of utterances) {
  const res = await fetch(`${API}/api/v1/agent/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, utterance, tier: 'P2' }),
  });
  const json = await res.json();
  console.log(
    `${String(res.status)} kind=${json.artifact?.kind} kp=${JSON.stringify(json.artifact?.microKpId)} levelId=${json.artifact?.levelId ?? '-'} :: ${utterance}`,
  );
}
