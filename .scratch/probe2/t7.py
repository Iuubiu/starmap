import json, urllib.request, time, os
KEY="sk-3da48e25a4164810a0ae940318a8518b"
BASE="https://api.deepseek.com/v1/tools"
OUT=r"D:\DeepSeek\starmap\.scratch\mastra-research"
os.makedirs(OUT,exist_ok=True)
def post(path,payload):
    req=urllib.request.Request(BASE+path,data=json.dumps(payload).encode(),method="POST")
    req.add_header("Content-Type","application/json"); req.add_header("Accept","application/json")
    req.add_header("Authorization","Bearer "+KEY)
    try:
        with urllib.request.urlopen(req,timeout=180) as r:
            return r.status, r.read().decode('utf-8','replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8','replace')
    except Exception as e:
        return -1, repr(e)

targets = [
 ("skills_sandbox_docs", "https://mastra.ai/docs/sandbox/skills"),
 ("skills_fba_ref", "https://mastra.ai/reference/file-based-agents/skills"),
]
for name,url in targets:
    s,b = post("/fetch",{"url":url})
    if s==200:
        try:
            j=json.loads(b); c=j.get("content") or ""; t=j.get("title")
        except Exception:
            c=b; t=url
        p=os.path.join(OUT,name+".md")
        open(p,"w",encoding="utf-8").write("# "+str(t)+"\n\n"+c)
        print(f"OK {name} title={t} len={len(c)}")
    else:
        print(f"FAIL {name} status={s} {b[:200]}")
