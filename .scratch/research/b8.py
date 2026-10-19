import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get, text_of, save
T = {
 "neg_gamif_eee": "https://online-journals.org/index.php/i-joe/article/view/61757",
 "neg_gamif_sciencedirect": "https://www.sciencedirect.com/science/article/pii/S0950584922002518",
 "dark_side_rg": "https://www.researchgate.net/publication/326876949_The_Dark_Side_of_Gamification_An_Overview_of_Negative_Effects_of_Gamification_in_Education",
}
out={}
for k,u in T.items():
    try:
        t=text_of(get(u)); save(k+".txt",t); out[k]=len(t)
    except Exception as e: out[k]="ERR "+repr(e)
print(json.dumps(out,ensure_ascii=False,indent=1))
