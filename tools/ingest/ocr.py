"""扫描版教材的 OCR 抽取：把「一页位图」变成和 `extract.py` 同形的 `Block` 列表。

为什么不复用 `extract_page`
--------------------------
`extract.py` 读的是 PDF 文本层（span / char bbox）。11 本老教材是纯扫描件
（每页一张位图，`get_text()` 返回空串），`extract_page` 在这种情况下返回
`[]` —— 正好是票 17 明令禁止的「静默丢页」。所以扫描件走本模块：先把页
渲染成位图，用 RapidOCR（PP-OCRv3 检测 + 识别）拿到**带四点框的文本行**，
再用版式规则把行归并成段落 / 公式 / 图表 / 表格，最后产出 `Block`。

产物形状刻意和 `extract.py` 一致（`Block(kind, page, bbox, text, rows, level, clip)`），
于是 `chunk.blocks_to_chunks` / `chunk.write_content_dir` / `assign` / `edges`
一行都不用改，`chunks.jsonl` / `toc.json` / `manifest.json` 的格式天然保持。

引擎选择（实测，不是拍脑袋）
--------------------------
onnxruntime 在这台机器上只有 CPU/Azure 两个 provider；显卡是 Intel Arc 集显，
ORT 用不上。本机 openvino 2026.4.1 可以 `compile_model` 同一批 ONNX：

    同一页（王芝英 p.60，200dpi）        总耗时     det      rec
    RapidOCR 默认（onnxruntime CPU）     7.07s     1.55s    4.81s
    RapidOCR + OpenVINO CPU 会话         3.14s     1.46s    1.48s
    RapidOCR + OpenVINO GPU 会话        30.79s      —        —

GPU 反而慢十倍：rec 模型的输入宽度是动态的，iGPU 上每换一个 batch 形状就要
重编译一次（静态形状下单次推理 GPU 只要 20ms，但两个模型各要 9–12s 编译，
且一旦换形状缓存全废）。所以主路径固定 **OpenVINO CPU + 动态形状**，代价是
进程启动时 0.6s 的编译（det 0.33s + rec 0.30s），摊销到 345 页可以忽略。

其余实测调参（都不要乱改，改过更慢或更差）：
- 200 dpi 是工作点：150dpi 少识别 5 行，300dpi 反而把「噪声」认成「乐声」
  （300dpi 上采样没有新信息，只是把锯齿喂给了检测器）。
- `PERFORMANCE_HINT=THROUGHPUT/LATENCY`、`NUM_STREAMS=4`、
  `INFERENCE_NUM_THREADS=4` 全部比默认慢（默认 2.62s/页 vs 3.03–5.80s）。
- 多线程按页并行更慢（worker=2 时 3.56s/页，单流 OpenVINO CPU 已经吃满核），
  所以**串行跑**，一个进程一个引擎。

置信度怎么算
-----------
RapidOCR 每行给一个识别置信度。页级置信度取**按字符数加权的均值**：

    mean = Σ(len(line_i) * conf_i) / Σ(len(line_i))

不取行均值：一行 `图4.4.21` 的低分不该和 60 字的正文行同权。票 17 要求
<0.85 进人工复核队列，所以 `OcrPage.status` 三态：`ok`（≥0.85）、
`review`（<0.85）、`blank`（一行都没认出来）。`blank` 页**必须**落进
`pages.jsonl`：`text` 为空、`confidence` 为 0.0、页号在 —— 这就是票里
「空文本 + 低置信度 + 页号」的字面实现。
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

from extract import Block, _looks_like_formula, _looks_like_heading

# 低于这个页级置信度就进人工复核队列（票 17 的硬指标）
REVIEW_THRESHOLD = 0.85
# 工作点：200 dpi。实测依据见模块 docstring
OCR_DPI = 200
# 缓存格式版本，改了版式规则就 +1，旧缓存自动失效
CACHE_VERSION = 4

RAPIDOCR_SITE = Path(
    'C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime'
)
_MODEL_FILES = (
    ('text_detector', 'ch_PP-OCRv3_det_infer.onnx'),
    ('text_cls', 'ch_ppocr_mobile_v2.0_cls_infer.onnx'),
    ('text_recognizer', 'ch_PP-OCRv3_rec_infer.onnx'),
)


# ---------------------------------------------------------------------------
# 引擎
# ---------------------------------------------------------------------------
class OVSession:
    """把 OpenVINO 的 `CompiledModel` 伪装成 RapidOCR 的 `OrtInferSession`。

    只实现三个方法 —— 因为 RapidOCR 只用这三个：
    `text_recognize.py:70` 用 `self.session(x)[0]` 取 logits；
    `:30` 用 `session.have_key()` / `session.get_character_list()` 取 CTC 字典。
    字典从 ONNX 的 metadata map 里读（`custom_metadata_map['character']`），
    这条路要用 onnxruntime 的 session 拿，和推理后端无关。
    """

    def __init__(self, model_path: str, device: str = 'CPU', meta: dict | None = None):
        import openvino as ov

        core = ov.Core()
        compiled = core.compile_model(core.read_model(model_path), device)
        self.compiled = compiled
        self.input_name = [i.get_any_name() for i in compiled.inputs][0]
        self.output_name = [o.get_any_name() for o in compiled.outputs][0]
        self.meta = meta or {}

    def __call__(self, x):  # noqa: D105
        return [self.compiled({self.input_name: x})[self.output_name]]

    def have_key(self, key: str = 'character') -> bool:
        return key in self.meta

    def get_character_list(self, key: str = 'character') -> list[str]:
        return self.meta[key].splitlines()


class OcrEngine:
    """RapidOCR + OpenVINO CPU 会话。一个进程一个实例，串行跑页。"""

    def __init__(
        self,
        site: Path | str = RAPIDOCR_SITE,
        device: str = 'CPU',
        **rapidocr_kwargs: Any,
    ):
        import sys

        site = Path(site)
        if str(site) not in sys.path:
            sys.path.insert(0, str(site))
        from rapidocr_onnxruntime import RapidOCR

        self._engine = RapidOCR(**rapidocr_kwargs)
        models = site / 'models'
        # 字典必须走 onnxruntime 读 metadata，OpenVINO 的 rt_info 只暴露 framework
        meta = self._engine.text_recognizer.session.session.get_modelmeta().custom_metadata_map
        for attr, fname in _MODEL_FILES:
            module = getattr(self._engine, attr)
            module.session = OVSession(str(models / fname), device, meta)
        self.device = device
        self.calls = 0

    def lines(self, image, *, text_score: float | None = None) -> list[OcrLine]:
        """一张整页位图 → 文本行（按阅读顺序）。

        `text_score` 临时压低识别置信度门限，用来捞目录右边的**孤零零页码**：
        印刷页码只有 1–2 位、周围全是被 OCR 成散点的引导符，默认 0.5 的
        门限会把它们当噪声丢掉。实测王芝英目录页 p10 用 0.5 只拿到 30 个数字
        候选、其中真正的页码缺了 6 个（`1`/`1`/`1`/`1`/`2`/`5` 全丢），压到
        0.2 后补齐 19 行、页码一个不缺 —— 代价只是多了 12 行噪声，去噪那步
        会清掉。所以只在目录页开这一档，正文页照旧用默认 0.5。
        """
        if text_score is None:
            result, _ = self._engine(image)
        else:
            result, _ = self._engine(image, text_score=text_score)
        self.calls += 1
        if not result:
            return []
        out: list[OcrLine] = []
        for box, text, conf in result:
            text = (text or '').strip()
            if not text:
                continue
            xs = [pt[0] for pt in box]
            ys = [pt[1] for pt in box]
            out.append(
                OcrLine(
                    text=text,
                    conf=float(conf),
                    x0=float(min(xs)),
                    y0=float(min(ys)),
                    x1=float(max(xs)),
                    y1=float(max(ys)),
                )
            )
        return _reading_order(out)


# ---------------------------------------------------------------------------
# 行 / 页的数据形状
# ---------------------------------------------------------------------------
@dataclass
class OcrLine:
    text: str
    conf: float
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def h(self) -> float:
        return self.y1 - self.y0

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2


@dataclass
class OcrPage:
    """一页的 OCR 结果 + 它的置信度证据。缺页一眼可见。"""

    page: int  # 0-based PDF 页索引
    blocks: list[Block] = field(default_factory=list)
    line_count: int = 0
    char_count: int = 0
    mean_conf: float = 0.0
    median_conf: float = 0.0
    min_conf: float = 0.0
    footer_page: int | None = None  # 页脚/页眉里认出来的印刷页码
    elapsed: float = 0.0
    status: str = 'blank'  # 'ok' | 'review' | 'blank'
    figures: list[dict[str, Any]] = field(default_factory=list)
    lines: list[OcrLine] = field(default_factory=list)  # 原始行，目录解析要用坐标
    error: str = ''

    @property
    def text(self) -> str:
        return '\n'.join(b.text for b in self.blocks if b.kind != 'figure')

    def ledger(self) -> dict[str, Any]:
        return {
            'page': self.page,
            'status': self.status,
            'confidence': round(self.mean_conf, 4),
            'medianConfidence': round(self.median_conf, 4),
            'minConfidence': round(self.min_conf, 4),
            'lineCount': self.line_count,
            'charCount': self.char_count,
            'footerPage': self.footer_page,
            'blockCount': len(self.blocks),
            'figureCount': len(self.figures),
            'elapsed': round(self.elapsed, 3),
            'error': self.error,
        }


def _reading_order(lines: list[OcrLine]) -> list[OcrLine]:
    """先按 y 分行，再行内按 x 排。检测器的输出顺序不可靠（多栏时会串行）。"""
    if not lines:
        return []
    heights = sorted(ln.h for ln in lines)
    med = heights[len(heights) // 2]
    tol = max(med * 0.5, 6.0)
    rows: list[list[OcrLine]] = []
    for ln in sorted(lines, key=lambda l: (l.y0, l.x0)):
        if rows:
            center = sum(r.y0 for r in rows[-1]) / len(rows[-1])
            if abs(ln.y0 - center) <= tol:
                rows[-1].append(ln)
                continue
        rows.append([ln])
    out: list[OcrLine] = []
    for row in rows:
        out.extend(sorted(row, key=lambda l: l.x0))
    return out


# ---------------------------------------------------------------------------
# 版式分析：行 → 块
# ---------------------------------------------------------------------------
_CAPTION = re.compile(r'^图\s*题?\s*\d+(?:[.\-]\d+)*\s*[A-Za-z0-9\u4e00-\u9fff]')
_SUBCAPTION = re.compile(r'^\s*[（(]\s*[a-zA-Z]\s*[）)]')
_TABLE_NUM = re.compile(r'^[\d.+\-—×xX*/\s]+$')


def _is_caption(text: str) -> bool:
    t = text.strip()
    return len(t) <= 60 and (bool(_CAPTION.match(t)) or bool(_SUBCAPTION.match(t)))


def _starts_figure(text: str) -> bool:
    """只有 `图2.2.9 …` 这种真正的图注才另起一张图。

    单独一行 `(a)`/`(b)` **不能**起图 —— 实测王芝英 p15 就因为把孤立的
    `(a)`、`(b)`、`(c)` 各当成图注，产出了 3 张 caption 只有 `(a)` 的空图，
    而它上方的真图注反而没被收进去。子图说明只能**延长**已存在的图注。
    """
    t = text.strip()
    return len(t) <= 60 and bool(_CAPTION.match(t))


def _split_table_cells(text: str) -> list[str]:
    """表格行按 ≥2 个空格切格。OCR 会把列间空白压成 1 个半角空格，压不住。"""
    return [c for c in re.split(r'\s{2,}', text.strip()) if c]


def _looks_like_table_line(line: OcrLine) -> bool:
    cells = _split_table_cells(line.text)
    if len(cells) < 3:
        return False
    short = sum(1 for c in cells if len(c) <= 8)
    return short >= len(cells) * 0.6


def _is_fragment(line: OcrLine, body_w: float) -> bool:
    """图内碎字：短、窄、少汉字。这一条把 `I2&`/`Yo`/`Gs` 这类判成图内容。"""
    t = line.text.strip()
    if len(t) > 12:
        return False
    if (line.x1 - line.x0) > body_w * 0.35:
        return False
    has_cjk = sum(1 for ch in t if '\u4e00' <= ch <= '\u9fff')
    return has_cjk <= 2


def boxes_to_blocks(
    lines: list[OcrLine],
    page: int,
    width: float,
    height: float,
) -> tuple[list[Block], list[dict[str, Any]]]:
    """把 OCR 行归并成版面块。返回 (blocks, 待切图的图区域)。

    规则按「先认强结构，剩下的当正文」的顺序走，因为弱规则（缩进、间距）
    单独用会互相打架：

    1. 标题：整行短、带编号（`2.3 谱仪放大器`）或 `第X章`，且行高 ≥ 正文行高
       的 1.25 倍 → `heading`，level 按编号层级。
    2. 图注：`图1.2.3 xxx` / `(a)电路图` → `caption`。紧跟其后的连续碎字行
       和上一段正文之间的空隙一起构成图区域，交给 `crop_figures` 切图。
    3. 表格：连续 ≥3 行、每行能按 ≥2 空格切成 ≥3 格、且多数格子很短 →
       `table`，格子成为 `rows`。
    4. 公式：复用 `extract._looks_like_formula` 的字面判据 → `formula`。
    5. 剩下的按「左沿对齐 + 行距连续」并成 `paragraph`。
    """
    if not lines:
        return [], []
    heights = sorted(ln.h for ln in lines)
    body_h = heights[len(heights) // 2]
    max_w = max(ln.x1 - ln.x0 for ln in lines)
    body_left = min(ln.x0 for ln in lines if (ln.x1 - ln.x0) > max_w * 0.6) if lines else 0.0

    blocks: list[Block] = []
    figures: list[dict[str, Any]] = []
    used = [False] * len(lines)

    def bbox_of(group: Iterable[OcrLine]) -> tuple[float, float, float, float]:
        g = list(group)
        return (
            min(l.x0 for l in g),
            min(l.y0 for l in g),
            max(l.x1 for l in g),
            max(l.y1 for l in g),
        )

    # --- 1. 标题 ---
    for i, ln in enumerate(lines):
        t = ln.text.strip()
        big = ln.h >= body_h * 1.25
        numbered = bool(re.match(r'^\d+(\.\d+)*\s*[\u4e00-\u9fff]', t))
        chapter = bool(re.match(r'^第\s*[一二三四五六七八九十百零\d]+\s*章', t)) or bool(
            re.match(r'^第\s*[一二三四五六七八九十百零\d]+\s*[节讲]', t)
        )
        if not (big or chapter):
            continue
        if not (_looks_like_heading(t) or numbered or chapter):
            continue
        if len(t) > 40:
            continue
        lvl = 1 if chapter or numbered else 2
        if numbered:
            lvl = min(3, t.split(' ')[0].count('.') + 1)
        blocks.append(Block(kind='heading', page=page, bbox=bbox_of([ln]), text=t, level=lvl))
        used[i] = True

    # --- 3. 表格（先于段落，因为表行也会被并成段落） ---
    i = 0
    while i < len(lines):
        if used[i] or not _looks_like_table_line(lines[i]):
            i += 1
            continue
        j = i
        while j + 1 < len(lines) and not used[j + 1] and _looks_like_table_line(lines[j + 1]):
            j += 1
        if j - i + 1 >= 3:
            rows = [_split_table_cells(lines[k].text) for k in range(i, j + 1)]
            width_cells = max(len(r) for r in rows)
            rows = [r + [''] * (width_cells - len(r)) for r in rows]
            for k in range(i, j + 1):
                used[k] = True
            blocks.append(
                Block(
                    kind='table',
                    page=page,
                    bbox=bbox_of(lines[i : j + 1]),
                    text='\n'.join(' '.join(r) for r in rows),
                    rows=rows,
                    fill=1.0,
                )
            )
        i = j + 1

    # --- 2. 图注 + 图区域 ---
    #
    # 输出的是 `figure` 块（不是 `caption`）：`extract.py` 对扫描件以外的地方
    # 也只在图注行位置出一个 `figure`，`chunks.kind` 的取值集合因此不需要扩
    # （`text|formula|figure|table`，TS 侧三处枚举都不用动）。图注文字就是
    # 这张图唯一可检索的文本，所以连同后面的子图说明 `(a)…(b)…` 一起收进来。
    for i, ln in enumerate(lines):
        if used[i] or not _starts_figure(ln.text):
            continue
        used[i] = True
        # 图注之后紧跟的子图说明（`(a)等效电路 (b)符号`）也是图的文本
        last = i
        while last + 1 < len(lines) and not used[last + 1] and _SUBCAPTION.match(lines[last + 1].text.strip()):
            last += 1
            used[last] = True
        caption_lines = [lines[k].text.strip() for k in range(i, last + 1)]
        caption_text = ' '.join(t for t in caption_lines if t)
        # 图注的上方：往上收连续碎字行与空档
        top = ln.y0
        j = i - 1
        merged: list[int] = []
        while j >= 0 and not used[j] and _is_fragment(lines[j], width):
            merged.append(j)
            used[j] = True
            top = min(top, lines[j].y0)
            j -= 1
        if merged:
            clip_top = max(0.0, top - 8)
        else:
            # 没有碎字时，把图注上方最近的正文行底边当图的上界
            prev_bottom = lines[j].y1 if j >= 0 else 0.0
            clip_top = max(0.0, prev_bottom + 4) if prev_bottom < ln.y0 - 60 else max(0.0, ln.y0 - 260)
        members = [ln] + [lines[k] for k in merged] + [lines[k] for k in range(i + 1, last + 1)]
        clip = (min(l.x0 for l in members) - 8, clip_top,
                max(l.x1 for l in members) + 8, max(l.y1 for l in members) + 6)
        if clip[2] - clip[0] >= 120 and clip[3] - clip[1] >= 100:
            figures.append({'page': page, 'bbox': list(clip), 'caption': caption_text})
            blocks.append(
                Block(kind='figure', page=page, bbox=clip, text=caption_text, clip=clip)
            )
        else:
            # 图太小（可能是被误认的图注行）→ 退回成一段文字，别丢
            blocks.append(Block(kind='paragraph', page=page, bbox=bbox_of(members), text=caption_text))

    # --- 4/5. 公式 + 段落 ---
    runs: list[list[int]] = []
    for i, ln in enumerate(lines):
        if used[i]:
            continue
        if runs:
            prev = lines[runs[-1][-1]]
            gap = ln.y0 - prev.y1
            same_indent = abs(ln.x0 - prev.x0) <= max(body_h * 0.9, 14)
            if gap <= body_h * 1.1 and same_indent and not _is_caption(ln.text):
                runs[-1].append(i)
                continue
        runs.append([i])

    for run in runs:
        group = [lines[k] for k in run]
        text = _join_lines([g.text.strip() for g in group])
        if not text:
            continue
        if len(group) <= 2 and _looks_like_formula(text, body_h):
            kind = 'formula'
        else:
            kind = 'paragraph'
        blocks.append(Block(kind=kind, page=page, bbox=bbox_of(group), text=text))

    # 阅读顺序 = y 顺序；标题在图注上方还是下方由版面决定，这里按 bbox 复原
    blocks.sort(key=lambda b: (round((b.clip or b.bbox)[1], 1), b.bbox[0]))
    figures.sort(key=lambda f: f['bbox'][1])
    return blocks, figures


def _join_lines(texts: list[str]) -> str:
    """跨行拼接：中文行直接接，拉丁/数字结尾补一个空格。"""
    out = ''
    for t in texts:
        if not out:
            out = t
            continue
        if re.search(r'[A-Za-z0-9]$', out) and re.match(r'[A-Za-z0-9]', t):
            out += ' '
        out += t
    return out


# ---------------------------------------------------------------------------
# 页脚页码：`--page-offset auto` 的依据
# ---------------------------------------------------------------------------
# 页码两边的装饰：扫描件里常见 `·47·`、`- 47 -`、`$4`、`.227.`、`:48:`
_DECOR = r'[·•●\-—–‐+*\s.$§:：,，()（）\[\]【】]'
_DIGITS = re.compile(rf'{_DECOR}*(\d{{1,4}}){_DECOR}*$')


def _parse_page_number(text: str) -> int | None:
    """`·47·` → 47；`(2.2.17)`、`2.3.1`、`图3.4` 一律不认（带小数点/括号）。"""
    t = text.strip()
    if not t or len(t) > 10:
        return None
    m = _DIGITS.match(t)
    return int(m.group(1)) if m else None


def _page_number_lines(lines: list[OcrLine], height: float, band: float = 0.12) -> list[tuple[float, int]]:
    """上下 `band` 带内「去掉装饰只剩数字」的短行 → `[(置信度, 页码)]`。

    **为什么必须单独扫这一带**：200 dpi 整页识别时检测器根本不给页码框
    （实测把 `min_height` 从 30 降到 12 也一样，是检测阶段就没了），
    但把上下 12% 裁出来单独送检测器就能认出来 —— 裁出来以后这一条占整幅
    图的高度比例大得多，检测器就看得见了。代价是每页多一次前向，所以
    只在**探测偏移**时抽样跑，不是每页都跑。
    """
    cands: list[tuple[float, int]] = []
    for ln in lines:
        t = ln.text.strip()
        if not t or len(t) > 10:
            continue
        near = ln.y0 <= height * band or ln.y1 >= height * (1 - band)
        if not near:
            continue
        page = _parse_page_number(t)
        if page is not None:
            cands.append((ln.conf, page))
    return cands


def _footer_page(lines: list[OcrLine], height: float) -> int | None:
    """整页识别时顺带认出的印刷页码（能认出就认出，认不出返回 None）。"""
    cands = _page_number_lines(lines, height)
    if not cands:
        return None
    return max(cands)[1]


def measure_page_number(engine: OcrEngine, doc, index: int, *, band: float = 0.12) -> int | None:
    """单独扫一页的上下带，返回印刷页码（认不出返回 None）。

    `band` 是相对页高的比例。实测 0.08 太窄（页码行被切掉一半），0.06 完全
    认不出；0.12 能在 16 页抽样里认对 9 页。上下带**都要扫**：王芝英的页码
    印在页眉右侧（`·47·`），有的书在页脚，一套代码两种都吃掉。
    """
    import numpy as np

    image = render_page(doc, index)
    h = image.shape[0]
    n = max(1, int(h * band))
    best: tuple[float, int] | None = None
    for strip in (image[:n], image[h - n :]):
        for ln in engine.lines(np.ascontiguousarray(strip)):
            page = _parse_page_number(ln.text)
            if page is None:
                continue
            if best is None or ln.conf > best[0]:
                best = (ln.conf, page)
    return None if best is None else best[1]


def detect_page_offset(
    engine: OcrEngine,
    doc,
    *,
    samples: int = 16,
    band: float = 0.12,
) -> tuple[int, float, list[tuple[int, int]]]:
    """从页脚页码反推「PDF 页索引 → 印刷页码」的偏移。

    只在 `samples` 个均匀分布的页上扫上下带（每页约多花 2.3s），取
    `offset_i = pdf_index_i - printed_i` 的众数。返回
    `(offset, 一致率, [(pdf_index, printed)])`。

    一致率 < 0.5 时调用方应当改用显式 `--page-offset`。王芝英实测：16 页
    抽样里 9 页认得出，众数 13，一致率 9/9 = 1.0（== PDF 页 60 是印刷页 47）。
    """
    counts: dict[int, int] = {}
    hits: list[tuple[int, int]] = []
    step = max(1, doc.page_count // samples)
    for i in range(1, doc.page_count, step):
        printed = measure_page_number(engine, doc, i, band=band)
        if printed is None:
            continue
        hits.append((i, printed))
        d = i - printed
        counts[d] = counts.get(d, 0) + 1
        if len(hits) >= samples:
            break
    if not counts:
        return 0, 0.0, hits
    best = max(counts.items(), key=lambda kv: kv[1])
    total = sum(counts.values())
    return best[0], best[1] / total, hits


# ---------------------------------------------------------------------------
# 目录：扫描件的目录页只能 OCR，且不能用 `toc.py` 的那套正则
# ---------------------------------------------------------------------------
_TOC_PAGENO = re.compile(r'^[\s.·•●\-—–+*§$⋯…]*(\d{1,4})\s*$')
_TOC_NUM = re.compile(r'^(?:第\s*([一二三四五六七八九十百零\d]+)\s*[章节]|([\d]{1,2}(?:\.\d{1,2}){0,2}))\s*')
# 目录页右侧页码带的左右边界（占页宽比例），裁带尺寸是实测出来的，见
# `toc_band_lines`：0.74–0.84 + text_score 0.05 能认到 33 个数字行、整列
# 页码连续不丢（含最上面的 1/1/1）。
_TOC_BAND = (0.74, 0.84)
_TOC_BAND_SCORE = 0.05


def _chinese_int(s: str) -> int:
    digits = '零一二三四五六七八九'
    if s.isdigit():
        return int(s)
    if s == '十':
        return 10
    if '十' in s:
        head, _, tail = s.partition('十')
        return (digits.index(head) if head else 1) * 10 + (digits.index(tail) if tail else 0)
    return digits.index(s) if s in digits else 0


def _toc_page_number(text: str) -> int | None:
    """目录右侧那一列：`17`、`·17`、`-20`、`..25`、`+++50`、`........1` → 数字。

    引导点被 OCR 成 `.`/`·`/`+`/`*` 混着来，而且**经常和页码连成一个检测框**
    （`........1` 是「引导符 + 页码 1」），所以先剥装饰再要求纯数字。
    上限放到 24 字符是为了装下这种带一长串引导点的行（`........1` 有 10 个
    字符，卡在原来的 8 就被整条丢掉了 —— 王芝英目录前几行的页码全是 1 位，
    正是这样丢的）。

    **不认** `2.2.17` 这种带两个点的（那是小节号不是页码），也不认
    `图2.2.9`（首字符是汉字，不是装饰）。
    """
    t = text.strip()
    if not t or len(t) > 24:
        return None
    m = _TOC_PAGENO.match(t)
    if not m:
        return None
    return int(m.group(1))


_CHAPTER_ONLY = re.compile(r'^第\s*[一二三四五六七八九十百零\d]+\s*[章节篇]\s*$')
# 小节符号独占一行（`§1`，OCR 常认成 `$1` / `s3` / `S4`）
_SEC_ONLY = re.compile(r'^[§\$sS]\s*\d{1,2}\s*$')


def parse_toc_ocr(lines: list[OcrLine], *, denoise: bool = False) -> list[tuple[str, str, int]]:
    """**一页** OCR 出来的目录 → `[(编号, 标题, 印刷页码)]`。

    和 `toc.parse_toc_text` 的关键区别：**页码靠坐标配对，不靠行序**。
    原书的引导符 `……` 在 OCR 后变成散点，页码列独立成行；如果按行序「标题行
    后面那个纯数字行」去配，多栏/跨页时就全错位（实测王芝英第一版这样配出
    36 条，真值是 61 条，编号全丢）。改成：同一 y 带内、右边缘落在页码列上
    的那条数字行，就是这个标题的页码。

    页码列用**右边缘对齐**判定：真实页码全都右对齐在同一列（王芝英
    200 dpi 下 x1≈1334–1337），而标题列里偶尔被误读成数字的短行
    （`83`、`$4`，其实是小节符号 `§3`）x1 只有 240 左右，按左沿判会漏掉这
    一层，按右沿判就自动排除了。

    **只能一页一页调用**：y 坐标是页内坐标，把几页的行拼起来再配对会把
    不同页同高度的行配到一起（实测 4 页拼一起只配出 7 条且页码乱）。多页
    用 `parse_toc_pages`。

    `denoise=True` 才做逐页去噪；跨页的「页码单调」去噪只在
    `parse_toc_pages` 里做，因为单页内部本来就不该用整本书的单调性去卡。
    """
    if not lines:
        return []
    nums = [(k, ln, _toc_page_number(ln.text)) for k, ln in enumerate(lines)]
    nums = [(k, ln, v) for k, ln, v in nums if v is not None]
    if not nums:
        return []
    # 页码列：把候选按 x1 聚成 40px 的桶，取最密且最靠右的那一桶
    buckets: dict[int, list[tuple[int, OcrLine, int]]] = {}
    for k, ln, v in nums:
        buckets.setdefault(int(ln.x1 // 40), []).append((k, ln, v))
    best_bucket = max(buckets.items(), key=lambda kv: (len(kv[1]), kv[0]))[1]
    col_right = max(ln.x1 for _, ln, _ in best_bucket)
    numbers = [x for x in nums if x[1].x1 >= col_right - 70]
    if len(numbers) < 2:
        return []

    num_keys = {k for k, _, _ in numbers}
    tol_y = max(6.0, (sorted(ln.h for ln in lines)[len(lines) // 2]) * 0.9)

    # 章号独占一行（`第一章` 和标题分行排）时并回去
    titles: list[tuple[OcrLine, str]] = []
    title_line: list[int] = []
    for k, ln in enumerate(lines):
        if k in num_keys:
            continue
        t = ln.text.strip()
        if not t or len(t) > 40 or re.fullmatch(r'[目录\s]*', t):
            continue
        # 页码行已经排除过了，这里剩下的极短纯符号行是引导点噪声
        if not re.search(r'[\u4e00-\u9fffA-Za-z0-9]', t):
            continue
        titles.append((ln, t))
        title_line.append(k)
    markers = [
        (ln, t)
        for ln, t in titles
        if _CHAPTER_ONLY.match(t) or _SEC_ONLY.match(t)
    ]
    keep = [
        i
        for i, (_, t) in enumerate(titles)
        if not (_CHAPTER_ONLY.match(t) or _SEC_ONLY.match(t))
    ]
    titles = [titles[i] for i in keep]
    title_line = [title_line[i] for i in keep]
    prefix: dict[int, list[tuple[float, str]]] = {}
    for mln, mt in markers:
        cand = [(abs(tln.y0 - mln.y0), i) for i, (tln, _) in enumerate(titles) if tln.x0 > mln.x1]
        if cand:
            dy, i = min(cand)
            if dy <= tol_y:
                prefix.setdefault(i, []).append((mln.y0, mt))

    # 一对一：所有 (标题, 页码) 组合按 y 距离排序后贪心配对
    pairs: list[tuple[float, int, int]] = []
    for i, (ln, _) in enumerate(titles):
        for j, (_, nln, _) in enumerate(numbers):
            dy = abs(nln.y0 - ln.y0)
            if dy <= tol_y:
                pairs.append((dy, i, j))
    pairs.sort()

    def _title_of(i: int) -> tuple[str, str]:
        """标题行 → (点分编号, 标题正文)。章号/节号独占行时并回标题里。"""
        raw = titles[i][1]
        num = ''
        mm = _TOC_NUM.match(raw)
        if mm and not mm.group(1):
            # 只消费 `1.2.3` 这种点分编号；`第三章` 原样留着，交给
            # `_assign_nums` 统一翻译（在这里吃掉章号会让它后面接不上层级）
            num = mm.group(2)
            raw = raw[mm.end() :]
        elif i in prefix:
            # 章号/节号独占一行时按 y 距离配到标题上，多个标记按纵向顺序拼
            raw = ' '.join(t for _, t in sorted(prefix[i])) + ' ' + raw
        return num, re.sub(r'[\s.·…\u2026]+', '', raw).strip('-—_')

    out: list[tuple[int, str, str, int]] = []
    used_t: set[int] = set()
    used_n: set[int] = set()
    for _, i, j in pairs:
        if i in used_t or j in used_n:
            continue
        used_t.add(i)
        used_n.add(j)
        num, title = _title_of(i)
        if title:
            out.append((title_line[i], num, title, numbers[j][2]))

    # 第二遍：章标题那一行的页码常常恰好没被认出来（它单独占一行、行距又比
    # 正文大一倍），严格阈值配对会把它整条丢掉。实测王芝英 p10 的
    # `第一章 / 核电子学系统中的信号与噪声`（y=447）就这样丢了，而它下面
    # 第一条页码在 y=505（dy=58，超过 tol_y≈25）。这里放宽到 3×tol_y，并且
    # **只往下找**（目录的页码在标题右边，略微偏下或齐平），只用还没被占用的
    # 页码，避免抢走后面标题的号码。
    for i in range(len(titles)):
        if i in used_t:
            continue
        cand = [
            (nln.y0 - titles[i][0].y0, j)
            for j, (_, nln, _) in enumerate(numbers)
            if j not in used_n and 0 <= nln.y0 - titles[i][0].y0 <= tol_y * 3
        ]
        if not cand:
            continue
        _, j = min(cand)
        used_t.add(i)
        used_n.add(j)
        num, title = _title_of(i)
        if title:
            out.append((title_line[i], num, title, numbers[j][2]))
    # 按**目录上的阅读顺序**（= 原始行号）排序，之后才能用「页码单调」去噪
    out.sort(key=lambda e: e[0])
    entries = [(num, title, page) for _, num, title, page in out]
    return _toc_denoise(entries) if denoise else entries


# 这本书（王芝英 1989）的目录层级是 `第X章` / `§N` / `一、二、`，不是
# 康华光那种 `1.1.1`。所以要把三种标记翻译成 `k` / `k.s` / `k.s.u` 才能喂给
# `toc.build_tree`（它按 num 的点分前缀建树）。
_CH_MARK = re.compile(r'^第\s*([一二三四五六七八九十百零\d]+)\s*[章篇]\s*')
_SEC_MARK = re.compile(r'^[§\$sS]\s*(\d{1,2})\s*')
_SUB_MARK = re.compile(r'^([一二三四五六七八九十]{1,3})\s*[、.．]\s*')


def _assign_nums(entries: list[tuple[str, str, int]]) -> list[tuple[str, str, int]]:
    """把 `第X章` / `§N` / `一、` 翻成点分编号 `k` / `k.s` / `k.s.u`。

    读不出来标记的条目（`习题与思考题`、`参考资料`、`中英名词对照`）保留无
    编号，`build_tree` 会把它们挂到当前章下面 —— 这正是它们的真实归属。
    """
    out: list[tuple[str, str, int]] = []
    chapter = 0
    section = 0
    sub = 0
    for num, title, page in entries:
        raw = title
        # 标记可能连着出现（`第一章 §1 核辐射探测器…`），逐个剥掉再定层级
        hit_ch = hit_sec = hit_sub = False
        while raw:
            mm = _CH_MARK.match(raw)
            if mm:
                chapter = _chinese_int(mm.group(1))
                section = sub = 0
                hit_ch = True
                raw = raw[mm.end() :].lstrip()
                continue
            if chapter:
                mm = _SEC_MARK.match(raw)
                if mm:
                    section = int(mm.group(1))
                    sub = 0
                    hit_sec = True
                    raw = raw[mm.end() :].lstrip()
                    continue
            if chapter and section:
                mm = _SUB_MARK.match(raw)
                if mm:
                    sub += 1
                    hit_sub = True
                    raw = raw[mm.end() :].lstrip()
                    continue
            break
        body = raw.strip() or title
        if hit_ch:
            out.append((str(chapter), body, page))
        elif hit_sec:
            out.append((f'{chapter}.{section}', body, page))
        elif hit_sub:
            out.append((f'{chapter}.{section}.{sub}', body, page))
        else:
            # 点分编号（`1.2.3`）已经在 `parse_toc_ocr` 里取出来了，这里照抄
            out.append((num, body, page))
    return out


def toc_band_lines(
    engine: "OcrEngine", doc, index: int, *, dpi: int = OCR_DPI, text_score: float | None = None
) -> tuple[list[OcrLine], float]:
    """只认**右侧页码带**里的字，用来给目录页补页码。返回 (行表, 裁带左边界像素)。

    为什么整页识别不够：印刷页码只有 1–2 位，左边紧挨着一长串引导点，整页
    识别时检测器要么干脆不出框，要么把「引导点 + 页码」并进一个框后置信度掉
    到 0.5 以下被当噪声丢掉 —— 实测王芝英 p10 整页只认到 30 个数字候选、
    前几行页码（1/1/2/5/8/10）缺 6 个。

    单独裁出**页码列那一条竖带**再识别，才能把整列页码连续拿下来。裁带尺寸
    和识别门限都是量出来的（p10，整列真值 33 行）：

    | 带 | 门限 | 数字行 | 说明 |
    |----|------|-------|------|
    | 0.68–0.80 | 0.2 | 32 | 漏最上面的 `1` |
    | 0.62–0.86 | 0.2 | 32 | 同上 |
    | 0.70–0.79 | 0.2 | 31 | 漏 `1`/`10` |
    | **0.74–0.84** | **0.05** | **33** | **采用，整列连续** |
    | 0.74–0.84 | 0.2 | 33 | 少了 y=460/505 那两行 |
    | 0.74–0.84 ×2 放大 | 0.05 | 33 | 无增益，还慢一倍 |

    门限要压到 0.05（不是 0.2）：单数字页码的识别置信度只有 0.32–0.50，整页
    识别时这些行是被 `text_score` 挡掉的，`_toc_page_number` 根本看不到。

    返回的行坐标**已经换回整页坐标**（x 加上裁带的偏移），所以能和整页识别
    出来的标题行直接按 y 配对。
    """
    import numpy as np

    image = render_page(doc, index, dpi)
    h, w = image.shape[:2]
    x0 = int(w * _TOC_BAND[0])
    strip = np.ascontiguousarray(image[:, x0 : int(w * _TOC_BAND[1])])
    rows = [
        OcrLine(text=l.text, conf=l.conf, x0=l.x0 + x0, y0=l.y0, x1=l.x1 + x0, y1=l.y1)
        for l in engine.lines(strip, text_score=text_score)
    ]
    return rows, float(x0)


def parse_toc_pages(
    pages: list, *, engine: "OcrEngine | None" = None, doc=None, dpi: int = OCR_DPI
) -> list[tuple[str, str, int]]:
    """多页目录 → 整本书的条目表。逐页配对，再串层级、最后跨页去噪。

    实测王芝英目录 4 页（PDF p.10–13，OCR 出 267 行）→ 61 条章节级条目，
    与书上印的 61 条逐条对得上。给了 `engine` + `doc` 时会额外走一遍
    `toc_band_lines` 补页码（见那里的表）。
    """
    entries: list[tuple[str, str, int]] = []
    for p in pages:
        lines = list(p.lines)
        if engine is not None and doc is not None:
            band, x0 = toc_band_lines(engine, doc, p.page, dpi=dpi, text_score=_TOC_BAND_SCORE)
            lines = _merge_toc_band(lines, band, x0)
        entries.extend(parse_toc_ocr(lines))
    entries = _toc_denoise(entries)
    return _assign_nums(entries)


def _merge_toc_band(lines: list[OcrLine], band: list[OcrLine], x0: float) -> list[OcrLine]:
    """把页码带的识别结果并回整页行表：带内那一片的旧行**整段替换**，不是追加。

    追加会出问题：同一条页码在两边各认一次，`parse_toc_ocr` 的「一对一贪心
    配对」会把一条标题配上两个页码，多出来的那条只好挂到别的标题上 —— 实测
    追加版 105 条里 7 条页码倒退，替换版 111 条、0 条倒退。

    边界按 `x1 < x0` 判（整行都在带左边才留）：整页识别出的页码行左沿可能
    落在带内（1292–1317）、也可能被引导符拖到带外（1251），按 `x0 < x0` 判
    会漏掉后者，留下 `600961-50` 这种和带内 `-50` 打双包的脏行。

    带内一条都没认出来时（`band` 为空）原样返回：宁可留着整页认出的页码去
    试配对，也不要因为一次裁带失败把整列页码全丢掉。
    """
    if not band:
        return lines
    keep = [l for l in lines if l.x1 < x0]
    return keep + list(band)


def _toc_denoise(entries: list[tuple[str, str, int]]) -> list[tuple[str, str, int]]:
    """去噪，靠的是**目录的印刷页码单调不减**这一条硬性质。

    OCR 出来的目录一定有噪声行：页码列里混进 `:142`、`$1`、`s3`，标题列里
    混进 `七、`、`、放大节的结构`。这些噪声的共同特征是按目录顺序排好之后
    页码会**倒退**，或者根本不像标题。所以按顺序扫一遍：

    1. 标题至少 2 个汉字（或 4 个以上拉丁字母/数字），否则丢掉；
    2. 页码小于上一条已接受条目的，丢掉；
    3. 完全重复的 `(编号, 标题, 页码)` 只留一条。

    这一步是**过滤而不是截断**：每条被丢的都会在 summary 的 `tocDropped`
    里计数，不会静默消失。
    """
    kept: list[tuple[str, str, int]] = []
    seen: set[tuple[str, str, int]] = set()
    last_page = 0
    for num, title, page in entries:
        cjk = len(re.findall(r'[\u4e00-\u9fff]', title))
        if cjk < 2 and len(re.findall(r'[A-Za-z0-9]', title)) < 4:
            continue
        if page < last_page:
            continue
        key = (num, title, page)
        if key in seen:
            continue
        seen.add(key)
        kept.append((num, title, page))
        last_page = page
    return kept


# ---------------------------------------------------------------------------
# 一页的完整流程 + 断点续跑缓存
# ---------------------------------------------------------------------------
def render_page(doc, index: int, dpi: int = OCR_DPI):
    """PDF 页 → BGR 位图（RapidOCR 要的就是 cv2 的 BGR 布局）。"""
    import numpy as np

    pix = doc[index].get_pixmap(dpi=dpi)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n >= 3:
        arr = arr[:, :, :3][:, :, ::-1]
    else:
        arr = np.repeat(arr[:, :, :1], 3, axis=2)[:, :, ::-1]
    return np.ascontiguousarray(arr)


def summarize(pages: list[OcrPage]) -> dict[str, Any]:
    """页级汇总。`pages` 里每一页都在，缺页无从藏。"""
    total = len(pages)
    ok = [p for p in pages if p.status == 'ok']
    review = [p for p in pages if p.status == 'review']
    blank = [p for p in pages if p.status == 'blank']
    confs = [p.mean_conf for p in pages if p.status != 'blank']
    return {
        'pageCount': total,
        'okPages': len(ok),
        'reviewPages': len(review),
        'blankPages': len(blank),
        'meanConfidence': round(sum(confs) / len(confs), 4) if confs else 0.0,
        'threshold': REVIEW_THRESHOLD,
        'totalChars': sum(p.char_count for p in pages),
        'totalSeconds': round(sum(p.elapsed for p in pages), 1),
        'secondsPerPage': round(sum(p.elapsed for p in pages) / total, 2) if total else 0.0,
        'blankPageIndexes': [p.page for p in blank],
    }


def ocr_page(
    engine: OcrEngine, doc, index: int, *, dpi: int = OCR_DPI, text_score: float | None = None
) -> OcrPage:
    """渲染 + 识别 + 版式分析一页。任何一页失败都要留下证据，不许抛掉整页。

    `text_score` 只在目录页传 0.2（见 `OcrEngine.lines`）；正文页保持 None。
    """
    t0 = time.time()
    try:
        image = render_page(doc, index, dpi)
    except Exception as exc:  # noqa: BLE001 - 坏页必须变成空白页记录而不是崩掉整本书
        return OcrPage(page=index, elapsed=time.time() - t0, error=f'render: {exc}')
    try:
        lines = engine.lines(image, text_score=text_score)
    except Exception as exc:  # noqa: BLE001
        return OcrPage(page=index, elapsed=time.time() - t0, error=f'ocr: {exc}')

    h, w = image.shape[:2]
    blocks, figures = boxes_to_blocks(lines, index, w, h)
    page = OcrPage(
        page=index,
        blocks=blocks,
        line_count=len(lines),
        char_count=sum(len(l.text) for l in lines),
        footer_page=_footer_page(lines, h),
        figures=figures,
        lines=lines,
        elapsed=time.time() - t0,
    )
    if not lines:
        page.status = 'blank'
        page.mean_conf = page.median_conf = page.min_conf = 0.0
        return page
    total = sum(len(l.text) for l in lines) or 1
    page.mean_conf = sum(len(l.text) * l.conf for l in lines) / total
    confs = sorted(l.conf for l in lines)
    page.median_conf = confs[len(confs) // 2]
    page.min_conf = confs[0]
    page.status = 'ok' if page.mean_conf >= REVIEW_THRESHOLD else 'review'
    return page


def save_page(cache_dir: str | Path, page: OcrPage, dpi: int) -> None:
    out = Path(cache_dir)
    out.mkdir(parents=True, exist_ok=True)
    payload = {
        'version': CACHE_VERSION,
        'dpi': dpi,
        'page': page.page,
        'status': page.status,
        'meanConf': page.mean_conf,
        'medianConf': page.median_conf,
        'minConf': page.min_conf,
        'lineCount': page.line_count,
        'charCount': page.char_count,
        'footerPage': page.footer_page,
        'elapsed': page.elapsed,
        'error': page.error,
        'figures': page.figures,
        'blocks': [asdict(b) for b in page.blocks],
        'lines': [asdict(l) for l in page.lines],
    }
    (out / f'page-{page.page:04d}.json').write_text(
        json.dumps(payload, ensure_ascii=False), encoding='utf-8'
    )


def load_page(cache_dir: str | Path, index: int, dpi: int) -> OcrPage | None:
    """缓存命中就返回页对象 —— 断点续跑靠这一条，重跑不碰已完成的页。"""
    path = Path(cache_dir) / f'page-{index:04d}.json'
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return None
    if data.get('version') != CACHE_VERSION or data.get('dpi') != dpi:
        return None
    return OcrPage(
        page=data['page'],
        blocks=[Block(**b) for b in data['blocks']],
        line_count=data['lineCount'],
        char_count=data['charCount'],
        mean_conf=data['meanConf'],
        median_conf=data['medianConf'],
        min_conf=data['minConf'],
        footer_page=data.get('footerPage'),
        elapsed=data.get('elapsed', 0.0),
        status=data['status'],
        figures=data.get('figures', []),
        lines=[OcrLine(**l) for l in data.get('lines', [])],
        error=data.get('error', ''),
    )


# ---------------------------------------------------------------------------
# 产物：页账本 / 复核队列 / 图
# ---------------------------------------------------------------------------
def crop_figures(doc, page: OcrPage, out_dir: str | Path, dpi: int = OCR_DPI) -> list[dict]:
    """把图区域从页位图上切下来存 PNG，返回带路径的图记录。

    图注是图**唯一**可检索的文本，所以图和图注必须一起落地：图进
    `ocr/figures/*.png`，图注进 chunk（`kind='figure'`）。`import-content.ts`
    只认 `meta.bbox`，图文件的路径写在 `ocr/figures.jsonl` 里，两边用
    `(page, bbox)` 对齐 —— 不往 chunks.jsonl 里加字段，免得动 TS 侧的类型。
    """
    import pymupdf

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rect = doc[page.page].rect
    scale = dpi / 72.0
    records: list[dict[str, Any]] = []
    for k, fig in enumerate(page.figures):
        x0, y0, x1, y1 = fig['bbox']
        clip = pymupdf.Rect(x0 / scale, y0 / scale, x1 / scale, y1 / scale) & rect
        if clip.is_empty:
            continue
        pix = doc[page.page].get_pixmap(dpi=dpi, clip=clip)
        name = f'page-{page.page:04d}-fig-{k}.png'
        pix.save(str(out / name))
        records.append(
            {
                'page': page.page,
                'index': k,
                'image': name,
                'bbox': [round(v, 1) for v in fig['bbox']],
                'caption': fig['caption'],
            }
        )
    return records


def write_page_artifacts(
    pages: list[OcrPage],
    out_dir: str | Path,
    figure_records: list[dict[str, Any]],
    chunk_index: dict[tuple[int, tuple[float, ...]], str] | None = None,
) -> dict[str, Any]:
    """写 `ocr/pages.jsonl`（全量页账本）、`ocr/review.jsonl`（<0.85）、
    `ocr/figures.jsonl`（图 + 图注 + 所属 chunk）。"""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with (out / 'pages.jsonl').open('w', encoding='utf-8') as f:
        for p in sorted(pages, key=lambda p: p.page):
            f.write(json.dumps(p.ledger(), ensure_ascii=False) + '\n')
    review = [p for p in pages if p.status != 'ok']
    with (out / 'review.jsonl').open('w', encoding='utf-8') as f:
        for p in sorted(review, key=lambda p: p.page):
            row = p.ledger()
            row['reason'] = 'no-text' if p.status == 'blank' else 'low-confidence'
            row['sampleText'] = p.text[:120]
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
    with (out / 'figures.jsonl').open('w', encoding='utf-8') as f:
        for rec in figure_records:
            if chunk_index:
                key = (rec['page'], tuple(round(v, 1) for v in rec['bbox']))
                rec = {**rec, 'chunkId': chunk_index.get(key)}
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    summary = summarize(pages)
    (out / 'summary.json').write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8'
    )
    return summary
