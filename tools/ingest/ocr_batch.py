"""批量跑多本书的 OCR：一本书一个源 ID，产物落到 `content/<sourceId>/`。

和 `ocr_run.py` 的关系：这个脚本只负责「按配置循环调用」，识别、分块、落盘全
在 `ocr_run.main()` 里，所以单本书的产物格式和手工跑完全一致。

配置是个 JSON 数组，每项：

```json
{
  "sourceId": "nuclear-electronics-wangzhiying-1989",
  "pdf": "资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf",
  "tocRange": [10, 14],
  "pageOffset": "auto",
  "firstPage": 14,
  "note": "目录在 PDF 10–13；正文起于 14"
}
```

- `tocRange` 是**左闭右开**的 PDF 页索引（和 `ocr_run.py --toc-range` 一致）
- `pageOffset` 传 `"auto"` 就抽样扫页眉页脚自动判定，也可以写死整数
- `firstPage` 省略时默认从 `tocRange[1]` 开始，也就是紧接目录后的第一页

断点在两个层级都生效：页级靠 `ocr_run.py` 的页缓存（`data/ocr-cache/<id>/`），
书级靠这里检查 `content/<id>/manifest.json` 是否已存在 —— 已完成的整本书直接
跳过，重跑整批不会重复识别任何一页。`--force` 可以只重跑某本书的**后处理**
（页缓存仍然命中，所以是秒级）。
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_config(path: Path) -> list[dict]:
    with io.open(path, encoding='utf-8') as f:
        books = json.load(f)
    if not isinstance(books, list):
        raise SystemExit(f'配置必须是 JSON 数组：{path}')
    for b in books:
        for key in ('sourceId', 'pdf', 'tocRange'):
            if key not in b:
                raise SystemExit(f'配置项缺 {key}：{b}')
    return books


def build_cmd(book: dict, out_dir: Path) -> list[str]:
    args = [
        sys.executable,
        str(Path(__file__).parent / 'ocr_run.py'),
        str(ROOT / book['pdf']),
        '--source-id',
        book['sourceId'],
        '--page-offset',
        str(book.get('pageOffset', 'auto')),
        '--toc-range',
        str(book['tocRange'][0]),
        str(book['tocRange'][1]),
        '--out',
        str(out_dir),
    ]
    if book.get('firstPage') is not None:
        args += ['--first-page', str(book['firstPage'])]
    if book.get('limit'):
        args += ['--limit', str(book['limit'])]
    if book.get('dpi'):
        args += ['--dpi', str(book['dpi'])]
    if book.get('device'):
        args += ['--device', str(book['device'])]
    return args


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('config')
    ap.add_argument('--only', default='', help='只跑这些 sourceId（逗号分隔）')
    ap.add_argument('--force', action='store_true', help='忽略已有 manifest，重跑后处理')
    ap.add_argument('--content', default='content', help='产物根目录')
    ap.add_argument('--log-dir', default='.scratch/ocr-batch', help='每本书的日志')
    args = ap.parse_args(argv)

    books = load_config(Path(args.config))
    only = {s.strip() for s in args.only.split(',') if s.strip()}
    if only:
        books = [b for b in books if b['sourceId'] in only]
        missing = only - {b['sourceId'] for b in books}
        if missing:
            raise SystemExit(f'--only 里有配置中不存在的 id：{sorted(missing)}')

    out_root = ROOT / args.content
    log_dir = ROOT / args.log_dir
    log_dir.mkdir(parents=True, exist_ok=True)

    done: list[str] = []
    skipped: list[str] = []
    failed: list[str] = []
    t_all = time.time()

    for n, book in enumerate(books, 1):
        sid = book['sourceId']
        out_dir = out_root / sid
        manifest = out_dir / 'manifest.json'
        print(f'\n=== [{n}/{len(books)}] {sid} ===', flush=True)
        if manifest.exists() and not args.force:
            print(f'  已有 {manifest} → 跳过（--force 可重跑后处理）', flush=True)
            skipped.append(sid)
            continue
        log_path = log_dir / f'{sid}.log'
        cmd = build_cmd(book, out_dir)
        print(f'  日志 {log_path.relative_to(ROOT)}', flush=True)
        t0 = time.time()
        with io.open(log_path, 'w', encoding='utf-8') as log:
            proc = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, cwd=str(ROOT))
        took = time.time() - t0
        if proc.returncode != 0:
            # 单本书失败不该拖垮整批：记下来继续下一本，最后统一报
            print(f'  ✗ 失败（exit {proc.returncode}，{took / 60:.1f} 分钟），见日志', flush=True)
            failed.append(sid)
            continue
        chunk_count = '?'
        try:
            with io.open(manifest, encoding='utf-8') as f:
                chunk_count = json.load(f)['chunkCount']
        except Exception:  # noqa: BLE001 —— 汇总用，读不到就显示 ?
            pass
        print(f'  ✓ {chunk_count} chunk，{took / 60:.1f} 分钟', flush=True)
        done.append(sid)

    print(f'\n汇总：完成 {len(done)}、跳过 {len(skipped)}、失败 {len(failed)}；'
          f'总耗时 {(time.time() - t_all) / 60:.1f} 分钟')
    if failed:
        print('失败的书：' + '、'.join(failed))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
