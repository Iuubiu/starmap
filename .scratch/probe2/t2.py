import json, urllib.request, time
BASE="https://api.deepseek.com"; KEY="sk-3da48e25a4164810a0ae940318a8518b"
def call(path,payload=None,method="POST"):
    url=BASE+path; data=json.dumps(payload).encode() if payload else None
    req=urllib.request.Request(url,data=data,method=method)
    req.add_header("Content-Type","application/json"); req.add_header("Authorization","Bearer "+KEY)
    t0=time.time()
    try:
        with urllib.request.urlopen(req,timeout=90) as r:
            return r.status,r.read().decode('utf-8','replace'),time.time()-t0
    except urllib.error.HTTPError as e:
        return e.code,e.read().decode('utf-8','replace'),time.time()-t0
    except Exception as e:
        return -1,repr(e),time.time()-t0

# try various search tool shapes
shapes = [
 ("functions-search", {"model":"deepseek-flash","messages":[{"role":"user","content":"2024诺贝尔物理学奖得主是谁"}],
   "tools":[{"type":"function","function":{"name":"search","description":"web search","parameters":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}}]}),
 ("builtin-tools-str", {"model":"deepseek-flash","messages":[{"role":"user","content":"2024诺贝尔物理学奖得主是谁"}],"tools":["web_search"]}),
 ("extra_body-search", {"model":"deepseek-flash","messages":[{"role":"user","content":"2024诺贝尔物理学奖得主是谁"}],"web_search":{"enable":True}}),
]
for n,p in shapes:
    s,b,d = call("/chat/completions",p)
    print(f"\n=== {n} {s} {d:.2f}s"); print(b[:1200])
