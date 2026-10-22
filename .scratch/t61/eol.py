"""核对 5 本书产物在 HEAD 与工作区的换行约定（决定 merge_fragments 该按哪种写回）。"""
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8')

FILES = [
    'content/analog-electronics-tongshibai-5e/toc.json',
    'content/nuclear-physics-experiment-methods-1997/toc.json',
    'content/nuclear-radiation-physics-chenboxian-2011/toc.json',
    'content/radiation-detector-handbook-jichangsong-1990/toc.json',
    'content/radiation-detectors-dinghonglin-2010/toc.json',
    'content/radiation-detectors-dinghonglin-2010/chunks.jsonl',
]

for rel in FILES:
    head = subprocess.run(['git', 'show', f'HEAD:{rel}'], capture_output=True).stdout
    cur = open(rel, 'rb').read()
    for label, blob in (('HEAD', head), ('WORK', cur)):
        crlf = blob.count(b'\r\n')
        lf = blob.count(b'\n') - crlf
        print(f'{rel:60s} {label}: crlf={crlf:6d} bare_lf={lf:6d} bytes={len(blob)}')
    print()
