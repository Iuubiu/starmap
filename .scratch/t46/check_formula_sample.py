# -*- coding: utf-8 -*-
"""AC5：抽 30 个真公式，验证散文守卫没有把真公式挡掉。

判据不是「公式块数量不变」（那与 AC4 直接冲突），而是：
改前被判 `formula` 的块里，**真正像公式的那些**，改后仍被判 `formula`。

「真正像公式」的定义（可复核，不靠人眼）：
- 不含 4 个以上连续英文小写单词（`[a-z]{3,}` 出现 >= 4 次 = 散文）
- 且满足下面任意一条：
  (a) 含数学符号 `=∑∫√±×÷∞≈≤≥≠∂Δπμσ`
  (b) 长度 <= 40 且含 `=`（短等式）
  (c) 含上标/下标式写法 `_` `^` 或希腊字母
  (d) 以 `)` 结尾且含 `(`（公式编号 `(4.6.5)`）

脚本对比 git HEAD 版产物（`git show HEAD:content/<sid>/chunks.jsonl`）
与工作区当前产物，找出「改前 formula、改后不是」的块，再判断它们是否真公式。
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'tools' / 'ingest'))

MATH = set('=∑∫√±×÷∞≈≤≥≠∂Δπμσ²³¹⁰')
WORD3 = re.compile(r'[a-z]{3,}')


def looks_real_formula(text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    # 散文特征：4 个以上英文小写长词
    if len(WORD3.findall(t)) >= 4:
        return False
    if any(ch in MATH for ch in t):
        return True
    if len(t) <= 40 and '=' in t:
        return True
    if '_' in t or '^' in t:
        return True
    if t.endswith(')') and '(' in t:
        return True
    return False


def load_head(sid: str) -> list[dict]:
    """从 git HEAD 读改前产物。"""
    try:
        raw = subprocess.run(
            ['git', 'show', f'HEAD:content/{sid}/chunks.jsonl'],
            cwd=REPO, capture_output=True, check=True,
        ).stdout.decode('utf-8')
    except subprocess.CalledProcessError:
        return []
    return [json.loads(line) for line in raw.splitlines() if line.strip()]


def main() -> int:
    books = sorted(p.parent.name for p in (REPO / 'content').glob('*/chunks.jsonl'))
    total_before = total_after = lost_real = 0
    samples: list[tuple[str, str, str]] = []
    for sid in books:
        head = load_head(sid)
        if not head:
            continue
        before = {c['id']: c for c in head if c['kind'] == 'formula'}
        cur = {}
        for line in (REPO / 'content' / sid / 'chunks.jsonl').read_text('utf-8').splitlines():
            if line.strip():
                c = json.loads(line)
                cur[c['id']] = c
        total_before += len(before)
        demoted = [c for cid, c in before.items() if cid in cur and cur[cid]['kind'] != 'formula']
        for c in demoted:
            if looks_real_formula(c['text']):
                lost_real += 1
                if len(samples) < 40:
                    samples.append((sid, c['id'], c['text'][:120]))
        total_after += sum(1 for c in cur.values() if c['kind'] == 'formula')

    print(f'改前 formula 总数: {total_before}')
    print(f'改后 formula 总数: {total_after}')
    print(f'被降级且「像真公式」的块: {lost_real}')
    print()
    if samples:
        print('样例（需要人工确认是否真公式）：')
        for sid, cid, text in samples:
            print(f'  {sid} {cid}\n    {text}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
