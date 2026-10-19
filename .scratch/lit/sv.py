import sys, re, urllib.request

urls = [l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip()]
for u in urls:
    try:
        req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"})
        html = urllib.request.urlopen(req, timeout=40).read().decode("utf-8", "ignore")
    except Exception as e:
        print("ERR", u, e); continue
    m = re.search(r'<meta name="dc.description" content="(.*?)"\s*/?>', html, re.S) or \
        re.search(r'<meta name="description" content="(.*?)"\s*/?>', html, re.S)
    print("###", u)
    if m:
        t = re.sub(r"<[^>]+>", " ", m.group(1))
        t = t.replace("&#x2019;", "'").replace("&quot;", '"').replace("&amp;", "&").replace("&lt;","<").replace("&gt;",">")
        print(re.sub(r"\s+", " ", t)[:2200])
    else:
        print("(no meta description)")
    print()
