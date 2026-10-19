import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get, text_of, save
T = {
 "aa_course_upgrade": "https://www.androidauthority.com/duolingo-course-upgrade-complaints-3685447/",
 "wiki_2sigma": "https://en.wikipedia.org/wiki/Bloom%27s_2_Sigma_Problem",
 "nintil_sigma": "https://nintil.com/bloom-sigma/",
 "technical_ly_review": "https://technical.ly/startups/duolingo-math-app-review/",
}
out={}
for k,u in T.items():
    try:
        t=text_of(get(u)); save(k+".txt",t); out[k]=len(t)
    except Exception as e: out[k]="ERR "+repr(e)
print(json.dumps(out,ensure_ascii=False,indent=1))
