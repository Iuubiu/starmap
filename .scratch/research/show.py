import json, sys, os, glob
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
base = os.path.dirname(os.path.abspath(__file__))
dirs = ["ds1", "ds3", "ds6", "ds9", "ds11", "ds13", "ds15"]
pats = [a for a in sys.argv[1:] if a] or ["*"]
files = []
for d in dirs:
    for p in pats:
        files += sorted(glob.glob(os.path.join(base, d, p + ".json")))
for f in files:
    d = json.load(open(f, encoding="utf-8"))
    print("\n######", os.path.basename(f)[:-5], "|", d["query"])
    for i, r in enumerate(d["results"][:6], 1):
        s = (r.get("summary") or r.get("snippet") or "").replace("\n", " ")
        s = " ".join(s.split())
        print(f'  [{i}] {r.get("title","")[:95]}')
        print(f'      {r.get("url","")[:125]}  ({r.get("site_name","")}, {str(r.get("date",""))[:10]}, a={r.get("authority","")})')
        if s:
            print("      ", s[:250])
