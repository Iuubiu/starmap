import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get, text_of, save

T = {
    "khan_how_mastery_levels": "https://support.khanacademy.org/hc/en-us/articles/5548760867853--How-do-Khan-Academy-s-Mastery-levels-work",
    "khan_mastery_system": "https://support.khanacademy.org/hc/en-us/sections/200665650-The-Mastery-System",
    "khan_mastery_pct": "https://support.khanacademy.org/hc/en-us/articles/48411237993357-How-is-my-mastery-percentage-calculated",
    "khan_mastery_challenges": "https://support.khanacademy.org/hc/en-us/articles/360037494231-What-are-Mastery-Challenges",
    "khan_course_unit_mastery": "https://support.khanacademy.org/hc/en-us/articles/115002552631-What-are-Course-and-Unit-Mastery",
    "duo_home_redesign": "https://blog.duolingo.com/new-duolingo-home-screen-design/",
    "duo_ab_testing": "https://blog.duolingo.com/improving-duolingo-one-experiment-at-a-time/",
    "duo_whitepaper_path": "https://duolingo-papers.s3.amazonaws.com/reports/Duolingo_whitepaper_language_read_listen_write_speak_2024.pdf",
    "duo_schools_homescreen": "https://duolingoschools.zendesk.com/hc/en-us/articles/6829627901197-The-new-Duolingo-homescreen",
    "anki_deck_options": "https://docs.ankiweb.net/deck-options.html",
    "sm2_orig": "https://super-memory.com/english/ol/sm2.htm",
    "duoplanet_path": "https://duoplanet.com/duolingo-new-learning-path-review/",
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
