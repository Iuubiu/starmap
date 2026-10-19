import json, sys, time, urllib.parse, urllib.request, re, difflib

QUERIES = [
 # --- mastery learning ---
 ("Kulik Kulik Bangert-Drowns Effectiveness of mastery learning programs meta-analysis Review of Educational Research 1990", "kulik1990"),
 ("Guskey Pigott Research on group-based mastery learning programs meta-analysis Journal of Educational Research 1988", "guskey1988"),
 ("Slavin Mastery Learning Reconsidered Review of Educational Research 1987", "slavin1987"),
 ("Guskey Closing the achievement gap revisiting Benjamin Bloom learning for mastery Journal of Advanced Academics 2007", "guskey2007"),
 ("Block Burns Mastery learning procedures 1976 Review of Research in Education", "block1976"),
 ("VanLehn The relative effectiveness of human tutoring intelligent tutoring systems and other tutoring systems Educational Psychologist 2011", "vanlehn2011"),
 # --- practice testing / retrieval ---
 ("Roediger Butler The critical role of retrieval practice in long-term retention Trends in Cognitive Sciences 2011", "roediger2011"),
 ("Rowland The effect of testing versus restudy on retention meta-analytic review of the testing effect Psychological Bulletin 2014", "rowland2014"),
 ("Adesope Trevisan Sundararajan Rethinking the use of tests meta-analysis of practice testing Review of Educational Research 2017", "adesope2017"),
 ("Karpicke Roediger The critical importance of retrieval for learning Science 2008", "karpicke2008"),
 ("Rawson Dunlosky Optimizing schedules of retrieval practice for durable and efficient learning Journal of Experimental Psychology General 2011", "rawson2011"),
 ("Vaughn Rawson Diagnosing criterion-level effects on memory successive relearning 2011", "vaughn2011"),
 ("Dunlosky Rawson Marsh Nathan Willingham Improving students learning with effective learning techniques Psychological Science in the Public Interest 2013", "dunlosky2013"),
 ("Latimier Peyre Ramus meta-analytic review of the benefit of spacing out retrieval practice episodes on retention Educational Psychology Review 2021", "latimier2021"),
 # --- IRT / CAT ---
 ("Weiss Improving measurement quality and efficiency with adaptive testing Applied Psychological Measurement 1982", "weiss1982"),
 ("Weiss Kingsbury Application of computerized adaptive testing to educational problems Journal of Educational Measurement 1984", "weiss1984"),
 ("Kingsbury Weiss A comparison of IRT-based adaptive mastery testing and a sequential mastery testing procedure 1983", "kingsbury1983"),
 ("Huynh Statistical consideration of mastery scores Psychometrika 1976", "huynh1976"),
 ("Meskauskas Evaluation models for criterion-referenced testing views regarding mastery and standard-setting Review of Educational Research 1976", "meskauskas1976"),
 ("Wald Sequential analysis 1945 sequential probability ratio test", "wald1945"),
 ("van der Linden Hambleton Handbook of Modern Item Response Theory 1997", "linden1997"),
 ("Embretson Reise Item Response Theory for Psychologists 2000", "embretson2000"),
 # --- spacing / interleaving ---
 ("Cepeda Pashler Vul Wixted Rohrer Distributed practice in verbal recall tasks review and quantitative synthesis Psychological Bulletin 2006", "cepeda2006"),
 ("Cepeda Vul Rohrer Wixted Pashler Spacing effects in learning a temporal ridgeline of optimal retention Psychological Science 2008", "cepeda2008"),
 ("Rohrer Taylor The shuffling of mathematics problems improves learning Instructional Science 2007", "rohrer2007"),
 ("Rohrer Dedrick Stershic Interleaved practice improves mathematics learning Journal of Applied Research in Memory and Cognition 2015", "rohrer2015"),
 ("Brunmair Richter Similarity matters meta-analysis of interleaved learning and its moderators Psychological Bulletin 2019", "brunmair2019"),
 ("Bjork Bjork Making things hard on yourself but in a good way creating desirable difficulties to enhance learning 2011", "bjork2011"),
 ("Kang Spaced repetition promotes efficient and effective learning policy insights Behavioral and Brain Sciences 2016", "kang2016"),
 ("Pashler McDaniel Rohrer Bjork Learning styles concepts and evidence Psychological Science in the Public Interest 2008", "pashler2008"),
 # --- LLM item generation ---
 ("Doughty comparative study of AI-generated GPT-4 and human-crafted multiple choice questions programming education 2024", "doughty2024"),
 ("Sarsa Denny Hellas Leinonen automatic generation of programming exercises and code explanations using large language models ICER 2022", "sarsa2022"),
 ("AlKhuzaey Grasso Payne Tamma systematic review of automatic question generation for educational purposes 2023", "alkhuzaey2023"),
 ("evaluating quality of large language model generated multiple choice questions distractor plausibility empirical study 2024", "llmmcq1"),
 ("LLM generated assessment items versus human authored item quality empirical comparison 2024", "llmmcq2"),
 ("teacher perceptions ChatGPT generated quiz questions formative assessment study 2024", "llmmcq3"),
 ("automatic item generation Gierl Haladyna 2012", "gierl2012"),
 ("Karpicke Butler Roediger Metacognitive strategies in student learning do students practice retrieval when they study on their own 2009", "karpicke2009"),
]

def q(query):
    url = ("https://api.crossref.org/works?rows=2&select=DOI,title,author,container-title,issued,volume,page,type"
           "&query.bibliographic=" + urllib.parse.quote(query))
    req = urllib.request.Request(url, headers={"User-Agent": "refverify/1.0 (mailto:verify@example.org)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["message"]["items"]

out = {}
for query, key in QUERIES:
    try:
        items = q(query)
    except Exception as e:
        out[key] = {"error": str(e)}
        print(key, "ERROR", e); continue
    recs = []
    for it in items:
        recs.append({
            "doi": it.get("DOI"),
            "title": (it.get("title") or [""])[0],
            "authors": [f"{a.get('family','')} {a.get('given','')[:1]}" for a in it.get("author", [])][:6],
            "venue": (it.get("container-title") or [""])[0],
            "year": (it.get("issued", {}).get("date-parts") or [[None]])[0][0],
            "vol": it.get("volume"), "page": it.get("page"),
        })
    out[key] = recs
    print("==", key)
    for r in recs:
        print("   ", r["doi"], "|", r["year"], "|", r["title"][:95], "|", r["venue"][:50])
    time.sleep(0.4)

json.dump(out, open("refs.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
