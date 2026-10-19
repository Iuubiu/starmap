#!/usr/bin/env python3
"""Batch search via DeepSeek search API, parallel, compact output."""
import json
import sys
import concurrent.futures as cf
import urllib.request, urllib.error

KEY = "sk-3da48e25a4164810a0ae940318a8518b"
BASE = "https://api.deepseek.com/v1/tools"

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def post(path, payload):
    req = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", "Bearer " + KEY)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, repr(e)


def one(q, n=6, lim=900):
    st, body = post("/search", {"query": q, "max_results": n})
    if st != 200:
        return q, "FAILED %s %s" % (st, body[:200])
    d = json.loads(body)
    lines = []
    for i, r in enumerate((d.get("results") or [])[:n], 1):
        s = (r.get("summary") or r.get("snippet") or "").replace("\n", " ")
        lines.append("[%d] %s\n    %s\n    %s (%s)" % (i, r.get("title"), r.get("url"), s[:lim], (r.get("date") or "")[:10]))
    return q, "\n".join(lines)


if __name__ == "__main__":
    qs = json.load(open(sys.argv[1], encoding="utf-8"))
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(one, q, n): q for q in qs}
        for f in cf.as_completed(futs):
            q, txt = f.result()
            print("\n\n########## Q: " + q + "\n" + txt)
