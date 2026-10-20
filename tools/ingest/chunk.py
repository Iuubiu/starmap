"""把抽取出的版面块切成可检索的 chunk，并落到 content/ 产物。

切分策略与「固定字符数滑动窗口」的区别：
滑动窗口会把一道例题的题干和它的解切成两半，也会把表格从中间截断。这里的
切分单位是**版面块**：一个段落、一张表、一个公式自成一个 chunk；只有当单个
段落超过 `MAX_CHARS` 时才按句子边界再切。代价是 chunk 长度不均匀（从几十字
到两千字），收益是每个 chunk 天然是一个完整的语义单元，引用时能整段取出。

`is_answer_chunk` 不在这里判定。它依赖「对哪个知识点」——同一个 chunk 对
A 知识点是答案、对 B 知识点只是背景。票 02 的验收要求把它标在 chunk × 微
知识点 的关系表上，所以这一步只产出 chunk，标注在 import 阶段做。
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from extract import Block

# 单个 chunk 的字符上限。超过就按句子边界再切。
MAX_CHARS = 1200
# 太短的片段（目录残渣、单个页码）不值得成为 chunk
MIN_CHARS = 12

# 页眉/页脚噪声。实测这本书每页都有 `·2·1  数字逻辑概论` 这种
# 「页码 + 章名」行。它们会变成独立 chunk 污染检索 —— 问「数字逻辑概论
# 讲了什么」会先命中一堆页码行而不是正文。
_FURNITURE = re.compile(r'^[·•●\s]*\d{1,4}\s*[·•●\s]*[\u4e00-\u9fff]{0,20}[·•●\s]*$')

_SENTENCE_END = re.compile(r'(?<=[。！？；])')


@dataclass
class Chunk:
    id: str
    source_id: str
    kind: str  # 'text' | 'formula' | 'table' | 'figure'
    text: str
    printed_page: int
    pdf_page: int
    bbox: list[float]
    heading_path: list[str]
    rows: list[list[str]] | None = None
    # 以下两项由 assign.py 填。默认值让 chunk 阶段可以先不知道归属就跑起来
    # （抽规则时需要单独迭代切分）。
    micro_kp_id: str | None = None
    answer_for: list[str] = field(default_factory=list)


def _stable_id(source_id: str, pdf_page: int, index: int, text: str) -> str:
    """内容+位置的稳定 id。同一本书重跑抽取得出同样的 id，便于幂等导入。"""
    h = hashlib.sha256(f'{source_id}|{pdf_page}|{index}|{text[:80]}'.encode()).hexdigest()[:12]
    return f'ck-{source_id}-{pdf_page:04d}-{index:02d}-{h}'


def _split_long(text: str) -> list[str]:
    if len(text) <= MAX_CHARS:
        return [text]
    parts: list[str] = []
    buf = ''
    for sent in _SENTENCE_END.split(text):
        if len(buf) + len(sent) > MAX_CHARS and buf:
            parts.append(buf)
            buf = sent
        else:
            buf += sent
    if buf:
        parts.append(buf)
    return parts


def blocks_to_chunks(
    blocks: list[Block],
    source_id: str,
    *,
    page_offset: int,
    headings_by_page: dict[int, list[str]] | None = None,
) -> list[Chunk]:
    """把一页页的块转成 chunk 列表。

    `page_offset` 是 PDF 页索引到印刷页码的偏移（实测康华光为 22）。
    `headings_by_page` 允许外部注入当前页的标题路径；不传就只记本页遇到的标题。
    """
    chunks: list[Chunk] = []
    counter: dict[int, int] = {}
    running_path: list[str] = []

    for b in blocks:
        if b.kind == 'heading' and b.level > 0:
            # 维护标题栈：层级回退时截断
            running_path = running_path[: max(0, b.level - 1)]
            running_path.append(b.text)
            continue

        text = b.text.strip()
        rows = b.rows if b.kind == 'table' else None
        if b.kind == 'table' and rows:
            # 表格的文本形式也存一份，供检索用；rows 保留结构供渲染。
            # 优先用 rows 拼，因为它有行列边界；`text` 是格子按 y 排序后摊平的
            # 结果，数字串会连在一起无法切分。
            text = '\n'.join(' | '.join(c for c in r) for r in rows)
        if len(text) < MIN_CHARS and not rows and b.kind != 'figure':
            continue
        # 页眉页脚不是内容
        if not rows and _FURNITURE.match(text):
            continue

        kind = {'table': 'table', 'formula': 'formula', 'figure': 'figure'}.get(b.kind, 'text')
        pieces = _split_long(text) if kind == 'text' else [text]

        for piece in pieces:
            # 图注不适用正文的长度门槛：`图题1.1.2` 只有 7 个字符，
            # 但它是这张图**唯一**能被检索到的文本，丢掉等于这本书少了这张图。
            if len(piece) < MIN_CHARS and kind != 'figure':
                continue
            i = counter.get(b.page, 0)
            counter[b.page] = i + 1
            path = headings_by_page.get(b.page, running_path) if headings_by_page else running_path
            chunks.append(
                Chunk(
                    id=_stable_id(source_id, b.page, i, piece),
                    source_id=source_id,
                    kind=kind,
                    text=piece,
                    printed_page=b.page - page_offset,
                    pdf_page=b.page,
                    bbox=[round(v, 1) for v in (b.clip or b.bbox)],
                    heading_path=list(path),
                    rows=rows,
                )
            )
    return chunks


def drop_furniture(
    chunks: list[Chunk], outline_titles: set[str]
) -> tuple[list[Chunk], list[str]]:
    """
    丢弃页眉页脚，并剥掉正文块开头的页码装饰。返回 (保留的 chunk, 丢弃样本)。

    为什么必须二次过滤：页眉经常和标题**落在同一个版面块**里。实测这本书有
    两种形态 —— 独立成块的 `·2·1  数字逻辑概论`，以及粘在正文前的
    `●  4  ●1数字逻辑概论`。extract 阶段的整串正则只能拦住第一种。

    判据分两步，都不看 `heading_path`（实测它经常是空的：页眉出现在版面上
    的第一个标题之前）：
    1. 剥掉装饰与数字后，剩下的如果**正好是目录里的某个标题**，就是页眉 → 丢
    2. 否则若开头带装饰符号（`·`/`●`）且剥掉后还剩够长的正文 → 只剥前缀

    第 2 步特意要求「带装饰符号」。因为 `2.数字集成电路的特点…` 这种是以
    列表编号开头的正文，无装饰地剥数字会把编号吃掉。
    """
    def bare(s: str) -> str:
        return re.sub(r'\s+', '', re.sub(r'[·•●]', '', s)).strip()

    def strip_leading(s: str) -> str:
        # 只剥「带装饰」的开头：`·3·`、`●  4  ●` 这类
        return re.sub(r'^[·•●\d\s.]*[·•●][·•●\d\s.]*', '', s)

    kept: list[Chunk] = []
    dropped: list[str] = []
    for c in chunks:
        b = bare(c.text)
        if b in outline_titles:
            dropped.append(c.text)
            continue
        cleaned = strip_leading(c.text).strip()
        if cleaned != c.text.strip():
            if len(cleaned) < MIN_CHARS and not c.rows:
                dropped.append(c.text)
                continue
            c.text = cleaned
        kept.append(c)
    return kept, dropped


def write_content_dir(chunks: list[Chunk], out_dir: str | Path) -> dict[str, Any]:
    """落盘成 content/<source_id>/chunks.jsonl + 一份清单。"""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with (out / 'chunks.jsonl').open('w', encoding='utf-8') as f:
        for c in chunks:
            f.write(json.dumps(asdict(c), ensure_ascii=False) + '\n')
    manifest = {
        'chunkCount': len(chunks),
        'byKind': {k: sum(1 for c in chunks if c.kind == k) for k in ('text', 'formula', 'table')},
        'pageRange': [min((c.pdf_page for c in chunks), default=0), max((c.pdf_page for c in chunks), default=0)],
        'contentHash': hashlib.sha256(
            ''.join(c.id for c in chunks).encode()
        ).hexdigest()[:16],
    }
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return manifest
