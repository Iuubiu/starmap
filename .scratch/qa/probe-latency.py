"""量真实 agent 回合的端到端耗时（不是模型自己报的，是 HTTP 往返）。

场景 17/20 在 90s/30s 内等不到 `settled()`。要判断这是「产品慢」还是
「等待判据写错了」，得先有一个真实的秒数。
"""
import json
import time
import urllib.request
import uuid

URL = 'http://127.0.0.1:3001/api/v1/agent/turns'

for i, utterance in enumerate(['我想学布尔代数', '吸收律是什么意思', '能给我一道练习题吗'], 1):
    body = json.dumps({
        'sessionId': f'ses-lat-{uuid.uuid4().hex[:8]}',
        'utterance': utterance,
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={'content-type': 'application/json'})
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=300) as resp:
        payload = json.loads(resp.read())
    elapsed = time.monotonic() - t0
    art = payload.get('artifact') or {}
    print(f'{i}. {elapsed:6.1f}s  degraded={payload.get("degraded")}  kind={art.get("kind")}  kp={art.get("microKpId")}  {utterance}')
