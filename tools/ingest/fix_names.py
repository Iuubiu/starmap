"""重出 `content/*/toc.json`：把编号拼回同名叶节点的 `name`（t24 第二件）。

## 为什么不能只改数据库

`import-content.ts` 是 upsert（`ON DELETE SET NULL` 的取舍决定了它不删行），
所以手工 `UPDATE name=...` 能立刻修好**当前**的库，但下次任何人重导这本书，
`toc.json` 里的旧名字会把它原样翻回去。真正的修复必须落在**产物**上。

## 为什么不整个重跑 run.py / ocr_run.py

11 本扫描书要重算 chunk / 图 / 页账本（约 15 分钟），15 本电子书要重解目录
（会顺带改掉与本次无关的产物字段，且 toc_books.py 是 graph-dev 的）。这里只改
`name` 一个字符串：chunk 的 `micro_kp_id` 是**节点 id**，与 `name` 无关，
所以 chunk 一条都不动。

两个入口（`run.py` / `ocr_run.py` / `toc_batch.py`）也都已经接上
`disambiguate_duplicate_names()`，下次重跑会自动带上这一步 —— 这个脚本只是
把**已经落盘的旧产物**补到同一状态，不替代管线。

用法：
    python tools/ingest/fix_names.py            # 全体 content/*/toc.json
    python tools/ingest/fix_names.py --dry-run  # 只报告
    python tools/ingest/fix_names.py --only nuclear-physics-experiment-methods-1997
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from naming import (  # noqa: E402
    disambiguate_duplicate_names,
    report_renames,
    unresolved_duplicates,
)


def fix_one(toc_path: Path, *, dry_run: bool) -> tuple[list[tuple[str, str, str]], list[dict]]:
    """改一本书的 `toc.json`，返回 `(renames, unresolved)`。"""
    toc = json.loads(toc_path.read_text(encoding='utf-8'))
    nodes = toc.get('nodes', [])
    renames = disambiguate_duplicate_names(nodes)
    unresolved = unresolved_duplicates(nodes)
    if not renames:
        return [], unresolved
    if not dry_run:
        # 顶层字段原样写回（`nodeCount` 不变：改名不增删节点）。
        payload = {**toc, 'nodes': nodes}
        with io.open(toc_path, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    return renames, unresolved


def main() -> int:
    ap = argparse.ArgumentParser(description='把编号拼回同名叶节点的 name（重写 toc.json）')
    ap.add_argument('--content', default='content', help='content 根目录')
    ap.add_argument('--only', nargs='*', help='只处理这些 sourceId')
    ap.add_argument('--dry-run', action='store_true', help='只报告，不写文件')
    args = ap.parse_args()

    paths = sorted(Path(args.content).glob('*/toc.json'))
    if args.only:
        wanted = set(args.only)
        paths = [p for p in paths if p.parent.name in wanted]
    if not paths:
        print('没有找到任何 toc.json')
        return 1

    total = 0
    unresolved_total = 0
    for path in paths:
        book = path.parent.name
        renames, unresolved = fix_one(path, dry_run=args.dry_run)
        total += len(renames)
        unresolved_total += len(unresolved)
        if renames:
            print(f'{book:46} {report_renames(renames)}')
            for old, new in [(r[1], r[2]) for r in renames[:3]]:
                print(f'{"":46}   {old!r} → {new!r}')
        for g in unresolved:
            print(f'{book:46}   ⚠ 仍重名：{g["name"]!r} ids={g["ids"]} pages={g["pages"]}')

    print(
        f'\n{"（dry-run）" if args.dry_run else ""}改名 {total} 个；'
        f'仍无法区分 {unresolved_total} 组（已逐条列出，不猜）'
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
