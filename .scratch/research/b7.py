import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get, text_of, save
T = {
 "brilliant_learn": "https://brilliant.org/assessment/techniques-trainer/",
 "brilliant_about": "https://brilliant.org/about-us/",
 "baike_edukoder": "https://baike.baidu.com/item/%E5%A4%B4%E6%AD%8C",
 "baike_yuantiku": "https://baike.baidu.com/item/%E7%8C%BF%E9%A2%98%E5%BA%93",
 "chaoxing_wiki": "https://zh.wikipedia.org/wiki/%E8%B6%85%E6%98%9F%E5%AD%A6%E4%B9%A0%E9%80%9A",
 "edukoder_m": "https://m.educoder.net/",
 "zhihu_mastery": "https://www.zhihu.com/question/21217663",
}
out={}
for k,u in T.items():
    try:
        t=text_of(get(u)); save(k+".txt",t); out[k]=len(t)
    except Exception as e: out[k]="ERR "+repr(e)
print(json.dumps(out,ensure_ascii=False,indent=1))
