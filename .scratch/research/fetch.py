"""Tiny fetcher: curl -> text. Handles Bing SERP, GitHub HTML, plain pages, arXiv abs."""
import subprocess, sys, re, json, os, hashlib

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")


def get(url, extra=()):
    cmd = ["curl", "-sL", "-m", "30", "-A", UA,
           "--compressed", "-H", "Accept-Language: en-US,en;q=0.9", *extra, url]
    r = subprocess.run(cmd, capture_output=True)
    return r.stdout


def text_of(html_bytes):
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return html_bytes.decode("utf-8", "replace")
    soup = BeautifulSoup(html_bytes.decode("utf-8", "replace"), "html.parser")
    for t in soup(["script", "style", "noscript", "svg"]):
        t.decompose()
    txt = soup.get_text("\n")
    txt = re.sub(r"\n{3,}", "\n\n", txt)
    lines = [l.strip() for l in txt.split("\n")]
    return "\n".join(l for l in lines if l)


def bing(q, n=10):
    from urllib.parse import quote_plus
    html = get("https://www.bing.com/search?q=" + quote_plus(q) + "&setlang=en&count=%d" % n)
    soup_txt = text_of(html)
    return soup_txt


def gh_stars(owner_repo):
    html = get("https://github.com/" + owner_repo)
    t = html.decode("utf-8", "replace")
    m = re.search(r'id="repo-stars-counter-star"[^>]*title="([\d,]+)"', t)
    if not m:
        m = re.search(r'([\d,\.k]+)\s*stars', t)
        return m.group(1) if m else "?"
    return m.group(1)


def save(name, txt):
    os.makedirs(RAW, exist_ok=True)
    p = os.path.join(RAW, name)
    with open(p, "w", encoding="utf-8") as f:
        f.write(txt)
    return p


if __name__ == "__main__":
    mode = sys.argv[1]
    arg = " ".join(sys.argv[2:])
    if mode == "bing":
        out = bing(arg)
        print(out.encode("utf-8", "replace").decode("utf-8")[:12000])
    elif mode == "page":
        out = text_of(get(arg))
        print(out.encode("utf-8", "replace").decode("utf-8")[:20000])
    elif mode == "raw":
        r = subprocess.run(["curl", "-sL", "-m", "30", arg], capture_output=True)
        print(r.stdout.decode("utf-8", "replace")[:20000])
