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

#: 英文句末：句号/问号/叹号 **后面跟空白**。
#:
#: 为什么必须有 `\s+`：英文正文里 `Fig. 3.2`、`10.1109/TNS.2018.2840160`、
#: `1.5 V`、`M. Moszynski` 全都有句点。只认 `.` 会把它们切成一地碎片。
_SENTENCE_END_EN = re.compile(r'(?<=[.!?])\s+')

#: 缩写词：这些词后面的句点不是句末。
#:
#: 判据只对**紧邻标点的那个词**生效，所以 `et al. 1997.` 的 `al` 被挡掉、
#: 句末那个 `1997.` 照常切（`1997` 不在表里）。
_ABBREVIATIONS = frozenset({
    'fig', 'figs', 'figure', 'figures', 'eq', 'eqs', 'equation', 'equations',
    'ref', 'refs', 'reference', 'references', 'tab', 'tabs', 'table', 'tables',
    'no', 'nos', 'vol', 'vols', 'ch', 'chap', 'chaps', 'sec', 'secs', 'sect',
    'p', 'pp', 'pt', 'pts', 'art', 'app', 'appx', 'al', 'e.g', 'i.e', 'vs',
    'cf', 'approx', 'ca', 'resp', 'etc', 'ed', 'eds', 'inc', 'ltd', 'co',
    'corp', 'dept', 'univ', 'min', 'max', 'avg', 'std', 'typ', 'incl', 'excl',
    'st', 'dr', 'prof', 'mr', 'mrs', 'ms',
})

#: 句子开头：大写字母、数字、引号或左括号。空白之后不是这些，就说明
#: 上一处句点不是句末（`1.5 V. the voltage` 里 `the` 是小写）。
_SENTENCE_START = set('"\'\u201c\u2018([')


def _english_cuts(text: str) -> list[int]:
    """英文句末的切点下标（切点 = 句末标点后那段空白的结束处）。"""
    cuts: list[int] = []
    for match in _SENTENCE_END_EN.finditer(text):
        end = match.end()
        if end >= len(text):
            continue
        nxt = text[end]
        if not (nxt.isupper() or nxt.isdigit() or nxt in _SENTENCE_START):
            continue
        # 紧邻标点的那个词（含标点），去掉尾部标点后查缩写表
        start = match.start()
        k = start - 1
        while k >= 0 and not text[k].isspace():
            k -= 1
        token = text[k + 1:start].rstrip('.!?')
        if token.lower() in _ABBREVIATIONS:
            continue
        # 单个大写字母 = 人名首字母（`M. Moszynski`、`J. R. Smith`）
        if len(token) == 1 and token.isupper():
            continue
        cuts.append(end)
    return cuts


def _split_words(text: str) -> list[str]:
    """二级退化：按词边界切；单个词仍超长就三级硬切。

    `10.1109/TNS.2018.2840160` 这种没有空格的串必然走到硬切 —— 那里**不能**
    用 `while` 靠「切完还剩多少」推进，长度不缩短就会死循环。
    """
    parts: list[str] = []
    buf = ''
    for word in re.split(r'(\s+)', text):
        if not word:
            continue
        if len(word) > MAX_CHARS:
            if buf:
                parts.append(buf)
                buf = ''
            for k in range(0, len(word), MAX_CHARS):
                parts.append(word[k:k + MAX_CHARS])
            continue
        if len(buf) + len(word) > MAX_CHARS and buf:
            parts.append(buf)
            buf = word
        else:
            buf += word
    if buf:
        parts.append(buf)
    return parts


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


def _split_long(text: str, *, english_sentences: bool = False) -> list[str]:
    """超长段落切分。

    ## 为什么 `english_sentences` 默认关闭

    `_SENTENCE_END` 只认中文句末标点（`。！？；`），英文段落一个句号都切不开 ——
    整页正文会变成一个 2000~6900 字符的巨型 chunk（实测 15 本英文书 6219 个）。
    但 12 本中文书**已经入库**，chunkCount 是幂等导入的基线（73248），改切分规则
    必须让它们的产物逐字节不变。所以英文规则是逐本开关：英文书传 True，
    中文书走下面这条与改前完全一致的旧路径。
    """
    if len(text) <= MAX_CHARS:
        return [text]
    parts: list[str] = []
    buf = ''
    if not english_sentences:
        # 旧路径，逐字节保持（12 本中文书的 chunkCount 靠它不变）
        for sent in _SENTENCE_END.split(text):
            if len(buf) + len(sent) > MAX_CHARS and buf:
                parts.append(buf)
                buf = sent
            else:
                buf += sent
        if buf:
            parts.append(buf)
        return parts

    # 英文：先按句末切，再按词切，最后硬切（三级退化）
    cuts = _english_cuts(text)
    sentences: list[str] = []
    prev = 0
    for cut in cuts:
        sentences.append(text[prev:cut])
        prev = cut
    sentences.append(text[prev:])
    for sent in sentences:
        if not sent:
            continue
        if len(sent) > MAX_CHARS:
            if buf:
                parts.append(buf)
                buf = ''
            parts.extend(_split_words(sent))
            continue
        if len(buf) + len(sent) > MAX_CHARS and buf:
            parts.append(buf)
            buf = sent
        else:
            buf += sent
    if buf:
        parts.append(buf)
    return parts


def _split_table(text: str) -> list[str]:
    """按行（表格的行）切，每段不超 `MAX_CHARS`。

    表格的 `text` 是 `\n`.join(' | '.join(row))，换行就是行边界。切在行边界
    上，每段仍是完整的行 —— 在格中间切会把 `| 1.00 | 2.30 |` 劈成两半，
    下游既看不出列也看不出行。

    单行就超长时（OCR 把整页表格串成一行）退回 `_split_long` 的词级/硬切。
    """
    if len(text) <= MAX_CHARS:
        return [text]
    parts: list[str] = []
    buf = ''
    for line in text.split('\n'):
        if len(line) > MAX_CHARS:
            if buf:
                parts.append(buf)
                buf = ''
            parts.extend(_split_long(line, english_sentences=True))
            continue
        if len(buf) + len(line) + 1 > MAX_CHARS and buf:
            parts.append(buf)
            buf = line
        else:
            buf = f'{buf}\n{line}' if buf else line
    if buf:
        parts.append(buf)
    return parts


def blocks_to_chunks(
    blocks: list[Block],
    source_id: str,
    *,
    page_offset: int,
    headings_by_page: dict[int, list[str]] | None = None,
    english_sentences: bool = False,
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
            # 表题（`表1.3 线性响应指标`）是这个表**唯一**的语义入口：只按
            # 行拼会把表题丢掉，搜「线性响应指标」就搜不到这张表。扫描件的
            # 表题放在 `Block.text` 里，电子版的表题在自身上一行（Block.text
            # 为空），两种情况都把非空的那个前置。
            grid = '\n'.join(' | '.join(c for c in r) for r in rows)
            text = f'{text}\n{grid}' if text else grid
        if len(text) < MIN_CHARS and not rows and b.kind != 'figure':
            continue
        # 页眉页脚不是内容
        if not rows and _FURNITURE.match(text):
            continue

        kind = {'table': 'table', 'formula': 'formula', 'figure': 'figure'}.get(b.kind, 'text')
        # `formula` 也要切：`extract.py` 的判据是「含任一数学符号」，实测把大段
        # **散文**误判成公式（knoll-3e 有 219 个 >1200 字符的 `formula` chunk，
        # 内容是 `Natural background radiation is an important additional...`）。
        # 只在 `english_sentences=True` 时切 —— 中文书的 `formula` 保持旧行为，
        # 否则超长中文公式块会让 chunkCount 基线变动。
        if english_sentences and kind == 'table':
            # 表格按行切（保留 `| a | b |` 的网格形状）；中文书不动。
            pieces = _split_table(text)
        else:
            split_kind = kind == 'text' or (english_sentences and kind == 'formula')
            pieces = (
                _split_long(text, english_sentences=english_sentences)
                if split_kind
                else [text]
            )

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

    # 整页兜底：一个页面 OCR 出了字，却因为每块都短于 MIN_CHARS（图多的
    # 页面里全是「12V」「(5.6k)」「施密特电路」这种碎片）而被逐块丢掉 ——
    # 这是**静默丢页**。实测 11 本扫描书里有 60 个正文页栽在这里（王芝英
    # p236/p268 各 OCR 出 34/42 行却 0 个 chunk）。把整页碎片拼成一条，
    # 长度够就留下；不够说明这页真的只有页码/页眉，那就该丢。
    if not chunks and blocks:
        whole = ' '.join(b.text.strip() for b in blocks if b.kind != 'heading' and b.text.strip())
        if len(whole) >= MIN_CHARS:
            first = blocks[0]
            chunks.append(
                Chunk(
                    id=_stable_id(source_id, first.page, 0, whole),
                    source_id=source_id,
                    kind='text',
                    text=whole,
                    printed_page=first.page - page_offset,
                    pdf_page=first.page,
                    bbox=[round(v, 1) for v in first.bbox],
                    heading_path=list(running_path),
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
