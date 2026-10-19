import sys, os, glob
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
import pypdf, warnings
warnings.filterwarnings("ignore")
rows=[]
for grp in ["books","papers"]:
    for f in sorted(glob.glob(f"资源库/{grp}/*.pdf")):
        try:
            r=pypdf.PdfReader(f); n=len(r.pages)
            idx=[int(n*k) for k in (0.15,0.4,0.6,0.85)]
            idx=[i for i in idx if 0<=i<n]
            tot=0
            for i in idx:
                t=r.pages[i].extract_text() or ""
                tot+=len(t)
            rows.append((grp, os.path.basename(f), n, tot, round(tot/max(len(idx),1))))
        except Exception as e:
            rows.append((grp, os.path.basename(f), -1, -1, -1))
out=open(".scratch/pdfscan.txt","w",encoding="utf-8")
for g,b,n,tot,avg in rows:
    out.write(f"{g:6} {n:5} pages  avg={avg:5} chars/pg  {b}\n")
scanned=[r for r in rows if r[4] < 100]
out.write(f"\nTOTAL {len(rows)} files; no-text-layer(<100 chars/pg): {len(scanned)}\n")
for r in scanned: out.write(f"  SCANNED {r[0]}/{r[1]} (avg {r[4]})\n")
out.close()
print("done", len(rows))
