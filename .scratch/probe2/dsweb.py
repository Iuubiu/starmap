#!/usr/bin/env python3
"""DeepSeek Search API 检索工具（web_search / web_fetch 不可用时的替代）。

用法：
  python dsweb.py search "查询词" [max_results]     # 搜索，打印 title/url/date/summary
  python dsweb.py fetch "https://url" [outfile]     # 抓取网页，打印或写入 markdown

输出为 UTF-8 安全：Windows 控制台是 GBK，脚本内部已做 encode/decode 兜底。
API key 从环境变量 DEEPSEEK_SEARCH_KEY 读取，缺省用内置值。
"""
import json
import os
import sys
import urllib.error
import urllib.request

KEY = os.environ.get("DEEPSEEK_SEARCH_KEY", "sk-3da48e25a4164810a0ae940318a8518b")
BASE = "https://api.deepseek.com/v1/tools"


def _post(path, payload):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode("utf-8"), method="POST"
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    req.add_header("Authorization", "Bearer " + KEY)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return -1, repr(e)


try:  # Windows 控制台默认 GBK，强制 UTF-8 输出避免中文乱码
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass


def out(text):
    sys.stdout.write(text)
    sys.stdout.write("\n")
    sys.stdout.flush()


def search(query, max_results=10):
    status, body = _post("/search", {"query": query, "max_results": int(max_results)})
    if status != 200:
        out("SEARCH FAILED status=%s: %s" % (status, body[:500]))
        return 1
    data = json.loads(body)
    results = data.get("results") or []
    out("### %d results for: %s" % (len(results), query))
    for i, r in enumerate(results, 1):
        out("")
        out("[%d] %s" % (i, r.get("title")))
        out("    url:     %s" % r.get("url"))
        out("    site:    %s   authority: %s   date: %s"
            % (r.get("site_name"), r.get("authority"), (r.get("date") or "")[:10]))
        summary = (r.get("summary") or r.get("snippet") or "").strip()
        if summary:
            out("    summary: " + summary.replace("\n", "\n             ")[:1600])
    return 0


def fetch(url, outfile=None):
    status, body = _post("/fetch", {"url": url})
    if status != 200:
        out("FETCH FAILED status=%s: %s" % (status, body[:500]))
        return 1
    try:
        data = json.loads(body)
    except Exception:  # noqa: BLE001
        data = {"content": body, "title": url}
    title = data.get("title") or url
    content = data.get("content") or ""
    out("### fetched: %s  (title: %s, %d chars)" % (url, title, len(content)))
    if outfile:
        with open(outfile, "w", encoding="utf-8") as fh:
            fh.write("# " + str(title) + "\n\n" + content)
        out("### written to " + outfile)
    else:
        out(content)
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 3:
        out(__doc__)
        sys.exit(2)
    cmd = sys.argv[1]
    if cmd == "search":
        n = sys.argv[3] if len(sys.argv) > 3 else 10
        sys.exit(search(sys.argv[2], n))
    elif cmd == "fetch":
        f = sys.argv[3] if len(sys.argv) > 3 else None
        sys.exit(fetch(sys.argv[2], f))
    else:
        out("unknown command: " + cmd)
        sys.exit(2)
