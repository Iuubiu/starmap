import json, urllib.request
KEY="sk-3da48e25a4164810a0ae940318a8518b"
BASE="https://api.deepseek.com/v1/tools"
def post(path,payload):
    req=urllib.request.Request(BASE+path,data=json.dumps(payload).encode(),method="POST")
    req.add_header("Content-Type","application/json"); req.add_header("Accept","application/json")
    req.add_header("Authorization","Bearer "+KEY)
    try:
        with urllib.request.urlopen(req,timeout=180) as r:
            return r.status, r.read().decode('utf-8','replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8','replace')

s,b = post("/search",{"query":"Mastra workflow suspend resume","max_results":3})
j=json.loads(b)
print("TOP KEYS:", list(j.keys()))
r0=j["results"][0]
print("RESULT KEYS:", list(r0.keys()))
for k,v in r0.items():
    sv=str(v)
    print(f"  {k}: {sv[:300]}")
print()
# test a plain fetch of a non-github page
s2,b2 = post("/fetch",{"url":"https://mastra.ai/docs/workflows/overview"})
j2=json.loads(b2) if s2==200 else {}
print("FETCH keys:", list(j2.keys()), "content len:", len(j2.get("content") or ""))
