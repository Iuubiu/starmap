"""重出 `content/*/toc.json`：把答案附录标成 `answerKey` 并降级为非叶（t38）。

## 为什么不能只改数据库

`import-content.ts` 是 upsert（`ON DELETE SET NULL` 的取舍决定了它不删行），
所以手工 `UPDATE is_answer_key=true, is_leaf=false` 能立刻修好**当前**的库，
但下次任何人重导这本书，`toc.json` 里的旧值会把它原样翻回去。真正的修复必须
落在**产物**上。

## 为什么不整个重跑 toc_batch.py / books_batch.py

那要重解 15 本 PDF 的目录并重算 chunk（`chunk.py` 刚被 graph-dev 改过，重跑会
让 93689 这个数变掉）。这里只改 `answerKey` 与 `isLeaf` 两个布尔：chunk 的
`micro_kp_id` 是**节点 id**，与这两个字段无关，所以 chunk 一条都不动。

## `isLeaf` 为什么要跟着一起改

答案附录不是可学知识点：它一旦是叶节点，就会进图谱、进推荐、能被点开、
被 `mastery.service.ts` 取快照 —— 而它的正文就是整本答案。降级成容器后，
`import-content.ts` 写 `is_leaf=false`，三处下游自动不再把它当知识点。

**降级不影响 chunk 归属**：`assign.leaf_page_ranges()` 的所有者是
`n['isLeaf'] or n.get('appendix')`，所以同时把 `appendix` 置 true，
答案附录照旧占着自己的页区间，正文不会并回相邻知识点。

## 为什么单独一个脚本而不是改 toc_batch.py

`toc_batch.py` 的 `translate_nodes()` 会重新翻译全部标题（LLM 词典或规则路），
在已经落盘并人工校对过的产物上重跑，会把与本次无关的 `name` 一起改掉。这个
脚本只做两件事，且是幂等的：跑第二遍一个字节都不变。

用法：
    python tools/ingest/fix_answer_key.py            # 全体 content/*/toc.json
    python tools/ingest/fix_answer_key.py --dry-run  # 只报告
    python tools/ingest/fix_answer_key.py --only grupen-2e-2008 guojiang-2014
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from toc_books import is_answer_appendix_title  # noqa: E402


def fix_one(toc_path: Path, *, dry_run: bool) -> list[dict]:
    """改一本书的 `toc.json`，返回被改动的节点（空列表 = 无需改）。"""
    toc = json.loads(toc_path.read_text(encoding='utf-8'))
    nodes = toc.get('nodes', [])
    changed: list[dict] = []
    for node in nodes:
        # 两个入参各归各位：`name` 是入库后学习者看到的中文译名，
        # `nameOriginal` 是原书标题。中文判据看前者、英文判据看后者。
        if not is_answer_appendix_title(node.get('name') or '', node.get('nameOriginal') or ''):
            continue
        before = {
            'answerKey': bool(node.get('answerKey')),
            'isLeaf': bool(node.get('isLeaf')),
            'appendix': bool(node.get('appendix')),
        }
        after = {'answerKey': True, 'isLeaf': False, 'appendix': True}
        if before == after:
            continue
        node.update(after)
        changed.append({'microKpId': node['microKpId'], 'name': node.get('name'), **before})
    if changed and not dry_run:
        # 顶层字段原样写回（`nodeCount` 不变：改属性不增删节点）。
        payload = {**toc, 'nodes': nodes}
        with io.open(toc_path, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    return changed


def main() -> int:
    ap = argparse.ArgumentParser(description='把答案附录标成 answerKey 并降级为非叶（重写 toc.json）')
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
        changed = fix_one(path, dry_run=args.dry_run)
        if changed:
            total += len(changed)
            for c in changed:
                print(
                    f'[{sid}] {c["microKpId"]} {c["name"]!r}: '
                    f'answerKey {c["answerKey"]}→True, isLeaf {c["isLeaf"]}→False, '
                    f'appendix {c["appendix"]}→True'
                )
        else:
            print(f'[{sid}] 无')
    print(f'\n合计改动 {total} 个节点（{"dry-run，未写盘" if args.dry_run else "已重写 toc.json"}）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
