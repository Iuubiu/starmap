import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get, text_of, save

T = {
    "duo_hlr_paper": "https://aclanthology.org/P16-1174/",
    "duo_research": "https://blog.duolingo.com/how-duolingo-uses-spaced-repetition/",
    "duo_hearts": "https://blog.duolingo.com/hearts/",
    "duo_leagues": "https://blog.duolingo.com/duolingo-leagues-leaderboards/",
    "duo_streak": "https://blog.duolingo.com/streak/",
    "duo_path": "https://blog.duolingo.com/new-duolingo-home-screen-design/",
    "khan_mastery2": "https://support.khanacademy.org/hc/en-us/articles/360030238132-Mastery-levels-in-Khan-Academy",
    "khan_mastery3": "https://www.khanacademy.org/khan-labs",
    "aleks_pie": "https://www.aleks.com/about_aleks/pie",
    "sm2": "https://super-memory.com/english/ol/sm2.htm",
    "anki_leeches": "https://docs.ankiweb.net/deck-options.html",
    "duo_math": "https://blog.duolingo.com/duolingo-math/",
    "brilliant_how": "https://brilliant.org/how-it-works/",
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
