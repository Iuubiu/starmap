"""量真实 agent 回合的耗时分布。

场景 17/20 在 30s / 90s 内等不到 `settled()`。要分清「产品慢」与「等待判据
写错」，先要一个可信的耗时分布：连打 8 轮，报 min / median / max。
"""
import json
import statistics
import time
import urllib.request
import uuid

URL = 'http://127.0.0.1:3001/api/v1/agent/turns'
UTTERANCES = [
    '我想学布尔代数',
    '吸收律是什么意思',
    '为什么 A + A·B = A',
    '能给我一道练习题吗',
    '我答错了，错在哪',
    '再举一个例子',
    '这个和德摩根律什么关系',
    '我该怎么验证自己会了',
]

samples = []
for i, utterance in enumerate(UTTERANCES, 1):
    body = json.dumps({
        'sessionId': f'ses-lat2-{uuid.uuid4().hex[:8]}',
        'utterance': utterance,
    }).encode()
    req = urllib.request.Request(URL, data=body, headers={'content-type': 'application/json'})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = json.loads(resp.read())
        elapsed = time.monotonic() - t0
        samples.append(elapsed)
        art = payload.get('artifact') or {}
        print(f'{i}. {elapsed:6.1f}s  degraded={payload.get("degraded")}  kind={art.get("kind")}')
    except Exception as exc:  # noqa: BLE001
        elapsed = time.monotonic() - t0
        samples.append(elapsed)
        print(f'{i}. {elapsed:6.1f}s  FAILED: {exc}')

print()
print(f'n={len(samples)}  min={min(samples):.1f}s  median={statistics.median(samples):.1f}s  '
      f'max={max(samples):.1f}s  >30s={sum(1 for s in samples if s > 30)}')
