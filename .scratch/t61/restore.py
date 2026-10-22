"""把 5 本书的 6 个产物文件恢复成 HEAD 版本（我这次误改了换行，先回滚再重做）。

用 `git show HEAD:<path>` 读出原文再写回，不跑任何 git 写命令。
"""
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
    blob = subprocess.run(['git', 'show', f'HEAD:{rel}'], capture_output=True, check=True).stdout
    with open(rel, 'wb') as f:
        f.write(blob)
    print(f'restored {rel} ({len(blob)} bytes)')
