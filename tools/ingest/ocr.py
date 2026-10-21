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

# 低于这个页级置信度就进人工复核队列（票 17 的硬指标，是下限不是建议值）
REVIEW_THRESHOLD = 0.85
# 复核页占比的标定目标：按当前识别模型的实际分布，让 reviewPages 落在
# 总页数的 10–20%（取第 15 百分位作阈值）。票面的 0.85 是硬下限，
# 实际阈值取 max(0.85, p15) —— 见 `choose_review_threshold`。
REVIEW_QUANTILE = 0.15
# 工作点：200 dpi。实测依据见模块 docstring
OCR_DPI = 200
# 缓存格式版本，改了版式规则就 +1，旧缓存自动失效
CACHE_VERSION = 4
# 版式分析版本。**和 CACHE_VERSION 分开**：CACHE_VERSION 一 +1，5000 页缓存
# 全部失效、要重跑 9 小时的识别；而改 `boxes_to_blocks` 只需要重算版式 ——
# 原始行（`lines`）在缓存里，10ms/页就能重算出块。所以版式规则改动只 +1
# 这个数：`load_page` 发现缓存里的 layout 比当前旧，就把对象标成
# `layout_stale`，由 `ocr_run._ocr_range` 就地重算版式并回写缓存。
#
# 版本史：1 = 表格恒为 0 的旧版式；2 = 表题锚定；3 = 表题同行合并（重叠框）、
# 软/硬边界、右栏表与左栏正文分栏（见 `_tables_from_rows`）；4 = 表格区域
# 逐格分栏（`_cells_of_table`），双栏页里同高的左栏正文不再被表格吞掉；
# 5 = 表题行只标记表题本格为已用（不是整行），并排的第二张表题注不被吞。
LAYOUT_VERSION = 5

RAPIDOCR_SITE = Path(
    'C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime'
)

# 识别模型换 PP-OCRv4，检测与方向分类仍用 v3。
#
# 为什么只换识别：v3 的形近误识在真实扫描件上到了「明显错字」的程度
# （实测王芝英 p20/p48/p90：`干扰`→`干犹`、`屏蔽`→`屏藏`、`接入`→`接患`、
# `放大倍数`→`放大熟`、`A(ω)=KB*(ω)`→`A(の)二KB*()`、`表1.2`→`裘1.3`），
# 票 17 的验收写的是「无明显错字」，用 v3 交付等于把一个已知不达标的产物写进
# 图谱。同一批 8 页换 v4 识别器后：平均置信度 0.8732 → 0.9181，13 个错字
# token 全部消失，速度 2.68 → 2.29 s/页（不劣化）。
# 不换检测器的理由：v4 det 没有可测的收益，而检测框一变，版面分析、图表
# 切分、目录配对全都要重验。
# 不换分类器的理由：方向分类只判 0°/180°，v3 的 mobile cls 够用。
#
# 字典兼容性已核对：v3 与 v4 的 `character` 元数据**逐字节相同**（都是
# 6623 个字符），所以 CTC 后处理与 `ppocr_keys_v1.txt` 都不用动。
_V4_REC = Path(__file__).parent / 'models' / 'ch_PP-OCRv4_rec_infer.onnx'

_MODEL_FILES = (
    ('text_detector', 'ch_PP-OCRv3_det_infer.onnx'),
    ('text_cls', 'ch_ppocr_mobile_v2.0_cls_infer.onnx'),
    ('text_recognizer', 'ch_PP-OCRv4_rec_infer.onnx'),
)


# ---------------------------------------------------------------------------
# 引擎
# ---------------------------------------------------------------------------
class OcrSessionError(RuntimeError):
    """OCR 引擎起不来（缺包 / 缺模型 / 显卡不可用）。带上怎么修的信息再抛。"""


def _read_onnx_meta(model_path: str | Path) -> dict | None:
    """读 ONNX 自带的 metadata map（识别模型的 CTC 字典在 `character` 里）。

    走 onnxruntime 而不是 OpenVINO：OpenVINO 的 `rt_info` 只暴露 `framework`，
    拿不到自定义键。这一步只建 session 读元数据、不推理，开销可以忽略。
    """
    try:
        import onnxruntime as ort

        sess = ort.InferenceSession(str(model_path), providers=['CPUExecutionProvider'])
        return dict(sess.get_modelmeta().custom_metadata_map)
    except Exception:  # noqa: BLE001 - 读不到就让调用方回退
        return None


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
        rec: str = 'v4',
        **rapidocr_kwargs: Any,
    ):
        import sys

        site = Path(site)
        if not site.is_dir():
            raise OcrSessionError(
                f'找不到 rapidocr_onnxruntime 安装目录：{site}\n'
                '  这是本机 scoop Python 的位置，换机器时用 --rapidocr-site 指定，'
                '或 pip install rapidocr_onnxruntime'
            )
        if str(site) not in sys.path:
            sys.path.insert(0, str(site))
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError as exc:  # pragma: no cover - 依赖缺失才走
            raise OcrSessionError(
                f'导入 rapidocr_onnxruntime 失败（{site}）：{exc}\n'
                '  pip install rapidocr_onnxruntime'
            ) from exc

        self._engine = RapidOCR(**rapidocr_kwargs)
        models = site / 'models'

        # 识别模型默认用仓库内的 PP-OCRv4；`rec='v3'` 可显式退回 RapidOCR
        # 自带的 v3（换型期间做「只重算目录与归属」的重跑时要用，否则那几本
        # 书的页结果会变成 v4 而其余书还是 v3，出现半天一半新的中间态）。
        # v4 文件缺失时也回退 v3，但必须明确警告 —— 静默回退会让「已经换型」
        # 的结论变成假的。
        if rec not in ('v3', 'v4'):
            raise OcrSessionError(f'rec 只能是 v3 或 v4，收到 {rec!r}')
        if rec == 'v4' and not _V4_REC.is_file():
            print(
                f'⚠ 找不到 PP-OCRv4 识别模型 {_V4_REC}，回退到 v3；'
                '错字率会回到 0.87 置信度那档',
                flush=True,
            )
            rec = 'v3'
        rec_path = _V4_REC if rec == 'v4' else models / 'ch_PP-OCRv3_rec_infer.onnx'
        paths = {
            'text_detector': models / 'ch_PP-OCRv3_det_infer.onnx',
            'text_cls': models / 'ch_ppocr_mobile_v2.0_cls_infer.onnx',
            'text_recognizer': rec_path,
        }

        # CTC 字典从**实际要跑的识别模型**里读：v3 与 v4 的 character 元数据
        # 逐字节相同（都是 6623 个字符，已用 `.scratch/t17/probe_dicts.py` 核对），
        # 但按「模型自带字典」读才不会在将来换模型时配错表。
        meta = _read_onnx_meta(paths['text_recognizer'])
        if meta is None:  # pragma: no cover - onnxruntime 缺失才走
            meta = self._engine.text_recognizer.session.session.get_modelmeta().custom_metadata_map
        for attr, _fname in _MODEL_FILES:
            module = getattr(self._engine, attr)
            model_path = paths[attr]
            try:
                module.session = OVSession(str(model_path), device, meta)
            except Exception as exc:  # pragma: no cover - 取决于本机 OpenVINO
                raise OcrSessionError(
                    f'OpenVINO 编译 {model_path.name} 到 {device} 失败：{exc}\n'
                    '  pip install openvino==2026.4.1；GPU 不可用时用 --device CPU'
                ) from exc
        self.rec_model = rec_path.name
        self.rec = rec
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
    # 缓存里的版式比当前 LAYOUT_VERSION 旧 —— 行是对的，块要重算。
    # 不是持久字段（save_page 不写它），只是 `load_page` 的一次性标记。
    layout_stale: bool = False

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


# ---------------------------------------------------------------------------
# 表格：表题锚定 + 几何列聚类
# ---------------------------------------------------------------------------
#
# 扫描件的表格是**逐格独立 OCR 行**：一个格子一行，一行只有一个格子。
# 原先「一行按 ≥2 空格切成 ≥3 列」的判据在 5800 页里命中 0 次 —— 没有哪一行
# 有 3 列 —— 所以 11 本扫描书的 table 块恒为 0，票 17 的「表格」验收过不去。
#
# 改成两个可靠得多的信号：
#   1. **表题是锚点**：`表1.3 线性响应指标` 这类行在扫描件里识别得很稳；
#      从它下面开始向下收区域，碰到下一张表/图注/标题/正文行就停。
#   2. **列是几何量**：同一列的格子 x0 几乎相等，把区域里所有格子的 x0
#      聚成列心，每个格子归到最近的列心 —— 不依赖任何空格。
#
# 表题里出现的 `裘` 是 v3 时代实测到的**确定性**误识（`表1.2`→`裘1.3`），
# 按已知错字枚举，不做模糊匹配。
_TABLE_CAPTION = re.compile(r'^[表裘]\s*\d+(?:[.\-．]\d+)*')
_CHAPTER_HEAD = re.compile(r'^第\s*[一二三四五六七八九十百零\d]+\s*[章节]')
_NUMBERED_HEAD = re.compile(r'^\d{1,2}\s*[.、．]\s*[\u4e00-\u9fff]')
_ONLY_PAGE_NO = re.compile(r'^[·•\-. ]*\d{1,4}[·•\-. ]*$')

TABLE_COL_TOL = 0.03  # 列心容差 = 页宽 × 3%


def _group_rows(lines: list[OcrLine], tol: float | None = None) -> list[list[int]]:
    """按 y0 把行聚成视觉行，返回每行内的行下标（按 x0 排序）。

    和 `_reading_order` 同一套聚类，但保留行边界 —— 表格要靠「一行几个格子」
    来判断，摊平成一串就丢了这件事。
    """
    if not lines:
        return []
    hs = sorted(ln.h for ln in lines)
    med = hs[len(hs) // 2]
    tol = max(med * 0.5, 6.0) if tol is None else tol
    rows: list[list[int]] = []
    for i in sorted(range(len(lines)), key=lambda k: (lines[k].y0, lines[k].x0)):
        if rows:
            center = sum(lines[k].y0 for k in rows[-1]) / len(rows[-1])
            if abs(lines[i].y0 - center) <= tol:
                rows[-1].append(i)
                continue
        rows.append([i])
    return [sorted(r, key=lambda k: lines[k].x0) for r in rows]


def _row_text(row: list[int], lines: list[OcrLine]) -> str:
    return ' '.join(lines[k].text.strip() for k in row).strip()


def _caption_line(row: list[int], lines: list[OcrLine]) -> int | None:
    """行内的表题行下标。

    不能只看整行拼接后的文本：王芝英 p30 的 `表1.5常用脉冲信号的傅氏变换和
    拉氏变换` 与左侧一个公式行 y0 相差不到半个行高，聚成同一视觉行后行首
    变成了 `h(t) =h (t) *h2(t) *h3 (t) 表1.5…`，整行匹配永远失败。

    也不能只要行首是 `表N` 就算：汤彬 p17 的正文句正好以 `表1.3计算了部分
    核素的比结合能，…` 开头（长到 40+ 字）。表题是**短行**，正文是宽行。

    同一个视觉行里有**多个**表题时只认第一个（不认就整页没表）：阎石 p88 是
    两张表并排 —— `表3.2.1 | 图3.2.5所示电路的逻辑电平 | 表3.2.2 | 图3.2.5
    所示电路的真值表`，后面 5 行数据表是两张表共用的（6 列就是两张 3 列表
    并排）。此时矩阵会把两张表合成一张宽表，这是合理的表示；但不能把第二
    张表的题注行一起吞掉（它在 `_caption_text` 里因以 `图N` 开头被排除，若也
    标记为已用就会**静默丢字**），所以 `_tables_from_rows` 只把第一行的表题
    标记为已用，其余格子留给正文。
    """
    for k in row:
        if _TABLE_CAPTION.match(lines[k].text.strip()) and len(lines[k].text.strip()) <= 60:
            return k
    return None


def _caption_text(row: list[int], lines: list[OcrLine], at: int) -> str:
    """表题文本 = 表题行 + 同行里它右侧的短行（`表1.3` + `线性响应指标`）。

    左右两个框**会重叠**：王芝英 p20 的 `表1.3` 右沿 867、`线性响应指标`
    左沿 850，差 17px。要求严格右置会把表名丢掉，只留下一个搜不到的
    `表1.3`。容差取 0.02 页宽（这里没用页宽参数，直接用 24px）。
    """
    parts = [lines[at].text.strip()]
    for k in row:
        if k == at:
            continue
        ln = lines[k]
        t = ln.text.strip()
        if _TABLE_CAPTION.match(t):
            # 同行里还有第二个表题（两张表并排）—— 那是**另一张**表的题注，
            # 拼进来会让它不再作为独立块出现，搜 `表3.2.2` 就搜不到。
            continue
        if ln.x0 > lines[at].x1 - 24 and ln.x0 > lines[at].x0 and len(t) <= 40 and not _starts_figure(t):
            parts.append(t)
    return ' '.join(parts).strip()


def _row_stop_kind(
    row: list[int], lines: list[OcrLine], page_w: float
) -> str | None:
    """这一行是不是表格区域的边界。

    `hard` = 肯定不是表格行（下一张表 / 图注 / 章节标题 / 正文段落）；
    `soft` = 可能不是：短、带编号、或看起来像页码的**单格行** ——
    它们既可能是表结束后的下一节标题（王芝英 p20 的 `5.稳定性`），
    也可能是表格里面的编号格子（丁洪林 p43 的 `1.微秒级脉冲衰减时间`）。
    只看这一行分不开，要看下一行还在不在表里，所以交给调用方决定。
    """
    t = _row_text(row, lines)
    if not t:
        return 'hard'
    if _caption_line(row, lines) is not None or _starts_figure(t) or _CHAPTER_HEAD.match(t):
        return 'hard'
    if len(row) != 1:
        return None
    ln = lines[row[0]]
    if len(t) <= 6 and _ONLY_PAGE_NO.match(t):
        # 表格里也可能有看起来像页码的格子（王经瑾 p157 的存储地址 `690`）
        return 'soft'
    if _is_body_cell(ln, t, page_w):
        return 'hard'
    if len(t) <= 20 and _NUMBERED_HEAD.match(t):
        return 'soft'
    return None


def _table_continues_after(
    rows: list[list[int]], m: int, lines: list[OcrLine], page_w: float
) -> bool:
    """`m` 的下一非空行还是表格行吗？用来判定 `soft` 行到底算哪边。"""
    for q in range(m + 1, len(rows)):
        if not _row_text(rows[q], lines):
            continue
        return _row_stop_kind(rows[q], lines, page_w) is None
    return False


def _row_beside_table(row: list[int], lines: list[OcrLine], cap_x0: float) -> bool:
    """这一行整行落在表题左侧 —— 它是**另一栏**的正文，不是表的边界。

    丁洪林 p284 的 `表 9.5…` 排在右栏（x782–1281），表体从 y276 开始；
    而左栏正文（x128–749）在 y242 就有一句“分辨率变差十分严重…”。
    不区分列的话，左栏正文会当成表的第一行边界，整张表直接消失。
    """
    return all(lines[k].x1 < cap_x0 - 8 for k in row)


def _cells_of_table(row: list[int], lines: list[OcrLine], cap_x0: float) -> list[int]:
    """这一行里属于表格的格子 —— 去掉整行落在表题左侧的（旁栏正文）。

    只按行走不够：视觉行是**按 y 聚**出来的，双栏页里左栏正文与右栏表格
    的同一行会聚到一起（丁洪林 p230：左栏 `线，其能量至少可高至40keV。`
    y0=836、右栏表头 `能量/eV` y0=831，差 5px）。整行判
    `_row_beside_table` 时因右栏格子存在而不成立，左栏正文就被当表格的一行
    吞掉、不出 chunk。逐格判 `x1 < cap_x0 - 8` 就能把它留在正文里。
    """
    return [k for k in row if lines[k].x1 >= cap_x0 - 8]


def _is_body_cell(ln: OcrLine, text: str, page_w: float) -> bool:
    """这行是不是正文（而不是表格格子）。

    真表格里有长格子（王芝英 p20 的`固能量分辨率为1%，后级线性应为0.1%`
    宽 534px = 31% 页宽、20 字），所以不能只看长度。区别在于位置：

    - 正文行要么**跨过半个页宽**（单栏排版）；
    - 要么**整个人落在左半页**、又宽又长（双栏排版里的左栏正文）——
      王芝英 p30 的表 1.5 排在右栏，左栏正文（148px→862px）与它同高，
      宽度 41% 页宽、17 字，不拦就会被拼成表格的一行。

    而 p20 的长格子右沿到 80% 页宽，不属于上面任一种。
    """
    w = ln.x1 - ln.x0
    if len(text) < 15 or w <= page_w * 0.3:
        return False
    if w > page_w * 0.55:
        return True
    return ln.x1 < page_w * 0.55


def _table_matrix(
    region: list[list[int]], lines: list[OcrLine], page_w: float
) -> list[list[str]] | None:
    """把区域里的格子按 x0 聚成列。列数 <2 说明这不是表，返回 None。"""
    tol = page_w * TABLE_COL_TOL
    xs = sorted({round(lines[k].x0, 1) for row in region for k in row})
    clusters: list[list[float]] = []
    for x in xs:
        if clusters and x - clusters[-1][-1] <= tol:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    centers = [sum(c) / len(c) for c in clusters]
    if len(centers) < 2:
        return None
    matrix: list[list[str]] = []
    for row in region:
        cells = [''] * len(centers)
        for k in row:
            ln = lines[k]
            t = ln.text.strip()
            j = min(range(len(centers)), key=lambda q: abs(ln.x0 - centers[q]))
            cells[j] = f'{cells[j]} {t}'.strip() if cells[j] else t
        matrix.append(cells)
    # 整列为空（通常是页边噪声聚出来的列）→ 删掉，剩不到 2 列就不是表
    keep = [i for i in range(len(centers)) if any(r[i] for r in matrix)]
    if len(keep) < 2:
        return None
    return [[r[i] for i in keep] for r in matrix]


def _tables_from_rows(
    lines: list[OcrLine], rows: list[list[int]], page_w: float
) -> list[tuple[list[int], str, list[list[str]]]]:
    """从视觉行里找表。返回 [(占用的行下标, 表题, 矩阵), …]。"""
    out: list[tuple[list[int], str, list[list[str]]]] = []
    k = 0
    while k < len(rows):
        at = _caption_line(rows[k], lines)
        if at is None:
            k += 1
            continue
        caption = _caption_text(rows[k], lines, at)
        cap_x0 = lines[at].x0
        # 只把表题本行标记为已用（不是整行）：同行里如果还有第二个表题/
        # 别的短行，`_caption_text` 未必收进去（以 `图N` 开头的会被排除），
        # 整行标已用就会让它们静默消失。
        head = [at]
        region: list[list[int]] = []
        end = k + 1
        for m in range(k + 1, len(rows)):
            # 另一栏的行：跳过（不算表格、也不算边界）。同一视觉行里左栏
            # 正文与右栏格子混排时，只取右栏的格子（`_cells_of_table`）。
            cells = _cells_of_table(rows[m], lines, cap_x0)
            if not cells:
                continue
            kind = _row_stop_kind(cells, lines, page_w)
            if kind is None:
                region.append(cells)
                end = m + 1
                continue
            # 短编号行 / 像页码的格子：下一行还在表里就归表，否则就是边界。
            if kind == 'soft' and _table_continues_after(rows, m, lines, page_w):
                region.append(cells)
                end = m + 1
                continue
            break
        matrix = _table_matrix(region, lines, page_w) if len(region) >= 2 else None
        if matrix is None:
            k += 1
            continue
        used_idx = head + [i for r in region for i in r]
        out.append((used_idx, caption, matrix))
        k = end
    return out


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
    3. 表格：`表1.3 xxx` 表题做锚点，向下收区域到下一个表/图注/标题/正文行
       为止；区域内的格子按 x0 聚成列 → `table`，矩阵成为 `rows`，表题留在
       `text`（检索这张表的唯一入口，`chunk.py` 会把它前置到表格文本）。
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

    # --- 3. 表格（表题锚定，先跑：表题行本身可能是短标题，先把格子占住） ---
    rows_of_page = _group_rows(lines)
    for idxs, caption, matrix in _tables_from_rows(lines, rows_of_page, width):
        for k in idxs:
            used[k] = True
        blocks.append(
            Block(
                kind='table',
                page=page,
                bbox=bbox_of([lines[k] for k in idxs]),
                text=caption,
                rows=matrix,
                fill=1.0,
            )
        )

    # --- 1. 标题 ---
    for i, ln in enumerate(lines):
        if used[i]:
            continue
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


# 锚点离全局众数超过这么多页就当成误读丢掉（见 `resolve_page_offsets` docstring）。
_OFFSET_TOL = 40


def resolve_page_offsets(
    pages: list["OcrPage"],
    *,
    fallback: int = 0,
    window: int = 15,
) -> tuple[dict[int, int], dict[str, Any]]:
    """用**每页自己认出的印刷页码**推一个逐页偏移表，而不是全书一个常数。

    为什么不能用常数偏移
    --------------------
    05《核辐射测量原理》实测（464 页里 442 页页脚有页码）：

        pdf 页段        众数偏移
        0–155           14
        160–240         16
        240–300         18 / 20
        320–440         24
        440–        32

    真偏移从 14 一路漂到 32 —— 中间夹了整页图版（pdf 164 只有 6 行字、缩页高
    769pt）和重排版页。用 14 一个常数，pdf 320 之后的 `printed_page` 全部错
    10 页以上，`assign` 按 `printedPage` 分区间就会把整章内容挂错知识点。
    其它书是稳定的（01 王芝英 261/280 页都是 13，02 都是 9，22 都是 16），
    所以这个函数对稳定书退化成常数，对漂移书自动分段。

    做法：先取每页 `pdf_index - printed` 当该页的候选偏移，清洗后对每一页取
    **附近 ±window 页内的众数**（漂移是分段常数，局部投票能吃掉单页误读），
    附近没有任何页码证据时用全书众数。

    页码证据的清洗（四条，都是实测逼出来的）
    ----------------------------------------
    1. **丢掉偏移为负的锚点**。印刷页从 1 开始，`pdf_index - printed < 0` 只可能
       是认错了。18《原子核物理实验方法》96 个页脚命中里有 `(102, 1000)`、
       `(438, 1000)` 这种把表格里的 `1000` 当页码的，算出的偏移是 -562/-898。
    2. **只保留离全局众数 ±40 页以内的锚点**（一个都不剩时退回全部）。同样这本
       书的 `(1, 54)`…`(7, 447)` 是目录页的表格数字，偏移落在 -53…-446，和真实
       偏移 7 差着几百页。
    3. **每页的偏移夹到 `min(offset, pdf_index)`**，保证 `printed_page >= 0`。
       05《核辐射测量原理》pdf 11/12/14 是前言页，邻域众数 14 会把印刷页算成
       -3…-1；夹紧后落到 0（正文前，没有印刷页码）。
    4. **附近没有锚点时用全局众数**，而不是「距离最近的锚点」——最近的那个很
       可能正是噪声页；实测 18 的 pdf 278–291 就是这样被带偏成负页码。

    这四条合起来把 12 本书的负页码从 4–11 页降到 **0 页**，`agree` 基本不变
    （22 那本 552、19 那本 490、24 那本 490），即不牺牲已认对的书，只清噪声。

    返回 `(offsets, report)`；`offsets` 覆盖 `pages` 里每一页。
    """
    known: list[tuple[int, int]] = sorted(
        (p.page, p.page - p.footer_page)
        for p in pages
        if p.footer_page is not None and p.page - p.footer_page >= 0
    )
    report: dict[str, Any] = {
        'pages': len(pages),
        'pagesWithNumber': len(known),
        'globalOffset': fallback,
        'distinctOffsets': 0,
        'drift': 0,
        'window': window,
        'noiseDropped': sum(1 for p in pages if p.footer_page is not None) - len(known),
    }
    if not known:
        return {p.page: fallback for p in pages}, report

    counts: dict[int, int] = {}
    for _, off in known:
        counts[off] = counts.get(off, 0) + 1
    global_offset = max(counts.items(), key=lambda kv: kv[1])[0]
    kept = [(i, o) for i, o in known if abs(o - global_offset) <= _OFFSET_TOL] or known
    report['globalOffset'] = global_offset
    report['noiseDropped'] += len(known) - len(kept)
    report['drift'] = max(o for _, o in kept) - min(o for _, o in kept)

    by_page = sorted(pages, key=lambda p: p.page)
    offsets: dict[int, int] = {}
    voted: list[int] = []
    for p in by_page:
        near = [off for idx, off in kept if abs(idx - p.page) <= window]
        if near:
            c: dict[int, int] = {}
            for off in near:
                c[off] = c.get(off, 0) + 1
            off = max(c.items(), key=lambda kv: kv[1])[0]
        else:
            # 附近没有证据：用全书众数（不用「最近锚点」——最近的那个很可能正是噪声页，
            # 实测 18 的 pdf 278–291 就是这样被带偏成负页码的）。
            off = global_offset
        voted.append(off)
        offsets[p.page] = min(off, p.page) if p.page >= 0 else off
    # `distinctOffsets` 要数**投票结果**，不是夹紧后的值：夹紧只是保证
    # printed_page >= 0 的垓护，开头几页（pdf_index < 偏移）会被夹成 0/1/2…
    # 看上去像漂到了很多段，那本书其实是常数偏移（实测稳定书 200 页夹紧后
    # 声称有 14 种偏移，而真实只有 1 种）。
    report['distinctOffsets'] = len(set(voted))
    return offsets, report


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
    agreement = best[1] / total
    # 证据太弱时不采用众数，返回 0 让调用方报错要求显式 `--page-offset`。
    #
    # 两条门槛都是实测出来的：
    # - **至少 3 次命中**：18《原子核物理实验方法》整本印的是括号页码
    #   `(357)`，页眉页脚带里根本没有页码，抽样只碰到 2 次误读（同一张表格的
    #   `49`），众数偏移算出 **-49**、一致率 0.50 —— 拿它当偏移会让全书每页
    #   的 printed_page 都错 49 页，比「不知道」坏得多。3 次是最低可核验数。
    # - **一致率 ≥ 0.5**：05《核辐射测量原理》真偏移是 14，但页眉里有表格
    #   数字被当成页码，16 次命中里 5 次对、11 次散在不同偏移上（0.31）。
    #   它的众数是对的，可这种「对得多、错得也多」的局面不该自动采用。
    if len(hits) < 3 or agreement < 0.5:
        return 0, agreement, hits
    return best[0], agreement, hits


# ---------------------------------------------------------------------------
# 目录：扫描件的目录页只能 OCR，且不能用 `toc.py` 的那套正则
# ---------------------------------------------------------------------------
# 页码行的样子。除了纯数字，还要容忍**括号页码**：18《原子核物理实验方法》和
# 19《核辐射探测器及其实验技术手册》把页码印在行尾括号里（`(357)`、`(194 )`、
# `（194）`），全角半角混着来，括号内外还常有空格。这两本没有独立的页码列，
# `_band_from_lines` 量不出带子（返回 None），全靠整页识别 + 这一条正则。
_TOC_PAGENO = re.compile(
    r'^[\s.·•●\-—–+*§$⋯…:：]*[(（]?\s*(\d{1,4})\s*[)）]?\s*[\s.·•●:：]*$'
)
_TOC_NUM = re.compile(
    r'^(?:第\s*([一二三四五六七八九十百零\d]+)\s*[章节]'
    r'|([\d]{1,2}(?:\s*\.\s*\d{1,2}){0,2})(?!\d))\s*'
)
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


def _repair_page(raw: str) -> int:
    """页码数字串 → 整数，顺带修「两位数字调序」（`08` 其实是 `80`）。

    **只能在拿到原始字符串的地方做**：`int('08')` 已经是 8，和真值第 8 页在
    数值上完全无法区分，一旦转成 int 就再也修不回来了。

    判据靠印刷事实：页码从不带前导零，所以页码列里以 `0` 开头的两位数一定
    是两位数字被认反了 —— `08`→`80`、`03`→`30`。三位以上不动（`012` 这种
    在 5181 页的教材里不存在，真出现说明这一行不是页码）。

    实测来源：02 王经瑾 p8 的 `11.3.5` 页码列认成 `08`，前后条目是 79 和 82，
    真值 80。不修的话这条 `printed_page` 落到 8，`assign` 会把它挂到第十一章
    以外的知识点上。
    """
    if len(raw) == 2 and raw[0] == '0':
        return int(raw[1] + raw[0])
    return int(raw)


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
    return _repair_page(m.group(1))


_CHAPTER_ONLY = re.compile(r'^第\s*[一二三四五六七八九十百零\d]+\s*[章节篇]\s*$')
# 小节符号独占一行（`§1`，OCR 常认成 `$1` / `s3` / `S4`）。
#
# 尾部必须容忍一个杂点：p10 的 `$1.`（y=1881，`§1` 后面跟着一个小数点残留）
# 原来匹配不上，于是 `第三章 放大器` 那一个节的编号整个丢掉、`section` 停在
# 上一章的 2，连带它下面所有 `三、`/`四、` 子节都拿不到 `3.1.x` —— 实测
# 126 个节点里 63 个没有编号，一半是这一个字符引起的。
_SEC_ONLY = re.compile(r'^[§\$sS]\s*\d{1,2}\s*[.·、,]?\s*$')
# 节号写成 `§1-1`（章-节）的形式，OCR 把 `§` 认成 `8`/`$`/`S` 甚至丢掉。
#
# 25《电路分析基础》李瀚荪上册整本都是 `§1-1``§2-3` 这种编号，OCR 出来是
# `81-1`、`$1-2`、`8 1-11`、`$ 1-10` 四种变体。原来它们既不像章（`第一章`）、
# 也不像小节符号（`§1`），于是掉进标题分支、全书的节号全部丢失 —— 只剩
# `第一篇`/`第一章` 这种章级编号，`kp-1`/`kp-2` 各出两条（篇和章撞 id）。
_DASH_SEC = re.compile(r'^[§\$sS8]?\s*\d{1,2}\s*[-—–]\s*\d{1,2}\s*$')
# 点分编号独占一行（`11.2.2`），标题在右边单独一列。
#
# 02《核电子学》王经瑾上册是这种版式：编号列 x≈100、标题列 x≈203、页码列
# x≈1200，三列各自独立成行（实测 p8 的 115 行里 40 行是页码）。原来只把
# `第X章`/`§N` 当「独占一行的标记」，`11.2.2` 就掉进了标题分支 —— 于是
# `_title_of` 把它当标题正文，配对时按 y 贪心抢到页码，整页变成一堆
# 编号对页码、标题全丢（实测 p8 只出 54 条且标题是 `+1136`/`:1137` 这种
# 噪声）。识别成标记后它就按 y 配到右侧标题上，行为与 `第一章` 一致。
_DOTTED_ONLY = re.compile(
    r'^[\s.·•●\-—–+*:：]*(\d{1,2}(?:\s*\.\s*\d{1,2}){1,2})[\s.·•●]*$'
)
# 章号**独占一行**且只有一个纯数字（康华光模拟部分是这种版式：章号 x≈0.15w、
# 章标题 x≈0.18w、页码 x1≈0.90w 三列）。
#
# 这一行不能当标题：实测书 22 的 `2`（y=3044 x=613-665）会跟右侧 `运算放大器`
# 抢同一个 y 带 —— 它自己配到页码 `22`、而真标题配不到任何页码，于是整本的
# 章行全部消失（`depth==1` 节点数 **0**，导入直接被 拦）。也不能当页码：
# 它在章号列，不在页码列。所以单独识别成「章号标记」，交给 `_CH_AUTO` 顺次编号。
_BARE_CH = re.compile(r'^\d{1,2}$')
# 不编号的前置内容。这类标题前面那个裸数字不可信（实测书 22 `1 绪论` 的 `1`
# 被 OCR 认成 `7`，采用后凭空多出一个「第七章 绪论」）。
_PRE_CHAPTER = re.compile(r'^\s*(绪论|前言|序言|导言|目录|内容简介|出版说明)')


def _is_standalone_marker(text: str) -> bool:
    """这一行是不是「只有编号、没有标题」的标记行。"""
    t = text.strip()
    return bool(
        _CHAPTER_ONLY.match(t)
        or _SEC_ONLY.match(t)
        or _DOTTED_ONLY.match(t)
        or _DASH_SEC.match(t)
    )


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
    markers = [(ln, t) for ln, t in titles if _is_standalone_marker(t)]
    # 章号独占一列且只有一个纯数字（康华光模拟部分）：它不是标题、也不是页码，
    # 而是「第二章」被拆出来的那个 `2`。回收成标记后由 `_title_of` 拼成
    # `第2章` 交给 `_assign_nums`。上限卡 30：目录左列里被误读成数字的噪声
    # （`83`、`44`）不会是章号，加个上限就自动挡掉。
    markers += [(ln, t) for ln, t in titles if _BARE_CH.match(t) and int(t) <= 30]
    keep = [
        i
        for i, (_, t) in enumerate(titles)
        if not _is_standalone_marker(t)
        and not (_BARE_CH.match(t) and int(t) <= 30)
    ]
    titles = [titles[i] for i in keep]
    title_line = [title_line[i] for i in keep]
    prefix: dict[int, list[tuple[float, str]]] = {}
    for mln, mt in markers:
        # 标题只要从标记的左沿右边开始就算配上（`tln.x0 > mln.x0`），不能要求
        # 越过标记的**右沿**：实测书 22 p16 的章号 `11`（x=614-830）比它的
        # 标题（x=810-2181）右沿还宽，`tln.x0 > mln.x1` 是 810 > 830 = False，
        # 于是「第十一章」整条丢掉。
        cand = [(abs(tln.y0 - mln.y0), i) for i, (tln, _) in enumerate(titles) if tln.x0 > mln.x0]
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
            # 章号/节号独占一行时按 y 距离配到标题上，多个标记按纵向顺序拼。
            #
            # 标记本身要按类型分开处理：`第X章`/`§N` 原样拼回标题串，让
            # `_assign_nums` 看到并翻译；点分编号（`11.2.2`）直接当 `num`，
            # 它是已经成形的编号，拼进标题反而会被 `_TOC_NUM` 再剥一次。
            marks = sorted(prefix[i])
            dotted = [t for _, t in marks if _DOTTED_ONLY.match(t.strip())]
            # 裸章号只在标题**确实以章名开头**时才采用。`绪论`/`前言`/`序言`/
            # `导言`/`目录` 在书上是不编号的前置内容：实测书 22 的 `1 绪论`
            # 被 OCR 把 `1` 认成 `7`，直接采用会凭空造出「第七章 绪论」。
            bare = [
                t
                for _, t in marks
                if _BARE_CH.match(t.strip()) and not _PRE_CHAPTER.match(raw)
            ]
            words = [
                t for _, t in marks
                if not _DOTTED_ONLY.match(t.strip()) and not _BARE_CH.match(t.strip())
            ]
            if dotted:
                dm = _DOTTED_ONLY.match(dotted[-1].strip())
                if dm and not num:
                    num = dm.group(1)
            words = [f'第{int(t.strip())}章' for t in bare] + words
            if words:
                raw = ' '.join(words) + ' ' + raw
        return re.sub(r'\s+', '', num), re.sub(r'[\s.·…\u2026]+', '', raw).strip('-—_')

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

    # 第三遍：章标题行**右边根本没有页码**时（书上把章号印成大字、页码省略，
    # 或者页码被认成 `工`/`.` 这种噪声）就借下一条的页码。印刷目录的惯例是
    # 「章的起始页 = 它第一节的起始页」，所以下一个条目的页码就是章标题的
    # 页码。不借的话章标题会被整条丢掉 → `_assign_nums` 看不到任何 `第X章`，
    # 后面所有小节都挂不上章（实测王芝英 p10 就这样只编出 22 条号，而书上
    # 有 6 章）。
    #
    # 借页码必须**在排好阅读顺序之后**做：`out` 里现在还是「按 y 距离排序」
    # 的配对顺序，拿它当「下一条」会借到后面很远的页码（实测 `绪论` 借到了
    # 44）。多页场景下顺序错了会连锁借错，所以这里先按行号排好再借。
    matched = {e[0]: e[3] for e in out}
    rows: list[tuple[int, str, str, int]] = []
    for i, (_, _t) in enumerate(titles):
        num, title = _title_of(i)
        if not title:
            continue
        rows.append((title_line[i], num, title, matched.get(title_line[i], 0)))
    rows.sort(key=lambda e: e[0])
    for k in range(len(rows) - 1):
        line_no, num, title, page = rows[k]
        if page:
            continue
        nxt = next((e[3] for e in rows[k + 1 :] if e[3]), 0)
        if nxt:
            rows[k] = (line_no, num, title, nxt)
    out = [r for r in rows if r[3]]
    # 按**目录上的阅读顺序**（= 原始行号）排序，之后才能用「页码单调」去噪
    out.sort(key=lambda e: e[0])
    entries = [(num, title, page) for _, num, title, page in out]
    return _toc_denoise(entries) if denoise else entries


# 这本书（王芝英 1989）的目录层级是 `第X章` / `§N` / `一、二、`，不是
# 康华光那种 `1.1.1`。所以要把三种标记翻译成 `k` / `k.s` / `k.s.u` 才能喂给
# `toc.build_tree`（它按 num 的点分前缀建树）。
_CH_MARK = re.compile(r'^第\s*([一二三四五六七八九十百零\d]+)\s*[章篇]\s*')
# 「第一篇 总论和电阻电路的分析」只是分组，不是知识点。
#
# 不丢的话 `_CH_MARK` 的 `[章篇]` 会把它当章 1，紧接着的「第一章」又置 1，
# 于是出两个 `num='1'` 的节点→撞 id（实测书 25 的 `kp-1`/`kp-2` 重复）。
# 丢掉的代价是篇的起始页没人认领，但篇的页码就等于第一章的页码，不影响 chunk。
_PART_MARK = re.compile(r'^第\s*[一二三四五六七八九十百零\d]+\s*篇\s*')
_SEC_MARK = re.compile(r'^[§\$sS]\s*(\d{1,2})\s*')
_SEC_DASH = re.compile(r'^[§\$sS8]?\s*(\d{1,2})\s*[-—–]\s*(\d{1,2})\s*')
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
    for i, (num, title, page) in enumerate(entries):
        raw = title
        if _PART_MARK.match(raw):
            # 篇只是分组，不是知识点（见 `_PART_MARK` 注释）。
            continue
        # 标记可能连着出现（`第一章 §1 核辐射探测器…`），逐个剥掉再定层级
        hit_ch = hit_sec = hit_sub = False
        while raw:
            mm = _CH_MARK.match(raw)
            if mm:
                n = _chinese_int(mm.group(1))
                # 章号必须递增。不递增的「章号」是 OCR 噪声：实测书 19 把
                # `³He正比计数管` 的上标 `3` 单独认成一行，于是第四章（气体
                # 电离探测器）中间凭空插入一个「第三章 He正比计数管」，`kp-3`
                # 撞 id 变成 `kp-3-2`、还挂在根上。
                if chapter and n <= chapter:
                    break
                chapter = n
                section = sub = 0
                hit_ch = True
                raw = raw[mm.end() :].lstrip()
                continue
            if chapter:
                mm = _SEC_DASH.match(raw)
                if mm:
                    # `§1-1` 形式：第 1 组是章，第 2 组是节。章号对不上就不动，
                    # 免得把标题里的 `2020-01` 这种数字当节号。
                    if int(mm.group(1)) == chapter:
                        section = int(mm.group(2))
                        sub = 0
                        hit_sec = True
                        raw = raw[mm.end() :].lstrip()
                        continue
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
        elif _looks_like_orphan_sub(raw) and chapter and section:
            # 序号被 OCR 吃掉、只剩前导「、」的子节（`、系统的基本组成` 原本
            # 是 `三、系统的基本组成`）。这种行不能落到无编号分支：`build_tree`
            # 只会给它造一个孤立的 `kp-pNN-*` 节点，实测王芝英有 26 个叶子
            # 颗粒无收，其中大半是这类。按「上一个子节 + 1」续号。
            sub += 1
            out.append((f'{chapter}.{section}.{sub}', raw.strip()[1:].strip() or title, page))
        else:
            # 点分编号（`1.2.3`）已经在 `parse_toc_ocr` 里取出来了，这里照抄。
            #
            # 但**纯整数编号**不能无条件接受：`_TOC_NUM` 的点分组是 `{0,2}`，
            # 所以单独一个 `3` 也算编号。实测书 19 的 `³He正比计数管`（上标³
            # 被 OCR 拆成独立行）就成了 `num='3'`、标题 `He正比计数管`，在第四
            # 章里凭空插一个第三章。章号必须严格递增，不递增就当噪声。
            if num.isdigit() and int(num) <= chapter:
                num = ''
            # 章标题的**章号整个没被检出来**时（实测书 22 第七章「反馈放大电路」
            # p325，它前面根本没有裸数字行），靠「紧跟着的那一条是 `7.1`」反推
            # 章号：只在自己无编号、且**紧邻的下一条**带点分编号时才补，不用
            # 「下一条非空编号」—— 那样 `小结`（下一条是 `习题`）、`习题`
            # （下一条是章标题）也会被误补成章。
            if not num and i + 1 < len(entries):
                nxt = entries[i + 1][0]
                head = nxt.split('.')[0]
                if nxt.count('.') >= 1 and head.isdigit() and int(head) == chapter + 1:
                    chapter = int(head)
                    section = sub = 0
                    out.append((str(chapter), body, page))
                    continue
            out.append((num, body, page))
    return out


_ORPHAN_SUB = re.compile(r'^[、.．，,·]\s*\S')


def _looks_like_orphan_sub(raw: str) -> bool:
    """`、系统的基本组成` 这种「前导标点 + 正文」，是真子节但序号丢了。

    只认**前导顿号紧接汉字**：目录里的噪声行要么是**孤零零一个标点**
    （p10 的 `、`、`，`），要么是别的标点开头。所以要求至少 2 个汉字 ——
    门槛是卡「有没有正文」，不是卡「够不够长」：实测有 `、最佳滤波器的讨论`
    这种真子节，也有 `、戊` 这种短标题，用 3 字门槛会把后者误判成噪声。
    2 个汉字足够挡掉 `、`/`，`/`·`，因为纯标点行一个汉字都没有。
    """
    t = raw.strip()
    if not _ORPHAN_SUB.match(t):
        return False
    return len(re.findall(r'[一-鿿]', t)) >= 2


def _band_from_lines(lines: list[OcrLine], width: float) -> tuple[float, float] | None:
    """从整页识别结果里**量出**页码列在哪，返回 `(左, 右)` 占页宽的比例。

    不能像第一版那样写死 `0.74–0.84`：11 本书量下来页码列的右沿分布很宽 ——
    01 王芝英 0.77w、02 王经瑾 0.76w、05 汤彬 0.95w、06 陈伯显 0.97w、
    07 丁洪林 0.92w。写死的带子只有 01/02 落在里面，其余几本整列页码都裁到
    带外去了（裁带里一条数字都没有，`_merge_toc_band` 又把带右边的真页码全
    删掉，等于把页码列清空）。

    判法和 `parse_toc_ocr` 一致：候选按 x1 聚 40px 桶，取**最密且最靠右**的
    那一桶。标题列里被误读成数字的短行（`83`、`$4`）x1 只有 0.14w 左右，聚
    在不同桶里且稀疏，选不中。
    """
    nums = [ln for ln in lines if _toc_page_number(ln.text) is not None]
    if len(nums) < 2:
        return None
    buckets: dict[int, list[OcrLine]] = {}
    for ln in nums:
        buckets.setdefault(int(ln.x1 // 40), []).append(ln)
    best = max(buckets.values(), key=lambda v: (len(v), max(l.x1 for l in v)))
    col_right = max(ln.x1 for ln in best)
    # 右边界多留 3% 页宽：引导点会把框的左沿拖出去，右沿基本贴着印刷位置
    lo = max(0.0, (col_right - 0.09 * width) / width)
    hi = min(1.0, (col_right + 0.03 * width) / width)
    if hi - lo < 0.04:  # 太窄说明量出来的位置不可信，交给调用方用默认带
        return None
    return lo, hi


def toc_band_lines(
    engine: "OcrEngine",
    doc,
    index: int,
    *,
    dpi: int = OCR_DPI,
    text_score: float | None = None,
    band: tuple[float, float] | None = None,
    lines: list[OcrLine] | None = None,
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

    `band` 不传就用默认的 `_TOC_BAND`；传了就用传进来的（`parse_toc_pages`
    会先用 `_band_from_lines` 从整页结果里量出这本书自己的页码列位置）。
    """
    import numpy as np

    image = render_page(doc, index, dpi)
    h, w = image.shape[:2]
    left, right = band if band is not None else _TOC_BAND
    x0 = int(w * left)
    strip = np.ascontiguousarray(image[:, x0 : int(w * right)])
    rows = [
        OcrLine(text=l.text, conf=l.conf, x0=l.x0 + x0, y0=l.y0, x1=l.x1 + x0, y1=l.y1)
        for l in engine.lines(strip, text_score=text_score)
    ]
    return rows, float(x0)


def _page_width(doc, index: int, dpi: int) -> float:
    """页面渲染成图后的像素宽（页码带按比例裁，得先知道宽）。"""
    return doc[index].rect.width * dpi / 72.0


def parse_toc_pages(
    pages: list,
    *,
    engine: "OcrEngine | None" = None,
    doc=None,
    dpi: int = OCR_DPI,
    max_page: int | None = None,
) -> list[tuple[str, str, int]]:
    """多页目录 → 整本书的条目表。逐页配对，再串层级、最后跨页去噪。

    实测王芝英目录 4 页（PDF p.10–13，OCR 出 267 行）→ 61 条章节级条目，
    与书上印的 61 条逐条对得上。给了 `engine` + `doc` 时会额外走一遍
    `toc_band_lines` 补页码（见那里的表）。

    `max_page` 是全书印刷页数上限。OCR 会把 `189` 读成 `681`，这类超过全书
    页数的页号一定是错的；给了上限就修掉（见 `_clamp_pages`）—— 错误页号比
    缺页号更坏，`assign` 按 `printedPage` 区间挂 chunk，一个 681 会让整章
    无归属。
    """
    entries: list[tuple[str, str, int]] = []
    for p in pages:
        lines = list(p.lines)
        if engine is not None and doc is not None:
            # 先整页认一遍、量出这本书的页码列在哪，再只裁那一条带重认 ——
            # 写死 0.74–0.84 时 05/06/07 的页码列（0.92–0.98w）整个落在带
            # 外，`_merge_toc_band` 会把带右边那一大片真页码当「带内旧行」
            # 删掉，等于把页码列清空。
            width_px = _page_width(doc, p.page, dpi)
            band_range = _band_from_lines(lines, width_px) or _TOC_BAND
            try:
                band, x0 = toc_band_lines(
                    engine, doc, p.page, dpi=dpi, text_score=_TOC_BAND_SCORE, band=band_range
                )
            except Exception:
                band = []
            if band:
                right = x0 + width_px * (band_range[1] - band_range[0])
                lines = _merge_toc_band(lines, band, x0, right)
        entries.extend(parse_toc_ocr(lines))
    entries = _toc_denoise(entries)
    if max_page:
        entries = _clamp_pages(entries, max_page)
    return _assign_nums(entries)


def _clamp_pages(entries: list[tuple[str, str, int]], max_page: int) -> list[tuple[str, str, int]]:
    """把超过全书页数的页号当误认，用前后条目的单调性补一个合理值。

    实测王芝英 p12 把 `第五章 时间分析 …… 189` 认成 `681`（`1`→`6`），而这本
    书只有 345 页。这类跑飞的页号必须修掉：`assign` 按 `printedPage` 区间把
    chunk 挂到知识点上，681 会让第五章往后整段无归属。
    """
    out = list(entries)
    for i, (num, title, page) in enumerate(out):
        if page <= max_page:
            continue
        prev = next((p for _, _, p in reversed(out[:i]) if p <= max_page), None)
        nxt = next((p for _, _, p in out[i + 1 :] if p <= max_page), None)
        fixed = prev if prev is not None else (nxt if nxt is not None else max_page)
        out[i] = (num, title, fixed)
    return out


def _merge_toc_band(
    lines: list[OcrLine], band: list[OcrLine], x0: float, right: float | None = None
) -> list[OcrLine]:
    """把页码带的识别结果并回整页行表：带内那一片的旧行**整段替换**，不是追加。

    追加会出问题：同一条页码在两边各认一次，`parse_toc_ocr` 的「一对一贪心
    配对」会把一条标题配上两个页码，多出来的那条只好挂到别的标题上 —— 实测
    追加版 105 条里 7 条页码倒退，替换版 111 条、0 条倒退。

    边界按 `x1 < x0` 判（整行都在带左边才留）：整页识别出的页码行左沿可能
    落在带内（1292–1317）、也可能被引导符拖到带外（1251），按 `x0 < x0` 判
    会漏掉后者，留下 `600961-50` 这种和带内 `-50` 打双包的脏行。

    **必须也给右边界**（`right`）：给了 `right` 就只替换 `[x0, right]` 这一段
    里的旧行，带右边的行原样保留。自适应带子是按每本书量出来的，不给右边界
    就会把带子右边到页边的所有页码行一起删掉 —— 05/06/07 这几本的页码列本来
    就在 0.92–0.98w，那样正好把整列页码清空。`right` 省略时退回「保留全部
    左侧行」的老行为，兼容单测和固定带子的调用。

    带内一条都没认出来时（`band` 为空）原样返回：宁可留着整页认出的页码去
    试配对，也不要因为一次裁带失败把整列页码全丢掉。
    """
    if not band:
        return lines
    if right is None:
        keep = [l for l in lines if l.x1 < x0]
    else:
        keep = [l for l in lines if l.x1 < x0 or l.x0 > right]
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


def _percentile(values: list[float], q: float) -> float:
    """线性插值分位数（不引 numpy 依赖，样本量最多几千）。"""
    if not values:
        return 0.0
    xs = sorted(values)
    if len(xs) == 1:
        return xs[0]
    pos = q * (len(xs) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def choose_review_threshold(confs: list[float], *, quantile: float = REVIEW_QUANTILE) -> dict[str, Any]:
    """按页级置信度分布定人工复核阈值。返回阈值和它的来历（要写进 summary）。

    票面写死「低于 0.85 进复核」是下限；换识别模型后置信度整体上移，只按 0.85
    筛会让复核队列几乎空掉（实测 v3→v4 后王芝英均值 0.876→约 0.91），那不是
    质量变好而是筛子变粗。所以取 `max(0.85, p15)`：既不会漏标票面要求必标的页，
    又能让复核量稳定在总页数 10–20%。
    """
    if not confs:
        return {
            'threshold': REVIEW_THRESHOLD,
            'ticketThreshold': REVIEW_THRESHOLD,
            'calibrated': None,
            'quantile': quantile,
            'rule': '没有非空页，用票面阈值',
        }
    p = _percentile(confs, quantile)
    used = max(REVIEW_THRESHOLD, round(p, 4))
    return {
        'threshold': used,
        'ticketThreshold': REVIEW_THRESHOLD,
        'calibrated': round(p, 4),
        'quantile': quantile,
        'rule': f'max(票面 {REVIEW_THRESHOLD}, 本模型页级置信度 p{int(quantile * 100)})',
    }


def apply_review_threshold(pages: list[OcrPage], threshold: float) -> int:
    """按给定阈值重算每页状态（`blank` 不动），返回复核页数。

    状态是**派生值**：页缓存在 `mean_conf` 里存了原始置信度，换阈值不需要重跑
    OCR，从缓存重算即可。`ocr_page` 里那次赋值只是单页跑时的占位。
    """
    review = 0
    for p in pages:
        if p.status == 'blank':
            continue
        p.status = 'ok' if p.mean_conf >= threshold else 'review'
        if p.status == 'review':
            review += 1
    return review


def summarize(pages: list[OcrPage], *, threshold_info: dict[str, Any] | None = None) -> dict[str, Any]:
    """页级汇总。`pages` 里每一页都在，缺页无从藏。

    `threshold_info` 来自 `choose_review_threshold`，原样写进 summary ——
    复核阈值是按哪个识别模型的分布算的，必须留在产物里，否则过半年没人知道
    这个数字怎么来的。
    """
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
        'threshold': (threshold_info or {}).get('threshold', REVIEW_THRESHOLD),
        'totalChars': sum(p.char_count for p in pages),
        'totalSeconds': round(sum(p.elapsed for p in pages), 1),
        'secondsPerPage': round(sum(p.elapsed for p in pages) / total, 2) if total else 0.0,
        'blankPageIndexes': [p.page for p in blank],
        'reviewThresholdRule': (threshold_info or {}).get('rule', '票面阈值'),
        'reviewThresholdCalibrated': (threshold_info or {}).get('calibrated'),
        'reviewThresholdQuantile': (threshold_info or {}).get('quantile'),
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


def relayout_page(doc, page: OcrPage, dpi: int = OCR_DPI) -> OcrPage:
    """用缓存里的原始行重算版式，不重跑识别。

    `boxes_to_blocks` 只需要页宽高和行坐标，页宽高能从 PDF 的 rect 直接算出
    来（`rect.width * dpi / 72`，实测三本书与渲染位图相差 0.04%），所以改版式
    规则的代价是每页几毫秒，而不是每页 3 秒的 OCR。
    """
    rect = doc[page.page].rect
    scale = dpi / 72.0
    width, height = rect.width * scale, rect.height * scale
    blocks, figures = boxes_to_blocks(page.lines, page.page, width, height)
    page.blocks = blocks
    page.figures = figures
    page.footer_page = _footer_page(page.lines, height)
    page.layout_stale = False
    return page


def save_page(cache_dir: str | Path, page: OcrPage, dpi: int, rec: str = 'v3') -> None:
    """把一页结果写进缓存。`rec` 是识别模型名，进目录名也进 payload。

    缓存必须按识别模型分开：v3 与 v4 的同一页识别结果不同，共用一个名字会
    让换型后的重跑全部命中旧缓存，输出与换型前一模一样而看不出任何异常。
    """
    out = Path(cache_dir) / rec
    out.mkdir(parents=True, exist_ok=True)
    payload = {
        'version': CACHE_VERSION,
        'layout': LAYOUT_VERSION,
        'dpi': dpi,
        'rec': rec,
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


def load_page(cache_dir: str | Path, index: int, dpi: int, rec: str = 'v3') -> OcrPage | None:
    """缓存命中就返回页对象 —— 断点续跑靠这一条，重跑不碰已完成的页。

    `rec` 参与缓存键（见 `save_page`）：换识别模型后必须重新识别，不能
    复用另一个模型的结果。
    """
    path = Path(cache_dir) / rec / f'page-{index:04d}.json'
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        return None
    if data.get('version') != CACHE_VERSION or data.get('dpi') != dpi:
        return None
    if data.get('rec', 'v3') != rec:
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
        # 老缓存没有 layout 键（= 第 1 版版式：表格恒为 0）。标出来让调用方
        # 用现成的 lines 重算块，不必重跑识别。
        layout_stale=data.get('layout', 1) != LAYOUT_VERSION,
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
    *,
    threshold_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """写 `ocr/pages.jsonl`（全量页账本）、`ocr/review.jsonl`（低于阈值的页）、
    `ocr/figures.jsonl`（图 + 图注 + 所属 chunk）。

    `threshold_info` 见 `choose_review_threshold`，随 summary 一起落盘。
    """
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
    summary = summarize(pages, threshold_info=threshold_info)
    (out / 'summary.json').write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8'
    )
    return summary
