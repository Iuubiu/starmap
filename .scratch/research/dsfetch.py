import json, sys, os, concurrent.futures, urllib.request, re

KEY = os.environ.get("DEEPSEEK_SEARCH_KEY", "sk-3da48e25a4164810a0ae940318a8518b")
BASE = "https://api.deepseek.com/v1/tools"
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def post(path, payload):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + KEY)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:
        return {"error": repr(e)}


JOBS = json.load(open(sys.argv[1], encoding="utf-8"))
outdir = sys.argv[2]
os.makedirs(outdir, exist_ok=True)


def run(item):
    tag, url = item
    d = post("/fetch", {"url": url})
    c = d.get("content") or d.get("error") or ""
    with open(os.path.join(outdir, tag + ".md"), "w", encoding="utf-8") as f:
        f.write("# " + str(d.get("title", "")) + "\n" + url + "\n\n" + c)
    return tag, len(c)


with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
    for tag, n in ex.map(run, JOBS.items()):
        print(tag, n)
