import sys, pymupdf
path, needle = sys.argv[1], sys.argv[2]
maxp = int(sys.argv[3]) if len(sys.argv) > 3 else 12
doc = pymupdf.open(path)
hits = 0
for i in range(len(doc)):
    t = doc[i].get_text()
    if needle.lower() in t.lower():
        print(f'--- pdf page {i+1}')
        low = t.lower(); at = low.find(needle.lower())
        print(t[max(0, at-200):at+400].replace('\n', ' | '))
        hits += 1
        if hits >= maxp: break
