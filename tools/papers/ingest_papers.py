"""票 18 前半：101 篇论文零 OCR 入图。

把 `资源库/papers/` 的 101 个 PDF（全部有文字层，不跑 OCR）变成：

    app.sources           101 行，kind='paper'
    app.modules           10 行（十大主题），tier='C'，ordinal 100 起
    app.knowledge_points  每篇 1 个 depth-0 节点 + N 个叶节点
    app.chunks            每 PDF 页 1 行（约 2800 行）

外加 `content/papers/index.json`（101 条清单，给人看的对账文件）。

## 数据流的三个真源，各管一件事

| 真源 | 管什么 | 为什么不能用别的 |
| --- | --- | --- |
| `资源库/papers/README.md` 的十张表 | 主题、年份、被引、DOI、文件名 | 唯一可信的元数据；`.doi_index.json` 的 `file` 是 GBK 乱码的绝对路径 |
| PDF 自身的文字层 | 完整标题、章节标题、正文 | 表格里的标题被截断（22 条带 `...`） |
| `.doi_index.json` | **只用来交叉核对 DOI → 文件名的映射** | 它的 `file` 字段不可信，但键（DOI）可信 |

## 为什么按 DOI 对齐而不是按文件名

`.doi_index.json` 里 `file` 字段与磁盘上的实际文件名**可以不一致**：
`10.1109/tns.2018.2840160` 在索引里记作 `Dujardin2018_Needs.pdf`，
而磁盘上是 `10.1109_tns.2018.2840160_OpenAlexOA.pdf`。
DOI 是唯一稳定的键 —— 文件名会被人重命名、会被下载器按策略改写，DOI 不会。

脚本因此走「README 表格的 DOI → 磁盘文件名」这条链（README 的 `文件` 列与磁盘
逐一核对过 101/101 一致），再用 `.doi_index.json` 的键集合做一次交叉校验：
两边 DOI 集合必须相等，否则报错退出（防止 README 与索引各说各话）。

## 为什么不做 chunk 切分

一本书要切分是因为一章几十页、检索粒度太粗。**论文页本身就是自然单元**：
一页 3–8K 字符，正好是一个检索单元；再按段落切会让「同一张图的一段推导」
被拆到两个 chunk 里。所以 `app.chunks` 就是「每 PDF 页一行」，`ordinal` = 页序号。

代价：一页里如果同时讲了两个知识点，`micro_kp_id` 只能挂一个（按页内标题命中
的第一个叶节点）。这是刻意的取舍 —— 精确到段需要版面分析，那是 OCR 管线的活，
本票明确零 OCR。

## 三层知识点结构

    论文（depth 0，is_leaf=false）
      ├── 章节（depth 1，is_leaf=false）   ← 只有 outline 有多级时才建
      └── 叶节点（is_leaf=true）            ← 每篇至少 1 个

章节标题来源按优先级：

1. `doc.get_toc()`（PDF 自带 outline）—— 101 篇里只有 **31 篇**有
2. 正文行模式 `^\\d+(\\.\\d+)*\\.?\\s+[A-Z]...` —— 69 篇能识别出至少一个
3. 都没有（1 篇：`Frhwirth1987_Application.pdf`，扫描版式但文字层可读、
   章节标题是居中的罗马数字）→ 整篇作一个叶节点

**叶节点必须有 chunk 挂上去**，否则它在检索里永远搜不到、在图上是个死节点。
所以分配规则是：把 chunk（页）按顺序分给各叶节点，每页归到「它之前最近的那个
章节标题所在的叶节点」。

## 幂等与安全

- 全部 `ON CONFLICT (id) DO UPDATE`，重跑结果一致。
- 旧行清理只碰 `source_id LIKE 'paper-%'` 且 id 也以 `paper-` 开头的行 ——
  **绝不无条件 DELETE `knowledge_points`**（项目里 11 条 CASCADE 指向它）。
- 清理前先核对 `attempts` / `mastery` / `kp_edges` / `levels` / `node_unlocks`
  对本脚本的 id 有没有引用；有引用就拒绝执行并打印引用方。

## 用法

    # 只解析、不写库（先看一遍解析结果对不对）
    python tools/papers/ingest_papers.py --dry-run

    # 写库
    python tools/papers/ingest_papers.py --database-url "$DATABASE_URL"

    # 只重新生成 content/papers/index.json
    python tools/papers/ingest_papers.py --index-only
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

# 仓库根：本文件在 tools/papers/ 下
REPO_ROOT = Path(__file__).resolve().parents[2]
PAPERS_DIR = REPO_ROOT / "资源库" / "papers"
README_PATH = PAPERS_DIR / "README.md"
DOI_INDEX_PATH = PAPERS_DIR / ".doi_index.json"
INDEX_OUT = REPO_ROOT / "content" / "papers" / "index.json"

DEFAULT_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/starmap"

# 1980 年前算「奠基性论文」。README 里最早的是 1959（Brooks 中子/伽马甄别）。
FOUNDATIONAL_CUTOFF_YEAR = 1980

# 章节标题识别的正则。比「以数字开头」严格得多 —— 论文正文里满是
# 「1.5 cm」「2.3 times」这种数值，宽松匹配会识别出几百个假章节。
HEADING_RE = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,2}){0,2})\.?\s+([A-Z][^\n]{1,80})$")

# 句中句号：`. ! ?` 后接空白再接大写字母。`(?<![A-Z])` 排除「单个大写字母 +
# 句号」（罗马数字 `I. Microgrid`、人名缩写 `J. Seeman` 的开头）—— 不排的话
# 参考文献条目的首个缩写会把整条漏过去。
_SENTENCE_BREAK = re.compile(r"(?<![A-Z])[.!?]\s+[\"“]?[A-Z]")

# 参考文献条目：`et al`、期刊缩写、`A. Surname,` 开头、以及**缩写链 + 姓**
# （`W. S. Means and E. R. Harold, XML in a Nutshell…`）。
#
# 最后那条为什么必须单独写：`^[A-Z]\.\s?[A-Z][a-z]+` 只盖得住**一个**缩写，
# 而参考文献里多作者时是 `W. S. Means`、`M. D. Fries` 这种两三个缩写连写，
# 第二个缩写后面跟的是点不是小写字母，于是整条漏过。实测漏了 5 条（全是
# 参考文献条目，0 条真标题被这条新规则命中 —— 已用全量 1059 条章节名验过）。
_REFERENCE_ENTRY = re.compile(
    r"\bet al\b|"
    r"\b(?:Nucl|Phys|Instr|Meth|Proc|IEEE|Trans|Lett|Rev|Commun|Conf|Symp)\.\s|"
    r"^[A-Z]\.\s?[A-Z][a-z]+.*,|"
    r"^(?:[A-Z]\.\s*){2,}[A-Z][a-z]+"
)

# PDF 小型大写字母（small caps）排版伪影：`I NTRODUCTION` 被抽成 `I` + ` ` + `NTRODUCTION`。
# 只负责找出「单个大写字母 + 空格 + 至少两个大写字母」的形状，合并策略见 `merge_small_caps()`。
_SMALL_CAPS = re.compile(r"\b([A-Z]) ([A-Z]{2,})\b")

# 章节标题里不该出现的词。命中说明这是正文里的编号句子，不是标题。
HEADING_BLACKLIST = re.compile(
    r"@|https?://|\bdoi\b|arXiv|JINST|IEEE Trans|Vol\.|No\.|pp\.|ISSN|"
    r"Proceedings|Preprint|Submitted|Received|Corresponding|Tel\.|Fax|"
    r"\bFig\.|\bTable\b|\bEq\.|\bRef\.",
    re.IGNORECASE,
)

# 变音字母丢失的三个文件名 → 正确拼写（写进 title 与 meta，不改文件名）。
# 文件名一旦改，`.doi_index.json` 的映射就断了；而 title 是给人看的。
UMLAUT_FIXES = {
    "Mller1973_Dead.pdf": ("Müller", "Jörg W. Müller"),
    "Frhwirth1987_Application.pdf": ("Frühwirth", "R. Frühwirth"),
    "Kibdi2008_Evaluation.pdf": ("Kibédi", "T. Kibédi"),
}

TOPIC_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]

# 降级命名时不该被当成「第一个实词」的 token。
# `MeV at Ed =` 拆词后 `MeV` 排第一，而它会被译成「MEV」—— 降级命名于是变成
# 「第 3 节 · MEV」，比直接说「原文见摘要」更难读。单位与虚词一律跳过。
_NON_WORD_TOKENS = frozenset(
    {
        "mev", "kev", "gev", "tev", "ev", "kv", "mv", "na", "ua", "ma",
        "ns", "ps", "fs", "um", "nm", "mm", "cm", "the", "and", "for",
        "with", "from", "into", "that", "this", "are", "was", "were", "its",
    }
)

# 十个主题模块的英文 slug（模块 id 用）。ordinal 从 100 起，
# 避开书的章节（现最大 20）。
TOPIC_SLUGS = {
    "A": "gaseous-detectors",
    "B": "silicon-tracking",
    "C": "scintillators",
    "D": "readout-asics",
    "E": "front-end-electronics",
    "F": "radiation-effects",
    "G": "imaging-medical",
    "H": "collider-detectors",
    "I": "simulation-software",
    "J": "spectrometry-nuclear-data",
}


@dataclass
class PaperRow:
    """README 一张表里的一行。"""

    number: int
    year: int
    citations: int
    title: str  # 表格里的（可能截断）
    venue: str
    doi: str
    fileName: str
    topic_letter: str
    topic_name: str


@dataclass
class PaperRecord:
    """解析完一个 PDF 之后的完整记录。"""

    row: PaperRow
    sourceId: str
    title: str  # 补全后的标题
    titleFromPdf: bool
    pageCount: int
    emptyPages: int
    sections: list["SectionRecord"] = field(default_factory=list)
    pageTexts: list[str] = field(default_factory=list)

    @property
    def foundational(self) -> bool:
        return self.row.year <= FOUNDATIONAL_CUTOFF_YEAR

    @property
    def leafCount(self) -> int:
        return sum(1 for s in self.sections if s.isLeaf)


@dataclass
class SectionRecord:
    """一个章节 / 叶节点。"""

    id: str
    name: str
    depth: int
    ordinal: int
    isLeaf: bool
    startPage: int  # 1-based PDF 页
    parentId: str | None


# --------------------------------------------------------------------------
# 1. README 解析
# --------------------------------------------------------------------------


def slug_doi(doi: str) -> str:
    """`10.1016/s0168-9002(96)01172-2` → `10-1016-s0168-9002-96-01172-2`。

    只保留小写字母、数字与连字符；连续非字母数字压成一个连字符。
    """
    s = doi.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def source_id_for(doi: str) -> str:
    return f"paper-{slug_doi(doi)}"


def _merge_wrapped_rows(lines: Sequence[str]) -> list[str]:
    """把跨行的表格行拼回去。

    README 里第 90 行（Mantid）被手工折成两行：标题断在 `and` 后面，
    续行以 11 个空格 + `...` 开头。这种折行只出现在被截断的标题上，
    所以判据是「续行以 `           ...` 开头且上一行是表格行」。
    """
    merged: list[str] = []
    for line in lines:
        if line.startswith("           ...") and merged and merged[-1].startswith("| "):
            merged[-1] = merged[-1].rstrip(" |") + " " + line.strip().lstrip(". ")
        else:
            merged.append(line)
    return merged


ROW_RE = re.compile(
    r"^\|\s*(\d+)\s*\|\s*(\d{4})\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|"
    r"\s*(.+?)\s*\|\s*(.+?)\s*\|\s*`([^`]+\.pdf)`\s*\|$"
)
TOPIC_RE = re.compile(r"^### ([A-J])\.\s*(.+?)\s*$")


def parse_readme(path: Path = README_PATH) -> list[PaperRow]:
    """解析十张分领域表格。返回 101 行，按 README 出现顺序。"""
    lines = _merge_wrapped_rows(path.read_text(encoding="utf-8").splitlines())
    rows: list[PaperRow] = []
    topic_letter: str | None = None
    topic_name: str | None = None

    for line in lines:
        m = TOPIC_RE.match(line)
        if m:
            topic_letter, topic_name = m.group(1), m.group(2).strip()
            continue
        r = ROW_RE.match(line)
        if not r or topic_letter is None or topic_name is None:
            continue
        rows.append(
            PaperRow(
                number=int(r.group(1)),
                year=int(r.group(2)),
                citations=int(r.group(3)),
                title=r.group(4).strip(),
                venue=r.group(5).strip(),
                doi=r.group(6).strip(),
                fileName=r.group(7).strip(),
                topic_letter=topic_letter,
                topic_name=topic_name,
            )
        )

    if len(rows) != 101:
        raise SystemExit(f"README 解析出 {len(rows)} 行，期望 101 —— 表格格式变了？")
    return rows


# --------------------------------------------------------------------------
# 2. 标题补全
# --------------------------------------------------------------------------


def _norm_for_match(text: str) -> str:
    """归一化到「只留小写字母数字与空格」，用于跨连字/破折号/弯引号匹配。

    **顺序很重要**：先 `.lower()` 再做 `[^a-z0-9] → 空格`。
    反过来写会把所有大写字母当非法字符删掉 —— 实测过：
    `The STAR time projection chamber` 会归一成 `he time projection chamber`
    （丢了 `T` 与 `STAR`），于是所有以大写开头的标题都匹配不上，
    101 条里只有 45 条能补全标题。
    """
    text = text.replace("\u00ad", "")  # soft hyphen
    for src, dst in [
        ("\ufb01", "fi"),
        ("\ufb02", "fl"),
        ("\ufb00", "ff"),
        ("\ufb03", "ffi"),
        ("\ufb04", "ffl"),
        ("\u2014", "-"),
        ("\u2013", "-"),
        ("\u2019", "'"),
        ("\u201c", '"'),
        ("\u201d", '"'),
        ("\u2212", "-"),
    ]:
        text = text.replace(src, dst)
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def complete_title(table_title: str, first_page_text: str) -> tuple[str, bool]:
    """用 PDF 首页补全表格里被截断的标题。

    做法：把首页按行切开，按 **1–4 行拼接** 生成候选，找第一个
    「归一化后以表格标题为前缀且更长」的候选。

    为什么是「前缀」而不是「最长的一行」：论文首页的第一行往往是期刊名
    （`NUCLEAR INSTRUMENTS AND METHODS 4 (1959) 151--163`），最长的那一行
    往往是作者列表（Geant4 那篇是 40 个作者挤成的两行）。标题一定是
    「以表格标题开头、且比它长」的那段连续行。

    补不出来就返回原表格标题 + `False`（调用方记 `titleFromPdf: false`）。
    """
    raw = table_title.strip()
    truncated = raw.endswith("...")
    base = raw[:-3].strip() if truncated else raw
    if not base:
        return table_title, False

    nb = _norm_for_match(base)
    if not nb:
        return table_title, False

    lines = [ln.strip() for ln in first_page_text.splitlines() if ln.strip()]

    # 收集所有「以表格标题开头」的窗口。注意要**按 span 从小到大**收集，
    # 因为窗口越长越可能把作者名带进来：
    #   表格标题：`DEAD-TIME PROBLEMS`
    #   首页行：  `DEAD-TIME PROBLEMS` / `JORG W.` / `Bureau International...`
    #   span=1 → `DEAD-TIME PROBLEMS`（正好）
    #   span=2 → `DEAD-TIME PROBLEMS JORG W.`（多了作者）
    candidates: list[str] = []
    for span in (1, 2, 3, 4):
        for i in range(len(lines) - span + 1):
            window = " ".join(lines[i : i + span])
            nw = _norm_for_match(window)
            if nw.startswith(nb):
                candidates.append(window)

    if not candidates:
        return table_title, False

    def squash(s: str) -> str:
        return re.sub(r"\s+", " ", s).strip()

    if not truncated:
        # 未截断：优先取**长度恰好相等**的窗口 —— 那才是标题本身。
        for cand in candidates:
            if len(_norm_for_match(cand)) == len(nb):
                return squash(cand), True
        # 没有完全相等的，就当作 PDF 里的标题写法与表格略有出入，
        # 保留表格标题（不从 PDF 里挑一个更长的回来，那只会带回作者名）。
        return table_title, False

    # 截断：取**最短的更长窗口**，它刚好把省略号那段补齐，不会带到作者。
    longer = [c for c in candidates if len(_norm_for_match(c)) > len(nb)]
    if not longer:
        return table_title, False
    best = min(longer, key=lambda c: len(_norm_for_match(c)))
    return squash(best), True


# --------------------------------------------------------------------------
# 3. PDF 结构解析
# --------------------------------------------------------------------------


def _heading_from_line(line: str) -> tuple[str, str] | None:
    """一行正文能不能当章节标题。返回 (编号, 标题) 或 None。"""
    m = HEADING_RE.match(line)
    if not m:
        return None
    num, title = m.group(1), m.group(2).strip()
    if HEADING_BLACKLIST.search(title):
        return None
    if not re.search(r"[A-Za-z]{3,}", title):
        return None
    if len(title.split()) > 12:
        return None
    if title.endswith((".", ",")):
        return None
    try:
        if int(num.split(".")[0]) > 30:
            return None
    except ValueError:
        return None
    return num, title


def extract_sections(doc, source_id: str, paper_title: str | None = None) -> list[SectionRecord]:
    """从 PDF 提取章节 → 叶节点。

    返回的列表**一定非空**：没有任何章节线索时返回一个覆盖全篇的叶节点。
    depth-0 的「论文本身」节点由调用方另外建（不在这个列表里）。
    """
    # ---- 路线 1：PDF 自带 outline ----
    toc = doc.get_toc() or []
    entries: list[tuple[int, str, int]] = []  # (level, title, page 1-based)
    for level, title, page in toc:
        t = (title or "").strip()
        if not t:
            continue
        entries.append((max(1, int(level)), t, max(1, int(page))))

    # outline 里常有 "1 Introduction" 这种带编号的，剥掉编号让名字更干净
    cleaned: list[tuple[int, str, int]] = []
    for level, title, page in entries:
        title = re.sub(r"^\d+(?:\.\d+)*\.?\s+", "", title).strip() or title
        cleaned.append((level, title, page))

    # ---- 路线 2：正文行模式 ----
    if not cleaned:
        seen: set[str] = set()
        for pno in range(doc.page_count):
            for line in doc[pno].get_text().splitlines():
                hit = _heading_from_line(line)
                if not hit:
                    continue
                num, title = hit
                if num in seen:
                    continue
                seen.add(num)
                cleaned.append((num.count(".") + 1, title, pno + 1))

    # ---- 路线 3：整篇一个叶节点 ----
    if not cleaned:
        return [
            SectionRecord(
                id=f"{source_id}-1",
                name="全文",
                depth=1,
                ordinal=1,
                isLeaf=True,
                startPage=1,
                parentId=source_id,
            )
        ]

    # 只保留前两级（level > 2 的压到 2），避免某些书的 outline 深达 6 级
    sections: list[SectionRecord] = []
    stack: list[SectionRecord] = []  # 当前路径上的祖先
    for idx, (level, title, page) in enumerate(cleaned, start=1):
        depth = min(level, 2)
        while stack and stack[-1].depth >= depth:
            stack.pop()
        parent = stack[-1].id if stack else source_id
        sec = SectionRecord(
            id=f"{source_id}-{idx}",
            name=title,
            depth=depth,
            ordinal=idx,
            isLeaf=False,  # 先都当容器，最后把「没有子节点」的标成叶
            startPage=page,
            parentId=parent,
        )
        sections.append(sec)
        stack.append(sec)

    # ---- 质量闸：把「看起来不是标题」的条目拿掉 ----
    # PDF 自带 outline 不一定可信。实测两种坏法：
    #   1. 从 PDF 阅读器导出时把「目录页本身」也收进去了（Allison2006 第一个
    #      条目叫 `toc`，下面挂 87 条，其中包含作者列表与 `Fig.1. ...` 图注）；
    #   2. 用 LaTeX 生成的 PDF 会把每个 `\section` 拆成 `I. I NTRODUCTION`
    #      这种带空格的大小写混排。
    # 不过滤的后果很具体：BABAR 被切出 198 个「叶节点」，其中一半是
    # `T. The steel flux return is instrumented for` 这种正文残句。
    kept = [
        s
        for s in sections
        if _is_plausible_section_name(s.name) and not _is_paper_title(s.name, paper_title)
    ]
    if not kept:
        kept = [
            SectionRecord(
                id=f"{source_id}-1",
                name="全文",
                depth=1,
                ordinal=1,
                isLeaf=True,
                startPage=1,
                parentId=source_id,
            )
        ]
    else:
        # 被删掉的节点，其子节点上提到它原来的父节点 —— 否则子节点会挂到
        # 一个不存在的 parent_id 上（外键直接报错）。
        removed = {s.id for s in sections} - {s.id for s in kept}
        if removed:
            id_to_kept_parent: dict[str, str | None] = {}
            for sec in sections:
                if sec.id in removed:
                    # 它自己的父若也被删，继续往上找
                    parent = sec.parentId
                    while parent in removed:
                        parent = next(p.parentId for p in sections if p.id == parent)
                    id_to_kept_parent[sec.id] = parent
            for sec in kept:
                if sec.parentId in removed:
                    sec.parentId = id_to_kept_parent.get(sec.parentId, source_id)
        sections = kept

    # 没有任何子节点的才是叶节点
    has_child: set[str] = {s.parentId for s in sections if s.parentId}
    for sec in sections:
        sec.isLeaf = sec.id not in has_child

    # 全是容器（outline 只有一层但有多个条目）时，每个都是叶 —— 上面的
    # has_child 逻辑已经处理了（没人当 parent 就都是叶）。

    # 兜底：极端情况下（outline 全是同一条目的重复）可能一个叶都没有
    if not any(s.isLeaf for s in sections):
        sections[-1].isLeaf = True

    return sections


def _is_paper_title(name: str, paper_title: str | None) -> bool:
    """这个条目是不是「论文标题自己」被当成了章节。

    实测：`Allison2006_Geant.pdf` 的 outline 第二项就是论文标题
    `Geant4 Developments and Applications`，它下面才挂真正的章节。
    留着它会让 depth-0 的论文节点与 depth-2 的子节点同名 —— 图上会出现
    两个叫一样的节点，而父节点的 chunk 一个都没有。
    """
    if not paper_title:
        return False
    a = _norm_for_match(name)
    b = _norm_for_match(paper_title)
    if not a or not b:
        return False
    # 一个包含另一个就算（outline 里的标题常被截断或多了副标题）
    return a in b or b in a


def _is_plausible_section_name(name: str) -> bool:
    """这个字符串像不像一个章节标题。

    ## 为什么需要它

    PDF 的 outline 不是内容作者声明的语义，而是生成工具写进去的字符串。
    实测三种不该当标题的：

    - `toc` / `Contents` / `Table of Contents` —— 阅读器把目录页本身也收了
    - `J. Allison, K. Amako, J. Apostolakis, ...` —— 作者列表
    - `Fig.1. Ray-tracer view of the Geant4 G4TwistedTubs` —— 图注

    ## 判据（全部是廉价的字符串特征，不需要 NLP）

    1. 长度 3–90 字符；
    2. 至少 2 个单词，且不超过 14 个（标题不会是一整句）；
    3. 不以句号/逗号/分号结尾（那是句子）；
    4. 不是纯数字/符号；
    5. 词数里「首字母大写」或「全大写」的占比 >= 0.5（标题式）；
    6. 不含邮箱、URL、`Fig.`、`Table`、`Eq.` 这类正文标记；
    7. 不以作者列表的典型形态开头（`J. Allison, K. Amako` —— 两个「首字母.」）。

    宁可漏掉一个真标题（结果是一个更粗的叶节点），也不要收一个假标题
    —— 假标题会变成图上一个永远没 chunk 的点，比少一个点更糟。
    """
    t = (name or "").strip()
    if not (3 <= len(t) <= 90):
        return False
    if t.lower() in {"toc", "contents", "table of contents", "outline", "index"}:
        return False
    if t.endswith((".", ",", ";", ":")):
        return False
    if not re.search(r"[A-Za-z]{2,}", t):
        return False
    if HEADING_BLACKLIST.search(t):
        return False
    if re.search(r"[\w.+-]+@[\w-]+\.\w+", t):
        return False
    # 作者列表：`J. Allison, K. Amako, ...` —— 三个以上「首字母. 名字」
    if len(re.findall(r"\b[A-Z]\.\s?[A-Z][a-z]", t)) >= 3:
        return False
    # 正文被切断的一句散文、或一条参考文献条目 —— 两条都不是章节标题。
    # 放在这里而不是只放在翻译阶段：它们是**假节点**，留着会在图上变成
    # 一个永远搜不到内容的点；拦在入口则那些页会归到前一个真叶节点。
    if _SENTENCE_BREAK.search(t) or _REFERENCE_ENTRY.search(t):
        return False
    words = t.split()
    if len(words) < 2 or len(words) > 14:
        return False
    letters = re.findall(r"[A-Za-z][A-Za-z'-]*", t)
    if not letters:
        return False
    capitalized = sum(1 for w in letters if w[0].isupper())
    if t.upper() != t and capitalized / len(letters) < 0.5:
        return False
    return True


def assign_pages_to_leaves(sections: list[SectionRecord], page_count: int) -> dict[int, list[str]]:
    """把 PDF 页（1-based）分配给叶节点。返回 `{页号: [叶节点 id, ...]}`。

    ## 为什么是**一对多**而不是一对多

    原先的实现是「一页归到它之前最近的那个叶节点」，结果实测出 **348 个
    叶节点分不到任何页**（BABAR 152 个叶里 74 个、Ablikim 53 个里 50 个）。
    原因很具体：论文排版密，**一页里能落好几个章节标题**。当 5 个标题都
    从第 12 页开始时，一对一的映射只能把第 12 页给最后一个，前四个永远是空的。

    空叶节点不是无害的：它在图上是一个永远搜不到、永远点不开、没有内容的点，
    比不建它更糟。所以改成一对多：

    - **一页只有一个候选叶**：整页归它（常见情况）。
    - **一页有多个候选叶**（同一页里落了好几个标题）：**这页给其中第一个**，
      后面的叶节点把它的下一张候选页拿走。
    - **末尾若仍有叶节点一页都分不到**：回退到「从同一个起点的最近那个
      已分配叶节点」共享页面 —— 宁可两个叶共享一页，也不要出现空节点。

    ## 为什么 chunk 允许 `micro_kp_id` 一对多

    `app.chunks.micro_kp_id` 是单值列，所以上面的一对多最终还是要在
    chunk 行上选一个主归属。`build_chunk_rows()` 负责把「多个叶共享同一页」
    展开成**多行 chunk**（每行一个 `micro_kp_id`，id 带 `-k2` 后缀）。
    这样每个叶节点都有 chunk，代价是少数页面在库里存了两份。
    这是刻意的：论文页本来就同时讲好几件事，检索需要能按任一叶节点命中。
    """
    leaves = sorted([s for s in sections if s.isLeaf], key=lambda s: (s.startPage, s.ordinal))
    if not leaves:
        return {}

    mapping: dict[int, list[str]] = {p: [] for p in range(1, page_count + 1)}
    prev_page = 1
    for leaf in leaves:
        start = min(max(1, leaf.startPage), page_count)
        # 这一叶的「区间」从它的起点开始，到下一个叶的起点为止（不含）
        mapping[start].append(leaf.id)
        prev_page = start

    # 第二道：给一个页都没分到的叶找一页 —— 它只能与起点相同的兄弟共享
    assigned = {kid for kids in mapping.values() for kid in kids}
    orphans = [leaf for leaf in leaves if leaf.id not in assigned]
    for leaf in orphans:
        start = min(max(1, leaf.startPage), page_count)
        mapping[start].append(leaf.id)

    # 第三道：如果某页一个叶都没有（比如前几页在第一个标题之前），
    # 给第一个叶（封面/摘要归它）
    first = leaves[0].id
    if not mapping[1]:
        mapping[1].append(first)
    for page in range(1, page_count + 1):
        if not mapping[page]:
            # 往前找最近的有叶的页，把它的第一个叶拿过来
            for back in range(page - 1, 0, -1):
                if mapping[back]:
                    mapping[page].append(mapping[back][0])
                    break
            else:
                mapping[page].append(first)

    return mapping


def read_pdf(path: Path) -> tuple[int, list[str], list[SectionRecord], str, bool]:
    """读一个 PDF。返回 (页数, 每页文本, 章节列表, 补全标题, titleFromPdf)。"""
    import pymupdf  # 延迟 import：--index-only 不需要它

    doc = pymupdf.open(path)
    try:
        page_count = doc.page_count
        page_texts = [doc[i].get_text() for i in range(page_count)]
        first_page = page_texts[0] if page_texts else ""
        return page_count, page_texts, [], first_page, False
    finally:
        doc.close()


# --------------------------------------------------------------------------
# 4. 组装
# --------------------------------------------------------------------------


def sanitize_pdf_text(text: str) -> str:
    """洗掉 PostgreSQL `text` 列不接受的字符。

    ## 为什么要这一步

    PDF 的文字层是「字形 → Unicode」的映射，不是干净文本。实测 8 个 PDF
    （ATLAS、CMS、LHCb、BABAR、Evans2008、Abazov2006、GENIE、CMS tracking）
    的某些页里含 `\x00`：那是 PDF 字体表里的缺字符号（`.notdef`），
    pymupdf 原样把它吐出来了。

    直接写库会报 `psycopg.DataError: PostgreSQL text fields cannot contain
    NUL (0x00) bytes`，而且**整个事务回滚**，前面 100 篇白写。

    ## 洗什么

    - `\x00` —— PG 硬拒。
    - 其他 C0 控制符（`\x01`–`\x08`、`\x0b`、`\x0c`、`\x0e`–`\x1f`）——
      PG 能存但会让下游（BM25 分词、JSON 序列化）出怪。保留 `\t`/`\n`/`\r`。
    - `\ufeff`（BOM）与孤立代理项 —— 前者是残留，后者 JSON 序列化会炸。

    **不洗**：软连字符 `\u00ad`、零宽空格 —— 那些在正常排版里有意义，
    而且不影响存储。
    """
    if not text:
        return text
    out = text.replace("\x00", "")
    out = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f]", "", out)
    out = out.replace("\ufeff", "")
    # 孤立代理项：先 encode 再 decode 会把它们替换成 U+FFFD，比崩掉好
    try:
        out.encode("utf-8")
    except UnicodeEncodeError:
        out = out.encode("utf-8", "replace").decode("utf-8")
    return out


def build_records(rows: Iterable[PaperRow], papers_dir: Path = PAPERS_DIR) -> list[PaperRecord]:
    import pymupdf

    records: list[PaperRecord] = []
    for row in rows:
        pdf_path = papers_dir / row.fileName
        if not pdf_path.exists():
            raise SystemExit(f"README 里的文件不存在：{row.fileName}")
        doc = pymupdf.open(pdf_path)
        try:
            page_count = doc.page_count
            page_texts = [sanitize_pdf_text(doc[i].get_text()) for i in range(page_count)]
            empty_pages = sum(1 for t in page_texts if not t.strip())

            # 先把标题补全 —— `extract_sections` 要用它把「论文标题自己」
            # 从 outline 里筛掉（否则会出现两个同名节点：depth-0 的论文
            # 与 depth-2 的子节点）。
            title, from_pdf = complete_title(row.title, page_texts[0] if page_texts else "")
            title = apply_umlaut_fix(row.fileName, title)

            sections = extract_sections(doc, source_id_for(row.doi), paper_title=title)
        finally:
            doc.close()

        records.append(
            PaperRecord(
                row=row,
                sourceId=source_id_for(row.doi),
                title=title,
                titleFromPdf=from_pdf,
                pageCount=page_count,
                emptyPages=empty_pages,
                sections=sections,
                pageTexts=page_texts,
            )
        )
    return records


def apply_umlaut_fix(file_name: str, title: str) -> str:
    """三个文件名丢了变音字母 —— 把正确拼写补回标题里。

    注意：`Mller1973_Dead.pdf` 的标题是 `Dead-time problems`，不含作者名，
    所以这条修的是 `meta.correctedAuthor`（见 `source_meta`），标题不动。
    这里只处理标题里真的出现了作者名的情况（当前语料里没有，留作扩展点）。
    """
    fix = UMLAUT_FIXES.get(file_name)
    if not fix:
        return title
    wrong, right = fix
    if wrong in title:
        return title.replace(wrong, right)
    return title


def source_meta(rec: PaperRecord) -> dict[str, Any]:
    """`app.sources.meta`。`fileNameOriginal` 与变音修正是票 18 验收第 7 条的要求。"""
    meta: dict[str, Any] = {
        "doi": rec.row.doi,
        "year": rec.row.year,
        "citations": rec.row.citations,
        "venue": rec.row.venue,
        "topic": rec.row.topic_name,
        "topicLetter": rec.row.topic_letter,
        "foundational": rec.foundational,
        "fileNameOriginal": rec.row.fileName,
        "titleFromPdf": rec.titleFromPdf,
        "tableTitle": rec.row.title,
        "pageCount": rec.pageCount,
        "emptyPages": rec.emptyPages,
    }
    fix = UMLAUT_FIXES.get(rec.row.fileName)
    if fix:
        meta["correctedAuthor"] = fix[1]
        meta["fileNameNote"] = (
            f"文件名丢了变音字母（应为 {fix[0]}）；文件名不改（会断 .doi_index.json 的映射），"
            f"正确拼写记在 correctedAuthor"
        )
    return meta


def module_id_for(letter: str) -> str:
    return f"mod-paper-{TOPIC_SLUGS[letter]}"


#: 十个模块的中文名（人工给定，不调模型）。
#: D10 红线：`modules.name` 会直接显示给学习者（`GET /graph` 的 `moduleName`），
#: 所以必须是中文。模块只有 10 个固定分类，人工译比调模型可靠。
TOPIC_NAMES_ZH: dict[str, str] = {
    "A": "气体探测器与微结构探测器",
    "B": "硅径迹探测器与 MAPS",
    "C": "闪烁体与光探测器",
    "D": "读出 ASIC 与数字化器",
    "E": "前端电子学与信号处理",
    "F": "辐射效应与加固",
    "G": "成像与医学物理",
    "H": "对撞机探测器系统",
    "I": "模拟与分析软件",
    "J": "能谱学、核数据与分析",
}


# --------------------------------------------------------------------------
# 译名
# --------------------------------------------------------------------------

_TRANSLATOR = None


def paper_translator():
    """惰性单例：`title -> 中文名`。

    走 `paper_glossary.make_paper_translator()`，它复用 `tools/ingest/translate.py`
    的规则引擎（最长匹配术语表 + `A of B` 换位），只补一张论文侧术语表。
    """
    global _TRANSLATOR
    if _TRANSLATOR is None:
        _sys_path_papers()
        from paper_glossary import make_paper_translator

        _TRANSLATOR = make_paper_translator()
    return _TRANSLATOR


def _sys_path_papers() -> None:
    """把 `tools/ingest` 与 `tools/papers` 放进 `sys.path`。

    `translate.py` 住在 `tools/ingest/`，本目录是 `tools/papers/`。两个目录都
    没有 `__init__.py`（仓库约定：工具脚本用裸 import），所以靠 sys.path 而不是包。
    """
    here = Path(__file__).resolve().parent
    for candidate in (here, here.parent / "ingest"):
        if str(candidate) not in sys.path:
            sys.path.insert(0, str(candidate))


def translate_name(english: str) -> str:
    """英文名 → 中文名。**保证返回值含汉字**（D10 红线）。"""
    return paper_translator()(english)


def _strip_dangling_tail(zh: str) -> str:
    """去掉中文译名末尾悬空的连接词（「与」「和」「的」「在」「或」「及」）。

    ## 为什么会有悬空尾巴

    `translate._translate_words()` 会剥掉句尾的**连接词**，但它的
    `CONNECTORS` 表只有 `of` / `for` / `in` / `between` / `based on` / `with` ——
    **没有 `and`**。而 `and` 在术语表里译作「与」，于是被当成普通词保留：

        `High luminosity insertions (IR1 and IR5)` → 「高亮度插入件与」
        `Tracking and Scoring`                    → 「径迹测量与」

    这两个尾巴不是「没译完」，而是「`and` 后面的东西没译出来」。留着它比
    截掉更糟：学习者看到「径迹测量与」会以为句子断了。

    ## 为什么截掉是安全的

    中文的「与」「和」「的」「在」「或」「及」**不能做词尾**（它们都是
    连词/介词，必须接宾语）。所以末尾出现它们一定是译文残渣，截掉不会
    误伤任何合法的名字。截完若一个汉字都不剩，调用方会走降级命名。
    """
    text = (zh or "").strip()
    while text and text[-1] in "与和的在或及":
        text = text[:-1].rstrip()
    return text


_HANZI_RE = re.compile(r"[\u4e00-\u9fff]")
_LATIN_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9\-]{1,}")


def _looks_like_name(zh: str) -> bool:
    """中文译名看起来像个名字（而不是残渣）吗？

    ## 为什么不是「至少 2 个汉字」

    死守 2 个汉字会把下面这三个**真名字**推去降级命名：

        `GEM chambers`      → 「GEM 室」
        `The ROOT Trees`    → 「ROOT树」
        `The TObject class` → 「TObject类」

    中文技术文献里就是这么写的 —— 术语信息全在拉丁缩写上，再加一个字也
    不会更好读。实测放宽后只多了这 3 条真标题，噪声一条都没混进来
    （噪声在调用前就被 `_is_measurement_fragment` / `_is_running_text_fragment`
    挡掉了）。

    ## 判据

    1. 至少 2 个汉字 → 直接算名字；
    2. 至少 1 个汉字 **且** 含一个长度 ≥2 的拉丁词（`GEM`、`TObject`、
       `WorldFIP`）→ 也算名字（缩写自带信息）；
    3. 其余（「点」「阈」「MEV在」）→ 不是名字，走降级命名。
    """
    hanzi = len(_HANZI_RE.findall(zh or ""))
    if hanzi >= 2:
        return True
    return hanzi >= 1 and bool(_LATIN_TOKEN_RE.search(zh or ""))


def _is_measurement_fragment(name: str) -> bool:
    """这个「章节名」是不是从正文里被切断的一句数值描述。

    ## 为什么不能只靠 `_is_plausible_section_name`

    那条过滤器判的是「像不像标题」，而数值片段长得也很像标题：
    `MeV at Ed = 2.17 MeV` 有 4 个词、首字母大写占比够、也不以句号结尾，
    它会一路活到翻译阶段。翻译器把它逐词译成 `MEV在MEV使用` —— 词都译对了，
    但这个字符串对学习者没有意义，而它背后其实只是正文里一句被版面切断的话。

    ## 判据（三条，全部针对「数值 + 单位」这种正文特征）

    1. 含 `=` 或 `~`（标题不会写等式）；
    2. 以能量单位开头（`MeV at Ep ~ 1.9 MeV` 被切开后只剩 `MeV. At sea level`）；
    3. 含「数字 + 物理单位」（`2.3 ADC counts`、`0.2 MeV`、`1.9 MeV`）。

    命中即走降级命名（「第 N 节 · …」），**不丢节点** —— 那些页确实有内容，
    只是它的标题不是一句能读的话。英文原名仍在 `summary` 里可反查。
    """
    t = (name or "").strip()
    if not t:
        return False
    if re.search(r"[=~]", t):
        return True
    if re.match(r"^(MeV|keV|GeV|TeV|eV)\b", t):
        return True
    if re.search(
        r"\b\d+(?:\.\d+)?\s*(?:MeV|keV|GeV|TeV|eV|kV|mV|nA|uA|\u00b5A|mA|ns|ps|fs|um|\u00b5m|nm|mm|cm"
        # `ADC`/`counts` 也是单位：核电子学的能量刻度常写成「2.3 ADC counts」。
        # 这两个词没有加进 `_REFERENCE_ENTRY` 的期刊缩写表，只在这里当单位用。
        r"|ADC|counts?)\b",
        t,
    ):
        return True
    return False


def _is_running_text_fragment(name: str) -> bool:
    """这个「章节名」是不是从正文里被切断的一句**散文**或一条参考文献。

    ## 与 `_is_measurement_fragment` 的分工

    那个管「数值 + 单位」（`MeV at Ed = 2.17 MeV`），这个管「句子」与
    「参考文献条目」。两者都长得像标题，所以都要在翻译前拦下。

    ## 为什么 `_is_plausible_section_name` 拦不住

    它只判「结尾是不是句号」，而这里的问题是**句子中间**有句号：

        `October 1989 event. This “worst-week” model formally`
        `Attention must be given to the last wires. Suc-`
        `J. Seeman et al., Status Report on PEP-II`

    三条都满足「2–14 个词、首字母大写占比够、不以句号结尾」，于是活到
    翻译阶段，被逐词译成「十月事例最坏周模型形式上」这种半句话。

    ## 判据

    1. **句中句号**：`. ! ?` 后接空白再接大写字母。用 `(?<![A-Z])` 排除
       「单个大写字母 + 句号」（罗马数字 `I. Microgrid`、人名缩写 `J. Seeman`
       的开头），否则参考文献条目的第一个缩写会把整条漏过去。
    2. **参考文献条目**：含 `et al`、或含期刊缩写（`Nucl.` / `Phys.` /
       `Instr.` / `Meth.` / `Proc.` / `IEEE` / `Trans.` …）、或以
       `A. Surname,` 开头。

    命中不丢节点，只走降级命名 —— 这些页确实有内容，只是它的「标题」不是
    一句能读的话。英文原名仍在 `summary` 里可反查。
    """
    t = (name or "").strip()
    if not t:
        return False
    if _SENTENCE_BREAK.search(t):
        return True
    if _REFERENCE_ENTRY.search(t):
        return True
    return False


def merge_small_caps(name: str, known=None) -> str:
    """把 PDF 小型大写字母（small caps）排出来的标题还原成正常词形。

    ## 问题

    有些 PDF 把章节标题用 small caps 排版。抽取文字时，每个词的**首字母**
    被当作普通大写字母输出，其余字母被当作另一段全大写，中间多一个空格：

        `I. I NTRODUCTION`                                  ← `I. INTRODUCTION`
        `III. T EST R ESULTS`                               ← `III. TEST RESULTS`
        `V. E NHANCEMENT OF G EANT 4 I NTERACTIVE C APABILITIES`

    这些是**真标题**，但 `clean_section_title()` 的全大写转 Title Case 会把它们
    洗成 `I Ntroduction`（首字母被当成独立单词），然后一个词也译不出，白浪费
    一条可读的章节名。实测 14 条命中这个模式，其中 9 条本来是完整的真标题。

    ## 判据（两条，宁可漏合并不可误合并）

    1. **同一串里有 ≥2 处伪影 → 无条件合并**。一处可能是巧合（`A MAGNETIC`
       里的 `A`），两处以上基本只能是排版伪影。
    2. **只有 1 处 → 查词表**：合并后的词（小写）必须是已知术语才合，否则留原样。

    实测这条双判据放过了三个真标题（`A HOPPING DISTANCE` 里的 `A`、
    `OPERATION IN A MAGNETIC FIELD` 里的 `A`、`IN(H COUNTER` 里的 `H`），
    而把 9 条伪影全修对了。

    ## 为什么放在这个文件而不是 `export_titles.py`

    判据 2 需要翻译器的 `GLOSSARY`，而 `export_titles.py` 只依赖标准库 +
    `ingest_papers`（它自己是被 `ingest_papers` 调用的，反向依赖会成环）。
    `ingest_papers` 已经通过 `_sys_path_papers()` 拿到了 `tools/ingest` 的路径。

    `known` 参数是为了让测试能注入一个固定的词表，不依赖真实翻译器。
    """
    t = (name or "").strip()
    if not t:
        return t
    hits = _SMALL_CAPS.findall(t)
    if not hits:
        return t

    if known is None:
        paper_translator()  # 惰性单例，顺带把三份词表合进 translate.GLOSSARY
        import translate

        glossary = translate.GLOSSARY

        def known(word: str) -> bool:  # noqa: F811
            return word in glossary

    unconditional = len(hits) >= 2

    def repl(m: "re.Match[str]") -> str:
        merged = m.group(1) + m.group(2)
        if unconditional or known(merged.lower()):
            return merged
        return m.group(0)

    return _SMALL_CAPS.sub(repl, t)


def translate_section_name(sec: "SectionRecord", section_index: int) -> str:
    """章节名 → 中文名，带**降级命名**。

    ## 为什么需要降级

    论文的章节名里混着大量 PDF 噪声：参考文献条目（`Roney JM, Thompson CJ:
    Detector`）、被版面切断的单词（`obtainabl`、`hysic`）、页码与日期
    （`November 2024`、`MeV)`）。这些**没有译法**，硬造一个比保留原文更糟。

    实测 1111 条章节名（含 57 个中间层）里，叶节点 1054 条，其中 24 条走降级
    命名 —— 剩下的都是真名字（含 `GEM 室` 这类拉丁缩写 + 单汉字）。降级规则：

    1. 清洗后的名字能译 → 直接用
    2. 译不出但名字里**有可译的词** → 「第 N 节 · <第一个译出的词>」
    3. 一个词都译不出 → 「第 N 节 · 原文见摘要」

    `summary` 里始终保留英文原名，所以降级命名不会丢失信息。
    """
    _sys_path_papers()
    import export_titles

    cleaned, _degraded = export_titles.clean_section_title(merge_small_caps(sec.name))
    fragment = _is_measurement_fragment(cleaned) or _is_running_text_fragment(cleaned)
    translated = "" if fragment else translate_name(cleaned)
    if translated and not translated.startswith("未收录术语"):
        trimmed = _strip_dangling_tail(translated)
        # 截完还剩多少汉字才用？这里放宽到「至少 1 个汉字 + 至少一个拉丁缩写」，
        # 而不是死守「至少 2 个汉字」。
        #
        # 原因是后者的真实代价：`GEM chambers` 译成「GEM 室」、`The ROOT Trees`
        # 译成「ROOT树」、`The TObject class` 译成「TObject类」—— 这三个名字
        # 在中文文献里就是这么说，术语信息全在拉丁缩写上，死守 2 个汉字会
        # 把它们全推去「第 N 节 · 原文见摘要」，反而更不可读。
        #
        # 放宽不会放进噪声：调用前已经用 `_is_measurement_fragment` /
        # `_is_running_text_fragment` 挡掉了正文残句（`MeV在`、`点` 这类），
        # 实测放宽只影响 3 条真标题，噪声一条都没多。
        if _looks_like_name(trimmed):
            return trimmed

    # 逐词试：把清洗后的名字按词拆，找第一个能单独译出的实词。
    # 单位与虚词先排除 —— 否则 `MeV at Ed =` 会挑中 `MeV` 译成「MEV」，
    # 降级命名反而比直接说「原文见摘要」更难读。
    for word in re.split(r"[\s/\-,:;()]+", cleaned):
        word = word.strip()
        if len(word) < 3 or not re.match(r"^[A-Za-z]", word):
            continue
        if word.lower() in _NON_WORD_TOKENS:
            continue
        single = translate_name(word)
        if not single.startswith("未收录术语"):
            single = _strip_dangling_tail(single)
            # 与主路径同一个阈值：只译出一个字的（「高」「块」「系」）不走
            # 单字命名。「第 12 节 · 块」比「第 12 节 · 原文见摘要」更难认，
            # 而且单字往往是半个词（`block` 被版面切断后只剩 `blo`）。
            if len(re.findall(r"[\u4e00-\u9fff]", single)) >= 2:
                return f"第 {section_index} 节 · {single}"[:60]

    return f"第 {section_index} 节 · 原文见摘要"


def module_ordinal(letter: str) -> int:
    """100 起递增。**不用 1–10** —— 那是书章节的地盘（现最大 20）。"""
    return 100 + TOPIC_ORDER.index(letter)


def kp_summary(rec: "PaperRecord", english_name: str, kind: str) -> str:
    """`app.knowledge_points.summary`：**原文保留处**（D10 要求原文可反查）。

    格式：`原文：<English>`，前面可带一句状态标注（奠基性论文）。
    为什么不单开一列 `name_original`：`knowledge_points` 表没那一列，而
    `summary` 本来就是「给这条节点的补充说明」，正好放得下。
    """
    parts: list[str] = []
    if kind == "paper" and rec.foundational:
        parts.append("奠基性论文")
    parts.append(f"原文：{english_name}")
    if kind == "paper":
        parts.append(f"DOI：{rec.row.doi}")
        parts.append(f"{rec.row.year} 年 · {rec.row.venue}")
    return "；".join(parts)


# --------------------------------------------------------------------------
# 5. 写库
# --------------------------------------------------------------------------


def check_no_references(conn, source_ids: Sequence[str], kp_ids: Sequence[str]) -> list[str]:
    """确认本脚本的 id 没有被别的表引用。返回非空列表就是拒绝执行的证据。"""
    problems: list[str] = []
    checks = [
        ("attempts.micro_kp_id", "SELECT count(*) FROM attempts WHERE micro_kp_id = ANY(%s)"),
        ("mastery.micro_kp_id", "SELECT count(*) FROM mastery WHERE micro_kp_id = ANY(%s)"),
        ("levels.micro_kp_id", "SELECT count(*) FROM levels WHERE micro_kp_id = ANY(%s)"),
        ("node_unlocks", "SELECT count(*) FROM node_unlocks WHERE node_id = ANY(%s) OR prerequisite_id = ANY(%s)"),
        ("kp_edges", "SELECT count(*) FROM kp_edges WHERE from_id = ANY(%s) OR to_id = ANY(%s)"),
        ("video_clips.micro_kp_id", "SELECT count(*) FROM video_clips WHERE micro_kp_id = ANY(%s)"),
        ("chunk_kp_answer", "SELECT count(*) FROM chunk_kp_answer WHERE micro_kp_id = ANY(%s)"),
    ]
    for label, sql in checks:
        if label in ("node_unlocks", "kp_edges"):
            n = conn.execute(sql, (list(kp_ids), list(kp_ids))).fetchone()[0]
        else:
            n = conn.execute(sql, (list(kp_ids),)).fetchone()[0]
        if n:
            problems.append(f"{label}: {n} 行引用")
    return problems


def write_db(conn, records: Sequence[PaperRecord]) -> dict[str, int]:
    """全部 upsert。顺序：modules → sources → depth-0 kp → 子 kp → chunks。"""
    stats = {"sources": 0, "modules": 0, "kp": 0, "chunks": 0}

    # ---- 模块（十个主题）----
    # 模块名用 `TOPIC_NAMES_ZH` 的中文（D10），英文原名写进
    # `modules.name` 已无第二列可用，所以只在返回值里给对照。
    for letter in TOPIC_ORDER:
        conn.execute(
            """
            INSERT INTO modules (id, subject_id, name, tier, ordinal)
            VALUES (%s, 'nuclear', %s, 'C', %s)
            ON CONFLICT (id) DO UPDATE
              SET name = EXCLUDED.name, tier = EXCLUDED.tier, ordinal = EXCLUDED.ordinal
            """,
            (module_id_for(letter), TOPIC_NAMES_ZH[letter], module_ordinal(letter)),
        )
        stats["modules"] += 1

    for rec in records:
        mid = module_id_for(rec.row.topic_letter)

        # ---- source ----
        # `sources.title` 也是会显示给学习者的字段（市场/检索结果），用中文。
        # 英文原名在 `meta.tableTitle` 与 `meta.titleEnglish` 里。
        title_zh = translate_name(rec.title)
        meta = source_meta(rec)
        meta["titleEnglish"] = rec.title
        meta["titleZh"] = title_zh
        conn.execute(
            """
            INSERT INTO sources (id, title, kind, path, meta)
            VALUES (%s, %s, 'paper', %s, %s)
            ON CONFLICT (id) DO UPDATE
              SET title = EXCLUDED.title, kind = EXCLUDED.kind,
                  path = EXCLUDED.path, meta = EXCLUDED.meta
            """,
            (
                rec.sourceId,
                title_zh,
                f"资源库/papers/{rec.row.fileName}",
                json.dumps(meta, ensure_ascii=False),
            ),
        )
        stats["sources"] += 1

        # ---- depth-0：论文本身 ----
        conn.execute(
            """
            INSERT INTO knowledge_points
              (id, module_id, parent_id, name, summary, is_leaf, depth, ordinal, source_page, source_id)
            VALUES (%s, %s, NULL, %s, %s, false, 0, 0, 1, %s)
            ON CONFLICT (id) DO UPDATE
              SET name = EXCLUDED.name, summary = EXCLUDED.summary,
                  module_id = EXCLUDED.module_id,
                  parent_id = NULL, is_leaf = false, depth = 0,
                  ordinal = 0, source_page = 1, source_id = EXCLUDED.source_id
            """,
            (
                rec.sourceId,
                mid,
                title_zh,
                kp_summary(rec, rec.title, "paper"),
                rec.sourceId,
            ),
        )
        stats["kp"] += 1

        # ---- 章节 / 叶节点（先父后子：按 depth 升序）----
        # `name` 用中文（译不出时降级命名），`summary` 保留英文原名。
        section_index = 0
        for sec in sorted(rec.sections, key=lambda s: (s.depth, s.ordinal)):
            if sec.isLeaf:
                section_index += 1
            name_zh = translate_section_name(sec, section_index if sec.isLeaf else sec.ordinal)
            conn.execute(
                """
                INSERT INTO knowledge_points
                  (id, module_id, parent_id, name, summary, is_leaf, depth, ordinal, source_page, source_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE
                  SET name = EXCLUDED.name, summary = EXCLUDED.summary,
                      module_id = EXCLUDED.module_id,
                      parent_id = EXCLUDED.parent_id, is_leaf = EXCLUDED.is_leaf,
                      depth = EXCLUDED.depth, ordinal = EXCLUDED.ordinal,
                      source_page = EXCLUDED.source_page, source_id = EXCLUDED.source_id
                """,
                (
                    sec.id,
                    mid,
                    sec.parentId,
                    name_zh,
                    kp_summary(rec, sec.name, "section"),
                    sec.isLeaf,
                    sec.depth,
                    sec.ordinal,
                    sec.startPage,
                    rec.sourceId,
                ),
            )
            stats["kp"] += 1

        # ---- chunks：每页一行（若多叶共享同一页，就一页多行）----
        page_to_leaves = assign_pages_to_leaves(rec.sections, rec.pageCount)
        for page in range(1, rec.pageCount + 1):
            text = rec.pageTexts[page - 1]
            if not text.strip():
                continue
            leaf_ids = page_to_leaves.get(page) or []
            # 多叶共享同一页时，第一叶用无后缀 id（保持与旧版本兼容），
            # 其余叶加 `-k2`/`-k3` 后缀。绝不能因多叶而丢掉任一叶。
            for order, leaf_id in enumerate(leaf_ids):
                chunk_id = f"{rec.sourceId}-p{page:04d}" if order == 0 else f"{rec.sourceId}-p{page:04d}-k{order + 1}"
                conn.execute(
                    """
                    INSERT INTO chunks (id, source_id, ordinal, kind, text, page, micro_kp_id, meta)
                    VALUES (%s, %s, %s, 'text', %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE
                      SET source_id = EXCLUDED.source_id, ordinal = EXCLUDED.ordinal,
                          kind = EXCLUDED.kind, text = EXCLUDED.text, page = EXCLUDED.page,
                          micro_kp_id = EXCLUDED.micro_kp_id, meta = EXCLUDED.meta
                    """,
                    (
                        chunk_id,
                        rec.sourceId,
                        page,
                        text,
                        page,
                        leaf_id,
                        json.dumps(
                            {"pdfPage": page, "paperDoi": rec.row.doi, "sharedPage": len(leaf_ids) > 1},
                            ensure_ascii=False,
                        ),
                    ),
                )
                stats["chunks"] += 1

    return stats


# --------------------------------------------------------------------------
# 6. index.json
# --------------------------------------------------------------------------


def build_index(records: Sequence[PaperRecord]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for rec in records:
        entry: dict[str, Any] = {
            "doi": rec.row.doi,
            # `title` 与库里 `app.sources.title` / depth-0 节点 `name` 逐字一致（D10：中文）。
            # 英文原名放 `titleOriginal`，两边都能反查。
            "title": translate_name(rec.title),
            "titleOriginal": rec.title,
            "year": rec.row.year,
            "citations": rec.row.citations,
            "venue": rec.row.venue,
            "topic": TOPIC_NAMES_ZH[rec.row.topic_letter],
            "topicOriginal": rec.row.topic_name,
            "foundational": rec.foundational,
            "sourceId": rec.sourceId,
            "fileName": rec.row.fileName,
            "pageCount": rec.pageCount,
            "leafCount": rec.leafCount,
            "chunkCount": sum(1 for t in rec.pageTexts if t.strip()),
        }
        # 票 18 验收第 7 条：三个变音字母丢失要「在 meta 里留 fileNameOriginal」。
        # 清单文件是给外部看的，同样要能反查，所以把 `correctedAuthor` 与
        # 说明一起写进来（只有受影响的三条才有这个字段 —— 不给 98 条无事条目
        # 塞 null，否则一眼看不出哪几条需要特殊对待）。
        fix = UMLAUT_FIXES.get(rec.row.fileName)
        if fix:
            entry["correctedAuthor"] = fix[1]
            entry["fileNameNote"] = (
                f"文件名丢了变音字母（应为 {fix[0]}）；文件名不改（会断 .doi_index.json 的映射），"
                f"正确拼写记在 correctedAuthor"
            )
        out.append(entry)
    return out


def write_index(records: Sequence[PaperRecord], out_path: Path = INDEX_OUT) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    data = build_index(records)
    out_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(data)


# --------------------------------------------------------------------------
# 7. 交叉校验
# --------------------------------------------------------------------------


def cross_check_doi_index(rows: Sequence[PaperRow], index_path: Path = DOI_INDEX_PATH) -> None:
    """README 的 DOI 集合必须与 `.doi_index.json` 的键集合相等。

    `.doi_index.json` 的 `file` 字段是 GBK 乱码的绝对路径，**不可信**；
    但它的键（DOI）是下载时的主键，可信。两边不等说明 README 被手工改过
    或索引不完整 —— 这时宁可停下来，也不要按半份清单入库。
    """
    if not index_path.exists():
        print(f"  ! 跳过交叉校验：{index_path} 不存在", file=sys.stderr)
        return
    raw = json.loads(index_path.read_text(encoding="utf-8"))
    indexed = {str(k).strip().lower() for k in raw}
    readme = {r.doi.strip().lower() for r in rows}
    only_readme = sorted(readme - indexed)
    only_index = sorted(indexed - readme)
    if only_readme or only_index:
        raise SystemExit(
            "README 与 .doi_index.json 的 DOI 集合不一致：\n"
            f"  只在 README: {only_readme}\n"
            f"  只在索引: {only_index}"
        )
    print(f"  ✓ DOI 交叉校验通过：{len(readme)} 条两边一致")


# --------------------------------------------------------------------------
# 8. CLI
# --------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="101 篇论文零 OCR 入图（票 18 前半）")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL))
    parser.add_argument("--dry-run", action="store_true", help="只解析并打印统计，不写库")
    parser.add_argument("--index-only", action="store_true", help="只重新生成 content/papers/index.json")
    parser.add_argument("--papers-dir", default=str(PAPERS_DIR))
    parser.add_argument("--index-out", default=str(INDEX_OUT))
    args = parser.parse_args(argv)

    papers_dir = Path(args.papers_dir)
    print(f"解析 {papers_dir / 'README.md'} …")
    rows = parse_readme(papers_dir / "README.md")
    print(f"  表格行：{len(rows)}")

    print("交叉校验 DOI …")
    cross_check_doi_index(rows, papers_dir / ".doi_index.json")

    print("读 PDF（零 OCR，只读文字层）…")
    records = build_records(rows, papers_dir)

    total_pages = sum(r.pageCount for r in records)
    total_chunks = sum(1 for r in records for t in r.pageTexts if t.strip())
    total_leaves = sum(r.leafCount for r in records)
    no_leaf = [r.row.fileName for r in records if r.leafCount == 0]
    truncated_unfilled = [
        r.row.fileName for r in records if r.row.title.endswith("...") and not r.titleFromPdf
    ]
    bad_empty = [
        (r.row.fileName, r.emptyPages, r.pageCount)
        for r in records
        if r.pageCount and r.emptyPages / r.pageCount > 0.5
    ]

    print(f"  论文：{len(records)}")
    print(f"  总页数：{total_pages}，非空页（= chunk 数）：{total_chunks}")
    print(f"  叶节点：{total_leaves}，无叶节点的论文：{len(no_leaf)}")
    print(f"  截断但补全失败：{len(truncated_unfilled)}")
    if bad_empty:
        print(f"  ! 全空页占比 >50%：{bad_empty}")
    if no_leaf:
        print(f"  ! 无叶节点（必须修）：{no_leaf}", file=sys.stderr)

    n_index = write_index(records, Path(args.index_out))
    print(f"  写出 {args.index_out}（{n_index} 条）")

    if args.index_only:
        return 0
    if args.dry_run:
        print("--dry-run：不写库。")
        return 0

    import psycopg

    print(f"写库 {args.database_url.split('@')[-1]} …")
    with psycopg.connect(args.database_url, options="-c search_path=app,public") as conn:
        # 1) 先确认没有别的表引用本脚本的 id
        source_ids = [r.sourceId for r in records]
        kp_ids = [r.sourceId for r in records] + [
            s.id for r in records for s in r.sections
        ]
        current_ids = set(kp_ids)
        problems = check_no_references(conn, source_ids, kp_ids)
        if problems:
            print("拒绝执行：本脚本的 id 已被其他表引用：", file=sys.stderr)
            for p in problems:
                print(f"  {p}", file=sys.stderr)
            return 2

        # 2) 清理本脚本自己的旧 chunk（只有 source_id 与 id 都以 paper- 开头才动）
        #    knowledge_points / sources 不删 —— 全靠 upsert，删了会踩 CASCADE。
        deleted = conn.execute(
            "DELETE FROM chunks WHERE source_id LIKE 'paper-%' AND id LIKE 'paper-%'"
        ).rowcount
        if deleted:
            print(f"  清理旧 chunk：{deleted} 行")

        # 3) 清理**上一轮产生、这一轮不再产生**的 paper 知识点评。
        #
        # 为什么必须有这一步：upsert 只能保证「这一轮的 id 都在」，管不了
        # 「上一轮的 id 已经不该存在」。实测第四轮把 42 条正文碎片/参考文献
        # 条目从入口拦掉后，那一轮只产生 1217 个 kp，而库里还剩 1247 个 ——
        # 那 30 个孤儿是上一轮命名出来的降级节点（`第 21 节 · 场`），
        # 一个 chunk 也分不到，在图上就是永远点不开的死点。
        #（上面两个数是第四轮当时的现场，不是当前值；当前是 kp 1212 / 叶 1054。）
        #
        # 安全边界（三道）：
        #   ① 只动 `source_id LIKE 'paper-%'`；
        #   ② 只动**不在本轮 id 集合里**的（差集，不是全删）；
        #   ③ 删除前跑 `check_no_references()`（第 1 步已跑过全量，这里再
        #      用差集跑一次）—— 有任何引用就整批放弃，宁可留死点也不级联删
        #      别人的作答记录。
        stale_ids = [
            row[0]
            for row in conn.execute(
                "SELECT id FROM knowledge_points WHERE source_id LIKE 'paper-%'"
            ).fetchall()
            if row[0] not in current_ids
        ]
        if stale_ids:
            blockers = check_no_references(conn, [], stale_ids)
            if blockers:
                print(
                    f"  ! 遗留 {len(stale_ids)} 个旧节点但被引用，跳过清理：{blockers}",
                    file=sys.stderr,
                )
            else:
                removed = conn.execute(
                    # `LIKE` 里的 `%` 在带参数查询里要写成 `%%`，否则 psycopg 把它当占位符。
                    "DELETE FROM knowledge_points "
                    "WHERE source_id LIKE 'paper-%%' AND id = ANY(%s)",
                    (stale_ids,),
                ).rowcount
                print(f"  清理旧知识点评：{removed} 行")

        stats = write_db(conn, records)
        conn.commit()

    print(
        "  写入："
        f"sources {stats['sources']} / modules {stats['modules']} / "
        f"kp {stats['kp']} / chunks {stats['chunks']}"
    )
    print("完成。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
