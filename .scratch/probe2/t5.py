import json, urllib.request, time, sys
KEY="sk-3da48e25a4164810a0ae940318a8518b"
BASE="https://api.deepseek.com/v1/tools"
def post(path,payload):
    req=urllib.request.Request(BASE+path,data=json.dumps(payload).encode(),method="POST")
    req.add_header("Content-Type","application/json"); req.add_header("Accept","application/json")
    req.add_header("Authorization","Bearer "+KEY)
    t0=time.time()
    try:
        with urllib.request.urlopen(req,timeout=180) as r:
            return r.status, r.read().decode('utf-8','replace'), time.time()-t0
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8','replace'), time.time()-t0
    except Exception as e:
        return -1, repr(e), time.time()-t0

s,b,d = post("/search", {"query":"Mastra skills SKILL.md agent documentation","max_results":10})
print("SEARCH", s, f"{d:.2f}s")
j=json.loads(b)
for r in j.get("results",[]):
    print("-", r.get("url"), "|", r.get("title"))
