import json, sys, os, concurrent.futures, urllib.request

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


def search(q, n=8):
    return post("/search", {"query": q, "max_results": n}).get("results") or []


QUERIES = json.load(open(sys.argv[1], encoding="utf-8"))
outdir = sys.argv[2]
os.makedirs(outdir, exist_ok=True)


def run(item):
    tag, q = item
    res = search(q, 8)
    with open(os.path.join(outdir, tag + ".json"), "w", encoding="utf-8") as f:
        json.dump({"query": q, "results": res}, f, ensure_ascii=False, indent=1)
    return tag, len(res)


with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
    for tag, n in ex.map(run, QUERIES.items()):
        print(tag, n)
