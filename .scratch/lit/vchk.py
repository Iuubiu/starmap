import json,urllib.request,sys
dois=["10.1016/j.learninstruc.2025.102142","10.1002/j.2168-9830.2006.tb00894.x","10.1177/1745691613518075","10.1007/s10648-023-09814-5","10.3102/0034654316675417","10.1016/j.edurev.2018.02.002","10.3102/00346543211019105","10.1007/s10648-007-9049-0","10.1037/a0037123","10.3102/0034654315581420","10.1037/a0032447","10.1037/a0016496","10.1037/a0015729","10.1016/j.cedpsych.2010.10.004","10.1007/s10648-015-9310-x","10.1007/s40593-019-00176-0","10.1145/2876034.2893393"]
for d in dois:
    try:
        r=urllib.request.urlopen("https://api.crossref.org/works/"+d,timeout=25).read()
        m=json.loads(r)["message"]
        t=(m.get("title") or [""])[0]
        y=(m.get("published-print") or m.get("published") or {}).get("date-parts",[[None]])[0][0]
        print("OK  ",d,"|",y,"|",t[:80])
    except Exception as e:
        print("FAIL",d,e)
