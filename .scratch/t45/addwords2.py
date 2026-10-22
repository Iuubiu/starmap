import io, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
P = Path('tools/ingest/translate.py')
src = io.open(P, encoding='utf-8', newline='').read()
WORDS = {
    'ray': '射线',
    'γ': 'γ',
    'bibliography': '参考书目',
}
anchor = "    'the': '',\n"
i = src.index(anchor) + len(anchor)
# insert right after the 'the' line (which is the last of the 71 additions block start)
block = ''.join(f"    {k!r}: {v!r},\n" for k, v in WORDS.items())
src = src[:i] + block + src[i:]
io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('added', len(WORDS))
