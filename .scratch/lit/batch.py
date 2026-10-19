import json,sys,subprocess,urllib.request,os
KEY="sk-3da48e25a4164810a0ae940318a8518b"
def search(q,n=8):
    req=urllib.request.Request("https://api.deepseek.com/v1/tools/search",
        data=json.dumps({"query":q,"max_results":n}).encode(),
        headers={"Authorization":"Bearer "+KEY,"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(req,timeout=90))
qs=json.load(open(sys.argv[1],encoding="utf-8"))
out=open(sys.argv[2],"w",encoding="utf-8")
for q in qs:
    out.write("\n\n########## QUERY: %s\n"%q)
    try:
        r=search(q)
        for i,x in enumerate(r.get("results",[])):
            out.write("\n[%d] %s\n  url: %s\n  site: %s  authority: %s  date: %s\n"%(i+1,x.get("title",""),x.get("url",""),x.get("site_name"),x.get("authority"),x.get("date")))
            s=(x.get("summary") or "")[:1200]
            out.write("  summary: %s\n"%s.replace("\n"," "))
            sn=(x.get("snippet") or "")[:400]
            if sn: out.write("  snippet: %s\n"%sn.replace("\n"," "))
    except Exception as e:
        out.write("  ERROR %r\n"%e)
    out.flush()
out.close()
print("done")
