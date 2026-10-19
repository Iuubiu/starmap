import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get, text_of, save

TARGETS = {
    "gh_search_quiz": "https://github.com/search?q=adaptive+quiz+llm&type=repositories&s=stars&o=desc",
    "gh_search_srs": "https://github.com/search?q=spaced+repetition&type=repositories&s=stars&o=desc",
    "gh_search_gamified": "https://github.com/search?q=gamified+learning+quiz&type=repositories&s=stars&o=desc",
    "gh_topic_srs": "https://github.com/topics/spaced-repetition",
    "gh_topic_quiz": "https://github.com/topics/quiz-game",
    "fsrs_repo": "https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler",
    "fsrs4anki": "https://github.com/open-spaced-repetition/fsrs4anki",
    "py_fsrs": "https://github.com/open-spaced-repetition/py-fsrs",
    "khan_mastery": "https://support.khanacademy.org/hc/en-us/articles/360030238132",
    "aleks": "https://www.aleks.com/about_aleks",
    "brilliant": "https://brilliant.org/about/",
    "duolingo_wiki": "https://en.wikipedia.org/wiki/Duolingo",
    "edukoder": "https://www.educoder.net/",
}

out = {}
for k, u in TARGETS.items():
    try:
        t = text_of(get(u))
        save(k + ".txt", t)
        out[k] = len(t)
    except Exception as e:
        out[k] = "ERR " + repr(e)
print(json.dumps(out, ensure_ascii=False, indent=1))
