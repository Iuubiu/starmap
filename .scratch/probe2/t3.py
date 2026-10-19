import json, urllib.request, time
KEY="sk-3da48e25a4164810a0ae940318a8518b"
BASE="https://api.deepseek.com/v1/tools"
def post(path,payload):
    req=urllib.request.Request(BASE+path,data=json.dumps(payload).encode(),method="POST")
    req.add_header("Content-Type","application/json"); req.add_header("Accept","application/json")
    req.add_header("Authorization","Bearer "+KEY)
    t0=time.time()
    try:
        with urllib.request.urlopen(req,timeout=120) as r:
            return r.status, r.read().decode('utf-8','replace'), time.time()-t0
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8','replace'), time.time()-t0
    except Exception as e:
        return -1, repr(e), time.time()-t0

s,b,d = post("/search", {"query":"Mastra AI framework 2026 workflow agent tool", "count":5, "need_content":False})
print(f"=== SEARCH {s} {d:.2f}s  len={len(b)}")
try:
    j=json.loads(b)
    if "results" in j:
        for i,r in enumerate(j["results"][:5]):
            print(f"\n[{i}] score={r.get('rerank_score')} auth={r.get('authority')} site={r.get('site_name')}")
            print("   ", r.get("title"))
            print("   ", r.get("url"))
            print("    snippet:", (r.get("snippet") or "")[:200])
            print("    summary:", (r.get("summary") or "")[:300])
    else:
        print(b[:1500])
except Exception as e:
    print("parse fail", e); print(b[:1500])
