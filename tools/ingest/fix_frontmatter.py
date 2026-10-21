"""重出 `content/*/toc.json`：把书首前置页降级为容器（t24 第二件）。

## 为什么不能只改数据库

`import-content.ts` 是 upsert（`ON DELETE SET NULL` 的取舍决定了它不删行），
所以手工 `UPDATE is_leaf=false` 能立刻修好**当前**的库，但下次任何人重导这本书，
`toc.json` 里 `isLeaf: true` 会把它原样翻回去。真正的修复必须落在**产物**上。

## 为什么不整个重跑 ocr_run.py

那要重跑 11 本的后处理（页缓存命中，但要重算 chunk / 图 / 页账本，约 15 分钟），
而且会顺带改掉与本次无关的产物字段。这里只改 `toc.json` 里 `isLeaf` 一个布尔：
chunk 的 `micro_kp_id` 是**节点 id**，与 `isLeaf` 无关，所以 chunk 一条都不动。

用法：
    python tools/ingest/fix_frontmatter.py            # 全体 content/*/toc.json
    python tools/ingest/fix_frontmatter.py --dry-run  # 只报告
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from frontmatter import (  # noqa: E402
    demote_front_matter_leaves,
    is_front_matter_leaf,
    report_demotions,
)


def fix_one(toc_path: Path, *, dry_run: bool) -> list[str]:
    toc = json.loads(toc_path.read_text(encoding='utf-8'))
    nodes = toc.get('nodes', [])
    before = [n['microKpId'] for n in nodes if is_front_matter_leaf(n)]
    if not before:
        return []
    demoted = demote_front_matter_leaves(nodes)
    if not dry_run:
        with io.open(toc_path, 'w', encoding='utf-8') as f:
            json.dump(
                {'sourceId': toc['sourceId'], 'nodeCount': len(nodes), 'nodes': nodes},
                f,
                ensure_ascii=False,
                indent=2,
            )
    return demoted


def main() -> int:
    ap = argparse.ArgumentParser(description='把书首前置页伪知识点降级为容器（重写 toc.json）')
    ap.add_argument('--content', default='content', help='content 根目录')
    ap.add_argument('--only', nargs='*', help='只处理这些 sourceId')
    ap.add_argument('--dry-run', action='store_true', help='只报告，不写文件')
    args = ap.parse_args()

    paths = sorted(Path(args.content).glob('*/toc.json'))
    if args.only:
        keep = set(args.only)
        paths = [p for p in paths if p.parent.name in keep]
    if not paths:
        print('没有找到 content/*/toc.json', file=sys.stderr)
        return 1

    total = 0
    for path in paths:
        sid = path.parent.name
        demoted = fix_one(path, dry_run=args.dry_run)
        if demoted:
            total += len(demoted)
            print(f'[{sid}] {report_demotions(demoted)}')
        else:
            print(f'[{sid}] 无')
    print(f'\n合计降级 {total} 个节点（{"dry-run，未写盘" if args.dry_run else "已重写 toc.json"}）')
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    raise SystemExit(main())
