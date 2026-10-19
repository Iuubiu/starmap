import re,sys
# condense uxr*.txt into per-query digest: top N results, title/url/summary(400)
def dig(path, topn=6, sl=420):
    txt=open(path,encoding="utf-8").read()
    blocks=re.split(r"\n########## QUERY: ",txt)
    for b in blocks[1:]:
        lines=b.split("\n",1)
        print("\n## Q:",lines[0].strip())
        body=lines[1] if len(lines)>1 else ""
        items=re.split(r"\n\[(\d+)\] ",body)
        # items: ['', '1', 'title...', '2', ...]
        cnt=0
        for i in range(1,len(items)-1,2):
            n=items[i]; chunk=items[i+1]
            if int(n)>topn: break
            cl=chunk.split("\n")
            title=cl[0].strip()
            url=""; site=""; date=""
            for l in cl[1:4]:
                s=l.strip()
                if s.startswith("url:"): url=s[4:].strip()
                elif s.startswith("site:"):
                    site=s[5:].strip()
            sm=""
            for l in cl:
                if l.strip().startswith("summary:"):
                    sm=l.strip()[8:].strip(); break
            print(" - %s" % title)
            print("   %s | %s" % (url[:130], site[:70]))
            if sm: print("   %s" % sm[:sl])
dig(sys.argv[1], int(sys.argv[2]) if len(sys.argv)>2 else 6)
