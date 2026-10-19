import json,urllib.request
for d in ["10.1007/978-3-030-52240-7_16","10.1145/3772318.3791631"]:
    try:
        r=urllib.request.urlopen("https://api.crossref.org/works/"+d,timeout=25).read()
        m=json.loads(r)["message"]
        print("OK  ",d,"|",(m.get("published") or m.get("published-print") or {}).get("date-parts",[[None]])[0][0],"|",(m.get("title") or [""])[0][:90])
    except Exception as e:
        print("FAIL",d,e)
