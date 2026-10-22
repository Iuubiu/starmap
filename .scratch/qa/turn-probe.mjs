const body = { utterance: '我想学布尔代数的吸收律', sessionId: 'qa-probe-2' };
const res = await fetch('http://127.0.0.1:3001/api/v1/agent/turns', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const json = await res.json();
console.log('status', res.status);
console.log('visible', json.visibleResponse);
console.log('kind', json.artifact?.kind, '| title', json.artifact?.title, '| kp', json.artifact?.microKpId);
console.log('degraded', json.degraded, 'retry', json.retryCount);
