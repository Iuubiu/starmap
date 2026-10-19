import json,urllib.request
pkgs=["mastra","@mastra/core","@mastra/client-js","@mastra/libsql","@mastra/pg","@mastra/memory","@mastra/loggers","@mastra/evals","@mastra/rag","@mastra/mcp","@mastra/server","@mastra/express","@mastra/hono"]
for p in pkgs:
    try:
        u="https://registry.npmjs.org/"+p.replace("/","%2f")
        with urllib.request.urlopen(u,timeout=30) as r:
            j=json.loads(r.read().decode())
        dt=j.get("dist-tags",{})
        latest=dt.get("latest")
        t=j.get("time",{}).get(latest,"")
        print(f"{p:22s} latest={latest:20s} {t[:10]}")
    except Exception as e:
        print(f"{p:22s} ERR {e}")
