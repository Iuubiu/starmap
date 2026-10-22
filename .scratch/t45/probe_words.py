import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, 'tools/ingest')
import translate as T

cases = [
 '3.2.A Diffusion in the absence of electric field',
 'A.1 Diffusion in the presence of electric field',
 '11.2.E Kerma, cema, and terma',
 'A.2 Aliasing and antialiasing',
 '5.1 Semiconductor detectors',
 '5.1.K Specific semiconductor detectors',
 '1.6.E Neutrons',
 '2.6.A Neutrons',
]
for c in cases:
    words = T._WORD.findall(T._normalize(c))
    print(f'--- {c!r}')
    print('   words:', words)
    for w in words:
        lw = w.lower()
        hit = T._lookup(words, words.index(w), T.GLOSSARY)
        print(f'     {w!r:24} inGLOSSARY={lw in T.GLOSSARY} keep={lw in T.KEEP_TOKENS} drop={lw in T.DROP_TOKENS}')
    print('   ->', repr(T.translate_title(c)))
