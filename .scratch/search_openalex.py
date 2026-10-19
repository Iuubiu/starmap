import json, urllib.parse, urllib.request, time

def search(q, extra="", per=6, sort="relevance_score:desc"):
    url = ("https://api.openalex.org/works?per-page=%d&search=%s%s" % (per, urllib.parse.quote(q), extra))
    req = urllib.request.Request(url, headers={"User-Agent": "refverify/1.0 (mailto:verify@example.org)"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)

def show(q, extra="", per=6):
    print("#### QUERY:", q, extra)
    try:
        d = search(q, extra, per)
    except Exception as e:
        print("ERR", e); return
    for w in d["results"]:
        src = ((w.get("primary_location") or {}).get("source") or {}).get("display_name")
        print("  ", w.get("doi"), "|", w.get("publication_year"), "| cit:", w.get("cited_by_count"), "|", (w.get("title") or "")[:100], "|", (src or "")[:45])
    print()
    time.sleep(0.3)

# effect size lookups
show("testing effect meta-analysis effect size Hedges g retention", "&filter=publication_year:2010-2022")
show("practice testing meta-analysis", "&filter=publication_year:2010-2022")
show("interleaved practice meta-analysis", "&filter=publication_year:2018-2022")
show("spacing effect meta-analysis retrieval practice", "&filter=publication_year:2019-2023")
# LLM item generation 2020+
show("large language model generated multiple-choice questions quality evaluation", "&filter=from_publication_date:2023-01-01,to_publication_date:2026-06-30", 10)
show("LLM automatic item generation formative assessment empirical study", "&filter=from_publication_date:2023-01-01,to_publication_date:2026-06-30", 10)
show("ChatGPT generated questions versus human-authored questions comparison study", "&filter=from_publication_date:2023-01-01,to_publication_date:2026-06-30", 10)
# adaptive mastery testing stopping rule
show("computerized adaptive testing stopping rule test length mastery classification", "&filter=publication_year:1990-2025", 8)
show("variable-length computerized adaptive testing item count precision standard error", "&filter=publication_year:2000-2025", 8)
show("cognitive diagnostic assessment attribute mastery number of items required", "&filter=publication_year:2005-2025", 8)
