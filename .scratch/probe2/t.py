import json, urllib.request, time

BASE = "https://api.deepseek.com"
KEY = "sk-3da48e25a4164810a0ae940318a8518b"

def call(path, payload=None, method="POST"):
    url = BASE + path
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + KEY)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode('utf-8', 'replace')
            return r.status, body, time.time()-t0
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8','replace'), time.time()-t0
    except Exception as e:
        return -1, repr(e), time.time()-t0

# 1. models
s, b, d = call("/models", method="GET")
print("=== MODELS", s, f"{d:.2f}s")
print(b[:3000])

# 2. search tool probe
tests = [
  ("search-web", {"model":"deepseek-chat","messages":[{"role":"user","content":"2024诺贝尔物理学奖得主是谁"}],"tools":[{"type":"web_search"}]}),
  ("search-web2", {"model":"deepseek-chat","messages":[{"role":"user","content":"2024诺贝尔物理学奖得主是谁"}],"tools":[{"type":"web_search","web_search":{"enable":True}}]}),
]
for name, p in tests:
    s, b, d = call("/chat/completions", p)
    print(f"\n=== {name} {s} {d:.2f}s")
    print(b[:1500])
