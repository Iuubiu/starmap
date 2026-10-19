import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get, text_of, save
T = {
 "duo_energy": "https://blog.duolingo.com/duolingo-energy/",
 "duo_srs_blog": "https://blog.duolingo.com/spaced-repetition-for-learning/",
 "duo_hlr_blog": "https://blog.duolingo.com/review-exercises-help-measure-learner-recall/",
 "duo_streak_habit": "https://blog.duolingo.com/how-duolingo-streak-builds-habit/",
 "duo_streak_improve": "https://blog.duolingo.com/improving-the-streak/",
 "duo_math_launch": "https://blog.duolingo.com/duolingo-launches-math-app/",
 "duo_dev_math": "https://blog.duolingo.com/developing-math/",
 "duo_review_lessons": "https://blog.duolingo.com/how-to-review-lessons-on-duolingo/",
}
out={}
for k,u in T.items():
    try:
        t=text_of(get(u)); save(k+".txt",t); out[k]=len(t)
    except Exception as e: out[k]="ERR "+repr(e)
print(json.dumps(out,ensure_ascii=False,indent=1))
