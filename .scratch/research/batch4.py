import sys, os, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get, text_of, save

T = {
    "acl_hlr": "https://aclanthology.org/P16-1174/",
    "acl_hlr_pdf": "https://aclanthology.org/P16-1174.pdf",
    "duo_leagues": "https://blog.duolingo.com/duolingo-leagues-leaderboards/",
    "duo_research_home": "https://research.duolingo.com/",
    "mathacademy": "https://mathacademy.com/",
    "mathacademy_how": "https://mathacademy.com/how-it-works",
    "aleks_how": "https://www.aleks.com/about_aleks",
    "brilliant": "https://brilliant.org/",
    "edukoder": "https://www.educoder.net/",
    "yuantiku": "https://www.yuantiku.com/",
}
out = {}
for k, u in T.items():
    try:
        t = text_of(get(u))
        save(k + ".txt", t)
        out[k] = len(t)
    except Exception as e:
        out[k] = "ERR " + repr(e)
    time.sleep(1)
print(json.dumps(out, ensure_ascii=False, indent=1))
