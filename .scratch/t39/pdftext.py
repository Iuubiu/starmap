import sys, pymupdf
path, page = sys.argv[1], int(sys.argv[2])
doc = pymupdf.open(path)
t = doc[page-1].get_text()
print('=== page', page, 'chars', len(t))
print(t[:2000])
