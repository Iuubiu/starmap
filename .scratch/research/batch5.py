import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get, text_of, save

T = {
    "bootdev": "https://www.boot.dev/",
    "bootdev_curriculum": "https://www.boot.dev/courses",
    "orbit_readme": "https://raw.githubusercontent.com/andymatuschak/orbit/main/README.md",
    "edukoder_home": "https://www.educoder.net/",
    "chaoxing": "https://www.chaoxing.com/",
    "yuantiku_home": "https://yuantiku.com/",
    "zuoyebang": "https://www.zuoyebang.com/",
    "khanmigo": "https://www.khanmigo.ai/",
    "brilliant_courses": "https://brilliant.org/courses/",
    "duo_math_blog": "https://blog.duolingo.com/duolingo-math-app/",
    "duolingo_wiki2": "https://en.wikipedia.org/wiki/Duolingo",
    "hundred_finance": "https://www.duolingo.com/",
}
out = {}
for k, u in T.items():
    try:
        t = text_of(get(u))
        save(k + ".txt", t)
        out[k] = len(t)
    except Exception as e:
        out[k] = "ERR " + repr(e)
print(json.dumps(out, ensure_ascii=False, indent=1))
