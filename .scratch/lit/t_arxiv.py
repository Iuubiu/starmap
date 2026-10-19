import urllib.request, sys
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
u="http://export.arxiv.org/api/query?search_query=all:SimStudent&max_results=5"
try:
    with urllib.request.urlopen(u, timeout=40) as r:
        b=r.read().decode("utf-8","replace")
    print("OK", len(b))
    print(b[:1500])
except Exception as e:
    print("FAIL", repr(e))
