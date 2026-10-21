# -*- coding: utf-8 -*-
"""重算某本书的 chunk 归属，**不重新解析 PDF**。

## 为什么需要这个脚本

`fix_answer_key.py` 只改 `toc.json`（把答案附录标成 `answerKey` / `appendix`），
但 chunk 的 `micro_kp_id` 是在 `books_batch.build_one()` 里由
`assign.assign()` 一次性算好写进 `chunks.jsonl` 的。产物被修补之后，
`toc.json` 说「这 62 页归答案附录」，`chunks.jsonl` 里却还写着上一章 ——
两边不一致，而入库读的是后者。

后果实测过：`grupen-2e-2008` 的答案附录 `kp-grupen-2e-2008-18` 拿到
`is_answer_key = true` 之后，名下 chunk 数仍是 0，`answerChunkIdsFor()` 的
递归子树因此捞不到 p533–576 的 62 个 chunk —— 门控在这本书上等于没生效。

## 为什么不整个重跑 `books_batch.py`

重跑要重解 15 本 PDF、重算全部 chunk。`chunk.py` 的切分规则刚被别的泳道
动过，重跑会让 93689 这个数变掉，而它是幂等导入的基线。这里只重跑
`assign()` 一步：输入是同一批 chunk 对象与同一份 `toc.json`，输出只有
`micro_kp_id` / `answer_for` 两列会变。

## 幂等

`assign()` 是确定性的（不依赖随机数，也不依赖 chunk 的绝对 id）。跑第二遍
得到同样的结果，`--dry-run` 会显示 0 改动。

用法：

    python tools/ingest/fix_chunk_owner.py --only grupen-2e-2008 [--dry-run]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import assign as A  # noqa: E402
from chunk import Chunk  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def rebuild_manifest(chunks: list[Chunk]) -> dict:
    """与 `chunk.write_content_dir()` 逐字同形的清单。"""
    return {
        'chunkCount': len(chunks),
        'byKind': {k: sum(1 for c in chunks if c.kind == k) for k in ('text', 'formula', 'table')},
        'pageRange': [
            min((c.pdf_page for c in chunks), default=0),
            max((c.pdf_page for c in chunks), default=0),
        ],
        'contentHash': hashlib.sha256(''.join(c.id for c in chunks).encode()).hexdigest()[:16],
    }


def fix_one(book_dir: Path, *, dry_run: bool) -> list[dict]:
    toc_path = book_dir / 'toc.json'
    chunks_path = book_dir / 'chunks.jsonl'
    if not toc_path.exists() or not chunks_path.exists():
        raise SystemExit(f'{book_dir.name}: 缺 toc.json 或 chunks.jsonl')

    nodes = json.loads(toc_path.read_text(encoding='utf-8'))['nodes']
    rows = [json.loads(line) for line in chunks_path.read_text(encoding='utf-8').splitlines() if line.strip()]
    chunks = [Chunk(**row) for row in rows]

    before = [c.micro_kp_id for c in chunks]
    A.assign(chunks, nodes)

    changes = [
        {'id': c.id, 'page': c.printed_page, 'from': old, 'to': c.micro_kp_id}
        for c, old in zip(chunks, before)
        if old != c.micro_kp_id
    ]
    if changes and not dry_run:
        with chunks_path.open('w', encoding='utf-8') as f:
            for c in chunks:
                f.write(json.dumps(asdict(c), ensure_ascii=False) + '\n')
        manifest = rebuild_manifest(chunks)
        (book_dir / 'manifest.json').write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8'
        )
    return changes


def main() -> int:
    parser = argparse.ArgumentParser(description='重算 chunk 归属（不重新解析 PDF）')
    parser.add_argument('--content', default=str(ROOT / 'content'))
    parser.add_argument('--only', nargs='+', metavar='SOURCE_ID')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    content = Path(args.content)
    books = sorted(p for p in content.iterdir() if p.is_dir())
    if args.only:
        wanted = set(args.only)
        books = [b for b in books if b.name in wanted]
        missing = wanted - {b.name for b in books}
        if missing:
            raise SystemExit(f'找不到: {", ".join(sorted(missing))}')

    total = 0
    for book in books:
        changes = fix_one(book, dry_run=args.dry_run)
        total += len(changes)
        if not changes:
            print(f'[{book.name}] 无改动')
            continue
        pages = sorted({c['page'] for c in changes})
        targets = sorted({c['to'] for c in changes})
        print(f'[{book.name}] {len(changes)} 个 chunk 改归属 → {", ".join(targets)}；页码 {pages[0]}–{pages[-1]}')
    print(f'合计 {total} 个 chunk 改动{"（dry-run，未写入）" if args.dry_run else "（已重写 chunks.jsonl + manifest.json）"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
