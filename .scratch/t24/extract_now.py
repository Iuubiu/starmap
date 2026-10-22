"""版面抽取：PDF 页 → 块级结构（段落 / 公式 / 表格 / 图）。

为什么不用 `page.get_text()`：
它给出的是按阅读顺序摊平的纯文本，标题、段落、公式、表格全都混在一个流里。
真值表会碎成一行一个 `0`（实测：康华光第 50 个 PDF 页，格雷码真值表被摊成
80 个 block、252 个 span），事后无法还原成行列关系。

为什么不用 `page.find_tables()`：
这本书是扫描重排的电子版，表格**没有画线**（实测 `get_drawings()` 返回 0）。
`find_tables(strategy="lines")` 因此找不到任何表；`strategy="text"` 能找到，
但把 8 列误判成 22 列（把 `b₃` 和它左边的空隙算成两列）。

这里用的办法：**按字符包围盒做二维聚类**。表格单元格是离散的小字符，同行
的 y 中心差极小、同列的 x 中心差极小，先聚 x 再聚 y 就能还原网格。实测把
格雷码表还原成 8 行 × 16 列，逐行与书上二进制→格雷码的转换结果一致。
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field
from typing import Any

import pymupdf


@dataclass
class Block:
    """一个版面块。`kind` 决定下游怎么处理它。"""

    kind: str  # 'heading' | 'paragraph' | 'formula' | 'table' | 'figure' | 'caption'
    page: int  # PDF 页索引（0 起）
    bbox: tuple[float, float, float, float]
    text: str = ''
    rows: list[list[str]] = field(default_factory=list)
    level: int = 0
    # 表格网格填充率。低于 1 说明有空格或跨列标题被塞进单列，供抽检时定位
    fill: float = 1.0
    # 图的裁剪区域（页面坐标）。只有 kind=='figure' 时有值，下游按它裁图
    clip: tuple[float, float, float, float] | None = None


# ---------------------------------------------------------------- 判定规则

# 字号阈值必须是**页内相对**的，不能写绝对值。
# 实测：康华光是扫描重排版，正文约 32pt、表格 27pt、标题 40–48pt（不是
# 常规的 9–12pt）。任何写死的 12pt 之类阈值都会把整页判成标题 —— 第一次
# 跑就是这个结果：三页总共 115 个块全部是 heading。
# 所以这里只留倍率，正文基准由每页的字号中位数现算。
_HEADING_RATIO = 1.25  # 比正文大 25% 以上算标题
_FORMULA_HINT = set('=∑∫√±×÷∞≈≤≥≠∂Δ')


def _spans_of(page: pymupdf.Page) -> list[dict[str, Any]]:
    """把一页拆成带坐标的 span 列表。

    ## 纯空白 span 不能直接丢

    PDF 的文字层里，英文书的词间距常常是**独立的空白 span**（Knoll 3e 实测占
    全部 span 的 43%，Nakhostin 37%）。早期实现直接 `continue` 掉了它们，下游
    `''.join(s['text'] …)` 就把单词粘成一串：

        GENERALPROPERTIESOFRADIATIONDETECTORS101Inthelimitofnegligible…

    中文书不受影响（汉字不用空格，空白 span 只占 4.6%，且多是行首缩进），所以
    这个问题一直没被中文书暴露出来。

    ## 为什么把空格并进前一个 span，而不是保留成独立 span

    保留独立 span 会改变 span 计数，而 `_table_bands` 的判据（「一行 ≥ 3 个
    span、且大多是很短的 token」）与 `_group_lines` 的行高统计都吃 span 数。
    空白 span 会被当成「短 token」，把中文书的正文行误判成表格带。

    并进前一个 span 的**文本**里，span 数与坐标全不变，只有拼接结果变对。

    ## 为什么只在「拉丁字母 ↔ 拉丁字母」之间补空格

    中文正文里字符之间不该有空格。若一律补，12 本已入库的中文书重跑后 chunk
    文本会变成「知 识 点」，`_stable_id` 跟着变，产物与库里对不上。
    所以只在**前一个字符与后一个字符都是 ASCII 字母/数字**时补一个空格。
    """
    out: list[dict[str, Any]] = []
    #: 上一个输出的 span 后面有没有「间断」（空白 span 或行边界）。
    gap = False
    for b in page.get_text('dict')['blocks']:
        if b.get('type') != 0:
            continue
        for line in b.get('lines', []):
            for s in line['spans']:
                if not s['text'].strip():
                    gap = True
                    continue
                x0, y0, x1, y1 = s['bbox']
                text = s['text']
                if gap and out:
                    previous = out[-1]['text']
                    left = previous[-1:]
                    right = text[:1]
                    # 只在「拉丁字母/数字 ↔ 拉丁字母/数字」之间补空格：
                    # 中文正文里插空格会把「知识点」变成「知 识 点」，而
                    # 12 本中文书的产物已经入库，重跑要能逐字节复现。
                    if left.isascii() and left.isalnum() and right.isascii() and right.isalnum():
                        out[-1]['text'] = f'{previous} '
                gap = False
                out.append(
                    {
                        'text': text,
                        'size': s['size'],
                        'x': (x0 + x1) / 2,
                        'y': (y0 + y1) / 2,
                        'bbox': (x0, y0, x1, y1),
                    }
                )
            # 行边界也是间断：PDF 把一整行拆成多个 line 时（Knoll 3e 的
            # `In` / `the` / `limit of negligible…` 就是三个 line），它们属于
            # 同一视觉行，拼接时必须补空格。不置位就会得到
            # `Inthelimit of negligible`。
            gap = True
    return out


def _cluster(values: list[float], tolerance: float) -> list[list[float]]:
    """一维聚类。返回每簇的成员列表，按坐标升序。"""
    clusters: list[list[float]] = []
    for v in sorted(values):
        if clusters and v - clusters[-1][-1] <= tolerance:
            clusters[-1].append(v)
        else:
            clusters.append([v])
    return clusters


def _reconstruct_table(
    spans: list[dict[str, Any]], page: pymupdf.Page | None = None
) -> tuple[list[list[str]], float] | None:
    """
    把一片表格区域还原成行列网格。

    走的是**逐行切格**，不是全局二维聚类。原因是全局聚类被实测证伪过两轮：
    - 用 span 中心聚类：PDF 文本层会把相邻的相同字符**合并成一个 span**
      （格雷码表里 `G? G? G? G。` 是一个宽 233pt 的 span，跨了 4 格），
      中心落在两格之间；跨列标题 `二进制码` 同理。结果列数 16 → 21，
      填充率 0.82 → 0.63，整张表被判成「不是表格」。
    - 用字符级 bbox 全局聚类：列能对上，但单元格宽度不等（`0000` 宽 90pt、
      `0` 宽 20pt），跨列标题仍把整体列中心拉偏，格雷码表里出现 `10`、`00`
      这种两格并进一列的残渣。

    逐行切格不受这些影响：行的聚类很稳（实测第 50 页 49 个 span 聚成 39 行，
    两张表分别 10 行和 17 行，全部正确），行内按「字符间距 > 中位字宽 1.6 倍」
    切开，就得到每行的格子。行与行之间不强制对齐 —— 表格阅读本来也只需要
    每行的格子顺序正确，不需要一个所有行共享的列坐标。

    填充率仍作为质量信号返回：它衡量有多少格子是空的。
    """
    # 9 个 span 的门槛是按「一行三格起」估的，但表格行被 PDF 合并成整 span 时
    # 一页真表可能只有 6 个 span（实测印刷页 60 的表2.3.2：3 行 × 2 格）。
    # 门槛降到 4 并要求后面至少聚出 3 行，仍能挡住两三个孤立公式。
    if len(spans) < 4:
        return None

    if page is not None:
        chars = _chars_within(page, spans)
        if len(chars) >= 9:
            rows = _rows_from_chars(chars)
            if len(rows) >= 3:
                grid = _align_rows(rows)
                widths = len(grid[0]) if grid else 0
                cells = sum(1 for r in grid for c in r if c)
                fill = cells / (widths * len(grid)) if widths else 0.0
                return grid, fill

    # 拿不到字符级 bbox 时退回 span 级逐行切格
    groups = _group_lines(spans)
    rows = [_split_row_cells(g) for g in groups]
    if len(rows) < 3:
        return None
    grid = _align_rows(rows)
    widths = len(grid[0]) if grid else 0
    cells = sum(1 for r in grid for c in r if c)
    fill = cells / (widths * len(grid)) if widths else 0.0
    return grid, fill


def _chars_within(page: pymupdf.Page, spans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """取落在给定 span 垂直范围内的所有字符（带自己的 bbox）。

    为什么要下到字符级：PDF 里一个 span 可以是一串被合并的相同字符
    （`0000`、`G? G? G? G。`），它的 bbox 横跨多个单元格，按 span 切格
    必然错位。字符级 bbox 是唯一可靠的定位依据。

    边界不能只取 span 包围盒的上下沿：相邻行的字符（表注、图注）只要
    字身稍微高一点就会探进来，于是表格第一格里出现 `表3.1.4三态输出门
    电路的真值表`（实测印刷页 88）。这里改成用**行中心**过滤：字符的
    行中心必须落在 span 行中心的范围内。
    """
    ys = sorted((s['bbox'][1] + s['bbox'][3]) / 2 for s in spans)
    lo = ys[0] - 2
    hi = ys[-1] + 2
    out: list[dict[str, Any]] = []
    for b in page.get_text('rawdict')['blocks']:
        if b.get('type') != 0:
            continue
        for line in b.get('lines', []):
            for s in line['spans']:
                for c in s.get('chars', []):
                    ch = c.get('c', '')
                    if not ch.strip():
                        continue
                    x0, y0, x1, y1 = c['bbox']
                    yc = (y0 + y1) / 2
                    if lo <= yc <= hi:
                        out.append({'text': ch, 'x0': x0, 'x1': x1, 'y': yc, 'bbox': c['bbox']})
    return out


def _rows_from_chars(chars: list[dict[str, Any]]) -> list[list[tuple[str, float]]]:
    """字符按 y 聚成行，每行再按大间距切成格。返回 (格文字, 格中心 x)。"""
    heights = sorted(c['bbox'][3] - c['bbox'][1] for c in chars)
    tol = min(max(heights[len(heights) // 2] * 0.5, 4.0), 24.0)

    groups: list[list[dict[str, Any]]] = []
    for c in sorted(chars, key=lambda c: c['y']):
        if groups:
            center = sum(m['y'] for m in groups[-1]) / len(groups[-1])
            if abs(c['y'] - center) <= tol:
                groups[-1].append(c)
                continue
        groups.append([c])
    return [_split_row_cells(g) for g in groups]


def _header_row(
    rows: list[list[tuple[str, float]]], mode: int
) -> list[tuple[str, float]] | None:
    """表头 = 首个「格数正好等于众数」的行之前、格数最多的那一行。

    表格带的上沿常带一行跨页残留（实测印刷页 28 的 ASCII 表首行是上一页的
    跨列表头 `b?b?bs`，只有 1 格），所以不能直接取 rows[0]。数据行之前的
    都是表头区；表头区里格数最多的那行最接近真实列数。

    表头区的行都少于 3 格时返回 None —— 那种表没有可用的列数参考。
    """
    best: list[tuple[str, float]] | None = None
    for row in rows:
        if len(row) == mode:
            break
        if best is None or len(row) > len(best):
            best = row
    if best is None or len(best) < 3:
        return None
    return best


def _column_of(xc: float, centers: list[float]) -> int:
    """按格中心 x 归位到列下标。落在最后一列之外的一律归最后一列。"""
    bounds = [(a + b) / 2 for a, b in zip(centers, centers[1:])]
    for i, b in enumerate(bounds):
        if xc < b:
            return i
    return len(centers) - 1


def _cells_collide(rows: list[list[tuple[str, float]]], ref: list[tuple[str, float]]) -> int:
    """用 ref 的列边界对齐时，有多少个格被迫并进同一列。

    碰撞数 > 0 说明 ref 的列分界太少 —— 这是「表头比数据行宽」造成的并格。
    """
    centers = [c[1] for c in ref]
    n = 0
    for row in rows:
        idxs = [_column_of(xc, centers) for _t, xc in row]
        n += len(idxs) - len(set(idxs))
    return n


def _unused_columns(rows: list[list[tuple[str, float]]], ref: list[tuple[str, float]]) -> int:
    """用 ref 的列边界对齐时，几列没有任何数据落进来。

    > 0 说明 ref 把一列切成几列（跨列标题被逐字切碎），不能当基准。
    """
    centers = [c[1] for c in ref]
    used = set()
    for row in rows:
        used.update(_column_of(xc, centers) for _t, xc in row)
    return len(centers) - len(used)


def _align_rows(rows: list[list[tuple[str, float]]]) -> list[list[str]]:
    """把逐行齐出的格子对齐成矩形网格。

    列基准取**格子最多的那一行**，用它每格的边界中点当列分界，其余行的
    格子按自己的中心 x 归位。为什么不取所有格中心做聚类：表格里空单元
    不产生字符，行内切出的格数因此少于列数，聚类会把相邻列的中心拉近，
    列数忽多忽少（实测格雷码表聚出 20 列，多出的 4 列是表头 `G?`、`G。`
    这些上标字符自己的中心）。用最宽行当基准是稳的 —— 最宽行就是
    「一个空格都没有」的那一行，它的格边界就是真实的列边界。

    右端的格若落在最后一个分界之外，归到最后一列（表头 `G?G?G?G。` 这种
    被合并的跨格 span 会这样）。
    """
    if not rows:
        return []
    # 基准行取**格数分布的众数**所对应的那一行。
    #
    # 试过两个更简单的判据，都被实测否决：
    # - 「格子最多的行」：跨列标题（`二进制码`）被逐行切格切成两半时，
    #   标题行反而比数据行多一格，拿它当基准会把整张表切歪。
    # - 「左右跨度最宽的行」：跨列标题横跨整页，跨度和数据行一样宽，
    #   平手时取到标题行，格雷码表从 16 列缩成 14 列（实测回归）。
    #
    # 众数稳的原因是：一张表里数据行总是占多数，标题行只有一两行。
    counts = [len(r) for r in rows if len(r) > 1]
    if not counts:
        # 只有一排格（或每行都只有一格）：没有可对齐的东西，原样返回
        return [[c[0] for c in r] for r in rows]
    mode = max(set(counts), key=lambda n: (counts.count(n), n))
    ref = next(r for r in rows if len(r) == mode)
    # 众数基准有个真实缺陷：**表头比数据行宽**时列会被并掉。
    # 实测印刷页 40 的表2.1.1 原书 4 列（基本定律 / 或 / 与 / 非），数据行
    # 大量只填 2–3 格（或、与两列有上下两行合并），众数是 3，于是
    # `A·A=A` 和 `A=A` 被并进同一列；印刷页 28 的 ASCII 表原书 9 列，
    # 众数 8，`001` 和 `010` 并成一格。
    #
    # 但**不能**无条件改用表头：有些表的表头是跨列标题被逐字切碎
    # （实测印刷页 361 的 `引|脚|功|能`），拿它当基准会造出一堆空列。
    # 只在同时满足三条时才换：
    #   ① 表头格数 > 众数；
    #   ② 用众数边界对齐时数据行有格**并进同一列**（碰撞 > 0，这是要修的缺陷）；
    #   ③ 用表头边界对齐时零碰撞且每列都有数据（这是能用的基准）。
    # 全书 158 张表里满足三条的有 5 张，逐张看过都是众数基准确实并了格。
    #
    # 表头不能直接取 rows[0]：表格带的上沿常带一行跨页残留
    # （实测印刷页 28 的 ASCII 表，带的首行是上一页表格的跨列表头 `b?b?bs`，
    # 只有 1 格；真正的表头 `b?b?b?b。|000|001|…|111` 在第二行）。
    # 取「首个众数行之前格数最多的那一行」—— 数据行之前的都是表头区。
    head = _header_row(rows, mode)
    if head is not None and len(head) > mode:
        data = rows[rows.index(head) + 1 :] or rows[1:]
        if _cells_collide(data, ref) > 0:
            if _cells_collide(data, head) == 0 and _unused_columns(data, head) == 0:
                ref = head
    centers = [c[1] for c in ref]
    bounds = [-1e9] + [(a + b) / 2 for a, b in zip(centers, centers[1:])] + [1e9]

    grid: list[list[str]] = []
    for row in rows:
        cells = [''] * len(ref)
        for text, xc in row:
            idx = len(ref) - 1
            for i in range(len(ref)):
                if bounds[i] <= xc < bounds[i + 1]:
                    idx = i
                    break
            cells[idx] += text
        grid.append(cells)
    return grid


def _split_row_cells(elems: list[dict[str, Any]]) -> list[tuple[str, float]]:
    """一行元素按「间距 > 宽度中位数 × 1.6」切开。

    入参可以是字符（`_chars_within` 的产物）也可以是 span（`_spans_of`
    的产物），两者都带 `bbox` 和 `text`。

    实测第 50 页：格子内字符间距约等于字宽（20pt 的字挨着排），格子之间
    空 40–70pt。1.6 倍落在两者之间。倍数不取 1.0 是因为下标、负号会和
    主字有轻微空隙；不取 3.0 是因为窄格（`0`）之间的空隙只有 3 倍字宽。
    """
    if not elems:
        return []
    cs = sorted(elems, key=lambda c: c['bbox'][0])
    widths = sorted(c['bbox'][2] - c['bbox'][0] for c in cs)
    med = widths[len(widths) // 2] or 10.0
    gap = med * 1.6

    cells: list[tuple[str, float]] = []
    cur: list[dict[str, Any]] = [cs[0]]
    prev = cs[0]
    for c in cs[1:]:
        if c['bbox'][0] - prev['bbox'][2] > gap:
            cells.append(_to_cell(cur))
            cur = [c]
        else:
            cur.append(c)
        prev = c
    cells.append(_to_cell(cur))
    return cells


def _to_cell(elems: list[dict[str, Any]]) -> tuple[str, float]:
    """一个格子的（文字, 中心 x）。中心取整格 x 跨度的中点。"""
    text = ''.join(e['text'] for e in elems)
    x0 = min(e['bbox'][0] for e in elems)
    x1 = max(e['bbox'][2] for e in elems)
    return text, (x0 + x1) / 2


def _looks_like_formula(text: str, size: float) -> bool:
    """公式判据：含数学符号，或大量单字符 token（上下标被拆开）。"""
    t = text.strip()
    if not t:
        return False
    if any(ch in _FORMULA_HINT for ch in t):
        return True
    tokens = t.split()
    if len(tokens) >= 4 and sum(1 for tok in tokens if len(tok) == 1) / len(tokens) > 0.6:
        return True
    # 编号式公式：(1.2.4)、式(4.1)
    return bool(t.endswith(')') and '(' in t and sum(ch.isdigit() for ch in t) >= 3)


def _table_bands(lines: list[list[dict[str, Any]]]) -> list[tuple[int, int]]:
    """
    找出页面里「哪些连续行构成表格」。返回 [(起行, 止行), …]（含端点）。

    判据：一行里 ≥3 个 span、且其中大部分是很短的 token（0/1/数字）、且横向
    铺得很开。真值表的每一行都满足；正文段落不满足（span 少、文本长）。

    为什么要按行找而不是整页判定：真值表常常只占页面中段（实测康华光
    第 50 页：表在 y=250..700，上面是表题、下面是说明文字）。整页当表会把
    填充率压到 0.24，直接判定失败。
    """
    flags = []
    for line in lines:
        if len(line) < 3:
            flags.append(False)
            continue
        short = sum(1 for s in line if len(s['text'].strip()) <= 4) / len(line)
        width = max(s['bbox'][2] for s in line) - min(s['bbox'][0] for s in line)
        flags.append(short >= 0.7 and width > 300)

    bands: list[tuple[int, int]] = []
    start: int | None = None
    for i, ok in enumerate(flags):
        if ok and start is None:
            start = i
        elif not ok and start is not None:
            # 允许中间夹单行噪声（表头换行、空行）
            if i - start >= 3:
                bands.append((start, i - 1))
            start = None
    if start is not None and len(flags) - start >= 3:
        bands.append((start, len(flags) - 1))
    return bands


def _extend_band_over_headers(
    lines: list[list[dict[str, Any]]],
    bands: list[tuple[int, int]],
    body: tuple[float, float] | None,
) -> list[tuple[int, int]]:
    """
    把紧贴在表注下面、却没被 `_table_bands` 收进去的**表头行**并进表格带。

    表头是 `二进制码 格雷码 二进制码 格雷码` 这种稍长的 token，不满足
    「短 token 占比 ≥ 0.7」，因此表格带常从表头**下面**那一行才开始。
    实测康华光 PDF 362（印刷页 340）的表7.1.4：表注在第 14 行，表头在
    第 15–18 行（`(A,A?A,A。)(D?D? D,D。)`、`(A4)(A?)`），表格带从第 19 行
    起，于是第 15–18 行漏进正文，变成 `CC(A,A?A,A。)(D?D? D,D。)…` 这种
    纯符号 chunk —— 既检索不到，又会被当正文引用。

    只往上找**表注**：撞到图注或正文句子就放弃扩展，避免把图注上面的图
    碎片或上一段正文并进表格。
    """
    out: list[tuple[int, int]] = []
    for a, b in bands:
        start = a
        j = a - 1
        # 最多看 8 行：表头不会比这更长
        while j >= 0 and a - j <= 8:
            t = ''.join(s['text'] for s in lines[j]).strip()
            if re.match(r'^表\s*\d+', t):
                start = j + 1
                break
            if _is_caption_line(lines[j], body):
                break
            has_cjk = any('\u4e00' <= ch <= '\u9fff' for ch in t)
            has_punct = any(ch in t for ch in '，。；！？')
            if has_cjk and has_punct and len(t) > 20:
                break
            j -= 1
        out.append((start, b))
    return out


def _caption_bands(
    lines: list[list[dict[str, Any]]],
    body: tuple[float, float] | None,
    taken: set[int],
) -> list[tuple[int, int]]:
    """
    以**表注**为锚补找表格带。

    `_table_bands` 靠「一行 ≥3 个 span 且短 token 占多数」找表，这对真值表
    有效，但漏掉两类：① 整行被 PDF 合并成一个 span（实测印刷页 88 的
    `100EN?`、`111A?`、`0×高阻` 各是一个 span，len(line) < 3 直接判 False）；
    ② 表头是 `工作模式内部锁存器状态` 这种长 token。
    实测全书 125 个表注里有 48 个所在页**一个表格 chunk 都没有**，
    内容退化成 `EN?使能EN输入A输出LA?100EN?111A?EN?·0×高阻` 这种读不出行列的字符串。

    补法：从表注往下逐行收，收的条件是「不像正文」（没有中文句读、长度 ≤ 40），
    撞上正文句子/图注/别的表注就停。收满 3 行才成带。
    """
    out: list[tuple[int, int]] = []
    for i, line in enumerate(lines):
        t = ''.join(s['text'] for s in line).strip()
        if not re.match(r'^表\s*\d+(?:[.\-]\d+)*', t):
            continue
        start = i + 1
        last = i
        j = start
        while j < len(lines) and j - start < 20:
            u = ''.join(s['text'] for s in lines[j]).strip()
            if not u:
                j += 1
                continue
            if re.match(r'^[表图]\s*\d', u) or _is_caption_line(lines[j], body):
                break
            # 正文句子：有中文也有句读，且超过 20 字。表里的说明性文字
            # （`使能和读锁存器(传送模式)`24 字）没有句读，不会被误判。
            #
            # 光靠「有中文 + 有句读 + 超 20 字」不够：表格格子里常有 OCR 噪声
            # 句读。实测印刷页 416 的 `阈值输人(vμ)触发输入(vz)复位(R。)输出(vo)放电管T`
            # 因为那个 `R。`（本该是 R_D）被当正文，整张 555 定时器功能表没成带。
            # 印刷页 60 的 `real64位带符号的实数型变量，默认值为0` 同理。
            # 再要求「满宽且 span 少」才算正文 —— 正文两端对齐、一行通常一个 span，
            # 表格行不满宽（实测 p.82 表格行 0.58–0.73、正文 0.93）或切成多个 span。
            has_cjk = any('\u4e00' <= ch <= '\u9fff' for ch in u)
            has_punct = any(ch in u for ch in '，。；！？')
            cur = lines[j]
            if has_cjk and has_punct and len(u) > 20 and len(cur) <= 2:
                if body is None:
                    break
                x0 = min(s['bbox'][0] for s in cur)
                x1 = max(s['bbox'][2] for s in cur)
                if (x1 - x0) / (body[1] - body[0]) >= 0.85:
                    break
            # 表格结束后的正文续行：上一行没有句读、这一行是段落末行时，
            # 上面那条「满宽 ≥0.85」判据接不住。实测印刷页 40 的表2.1.1：
            # 第 24 行 `对表2.1.1所示定律和定理的证明方法是：列出…` 只有全角
            # 冒号（不在 `，。；！？` 里），第 25 行 `的真值表，…说明等式成立。`
            # 是段落末行、行宽比只有 0.71，两行都被当成表格内容，整张表从
            # 4 列挤成 3 列，还多出 6 行伪表行。
            #
            # 改用「单 span + 中文密集 + 不满窄」：正文一行通常就是一个 span，
            # 且中文 ≥8 字；表格数据行要么切成多个 span，要么中文很少
            # （实测该表数据行中文 0–5 字）。
            #
            # 前 3 行豁免 —— 表头可能满宽且中文密集（实测印刷页 416 的表头
            # `阈值输人(vμ)触发输入(vz)复位(R。)输出(vo)放电管T` 有 14 个汉字、
            # 占满整行），表头永远紧贴表注，正文永远在表尾。
            cjk_count = sum(1 for ch in u if '\u4e00' <= ch <= '\u9fff')
            if last - start + 1 >= 3 and len(cur) <= 1 and cjk_count >= 8:
                if body is None:
                    break
                x0 = min(s['bbox'][0] for s in cur)
                x1 = max(s['bbox'][2] for s in cur)
                if (x1 - x0) / (body[1] - body[0]) >= 0.6:
                    break
            # 图注也要停：实测印刷页 88 的表3.1.4 紧下面就是
            # `图3.1.25 三态输出门`，不停会把图注收进表格格子里。
            if _is_caption_line(lines[j], body):
                break
            if j in taken:
                break
            last = j
            j += 1
        if last - start + 1 >= 3:
            out.append((start, last))
    return out


def _group_lines(spans: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """
    按 y 把 span 聚成视觉行。

    容差不能写死。实测康华光第 50 页：span 高度中位数 38.5pt，表行间距
    32–37pt，**同一行内**的 y 因上下标差 4–5pt。原来用固定 6pt 且与
    「本行第一个 span」比较，排序时 y 单调上升会让基准一路漂移，把
    `0000000010001100` 和紧随其后的 `11` 拆成两行；拆出的碎片 span 数
    不足 3，躲过表格判据，于是被当正文抽出来（就是 `$ENQNAK%5UuEF` 那种）。

    现在用行高的 0.4 倍作容差（38.5 × 0.4 ≈ 15pt），介于「行内波动 5」
    与「行间距离 32」之间，两头都留了余量；比较对象改成**当前行的均值**，
    避免漂移。
    """
    if not spans:
        return []
    heights = sorted(s['bbox'][3] - s['bbox'][1] for s in spans)
    median_h = heights[len(heights) // 2]
    tol = min(max(median_h * 0.4, 4.0), 20.0)

    lines: list[list[dict[str, Any]]] = []
    for s in sorted(spans, key=lambda s: (s['y'], s['x'])):
        if lines:
            center = sum(m['y'] for m in lines[-1]) / len(lines[-1])
            if abs(s['y'] - center) <= tol:
                lines[-1].append(s)
                continue
        lines.append([s])
    for line in lines:
        line.sort(key=lambda s: s['x'])
    return lines


def _looks_like_heading(text: str) -> bool:
    """
    标题的字面判据。字号大只是必要条件 —— 这本书里**演算步骤**也用大字号
    （实测第 40 页「29 ⋯⋯⋯⋯⋯⋯余1⋯⋯b,」比正文还大），只看字号会把
    竖式除法算成五个标题。

    真标题的样子：以编号开头（`1.2 数制`、`3.5.1正负逻辑问题`），或是
    「小结 / 习题 / 目录 / 复习思考题」这类单行标签。
    """
    t = text.strip()
    if not t:
        return False
    if len(t) > 40:
        return False
    # 带省略号/余数记号的是竖式演算，不是标题
    if '⋯' in t or '余' in t:
        return False
    if re.match(r'^\d+(\.\d+)*\s*[\u4e00-\u9fff]', t):
        return True
    return t in {'小结', '习题', '目录', '复习思考题', '本章小结'} or t.startswith('第') and t.endswith('章')


def _looks_like_caption(text: str) -> bool:
    """图注：`图` + 编号 + **至少一个空格** + 标题。

    实测康华光的图注：`图8.4.6  由555定时器组成的可重复触发的单稳电路`，
    编号与标题之间是两个空格；紧跟下一行可能是 `(a)电路图  (b)工作波形`。

    标题可以以中文、拉丁字母或**数字**开头：
    - 拉丁字母：实测 p.52 有 `图2.2.7  L(A,B,C,D)的卡诺图图2.2.8  例2.2.3的卡诺图`
      （两个图注粘成一行），只认中文开头会漏掉它，而它是判断这一带是图不是表的关键。
    - 数字：实测 p.155 有 `图4.4.21  74HC151的逻辑图`，标题以芯片型号开头。

    另外接受 `图题X.Y.Z` —— 习题图用的是「图题」而不是「图」。

    **句读黑名单是被实测推翻的旧判据，不要再加回来。** 早先版本只要行里出现
    `，。、；：！？` 就否决，理由是「正文里也有大量以图号开头的句子」；但全书
    266 条以图号开头的行逐条看过之后：被判为「正文」的那 11 条几乎都是真图注
    （`…的逻辑图、逻辑符号和引脚图`、` Spartan-Ⅱ、Virtex系列…`、`第j列，第i行的…`），
    而真正的正文 `图1.1.1所示为转换过程中各种波形图，…` 的图号后面**没有空格**。
    也就是说区分「图注 / 正文」靠的是那个空格，不是标点。旧判据把 p.142 的
    `图4.4.4  优先编码器CD4532的逻辑图、逻辑符号和引脚图` 判成正文，整页图区域
    识别失败，二十多行图碎字（`I2&`/`Yo`/`Gs`）全漏进了正文 chunk。
    """
    t = text.strip()
    if not t or len(t) > 60:
        return False
    if re.match(r'^图题\s*\d+(?:[.\-]\d+)*', t):
        return True
    return bool(re.match(r'^图\s*\d+(?:[.\-]\d+)*\s{1,4}[A-Za-z0-9\u4e00-\u9fff]', t))


def _looks_like_subcaption(text: str) -> bool:
    """子图说明：`(a)电路图  (b)工作波形`。

    这本书的图注是两行：主注 `图8.4.6 由555定时器…`，下一行是子图标签。
    不把子图行并进图注的话，它会和紧随其后的正文粘成一句（实测第 442 页
    产出 `(a)电路图  (b)工作波形的低电平可用作报警信号。` —— 前半是图注，
    后半是上一段被图截断后的续句）。
    """
    return bool(re.match(r'^\s*[（(]\s*[a-zA-Z]\s*[）)]', text))


def _page_body_edges(lines: list[list[dict[str, Any]]]) -> tuple[float, float] | None:
    """本页正文的左右边界，用长行的最小左沿与最大右沿估计。

    只取长度 > 30 的行 —— 图碎字、页码、公式都是短行，会把边界拉歪。
    """
    long_lines = [ln for ln in lines if len(''.join(s['text'] for s in ln)) > 30]
    if not long_lines:
        return None
    left = min(ln[0]['bbox'][0] for ln in long_lines)
    right = max(max(s['bbox'][2] for s in ln) for ln in long_lines)
    if right - left <= 0:
        return None
    return left, right


def _is_caption_line(line: list[dict[str, Any]], body: tuple[float, float] | None) -> bool:
    """这一行是不是图注 —— 字面判据 **且** 版式判据。

    版式判据是必需的：这本书有大量图注**图号与标题之间不带空格**
    （`图1.1.2数字波形`、`图6.5.6实现多种功能双向移位寄存器的一种方案`），
    而正文句子同样不带空格（`图1.1.1所示为转换过程中各种波形图，…`），
    字面判据分不开这两者。

    分开它们的是**版式**：图注是独立居中且不满宽的行，正文是两端对齐的满宽行。
    实测全书 425 条以图号开头、图号后无空格的行：
    「居中（左右缩进差 ≤ 40pt）且行宽 < 正文宽的 0.75」接受 231 条，逐条看过
    全是图注；被拒的 194 条里满宽（≥ 0.9）的全是正文句子。
    """
    text = ''.join(s['text'] for s in line).strip()
    if not text:
        return False
    # 带空格或有「图题」前缀的，字面判据已经足够 —— 正文句子的图号后面没有空格。
    if _looks_like_caption(text):
        return True
    # 剩下的是「图号与标题之间无空格」的形态，字面判据分不开图注与正文，
    # 只能靠版式。没有正文边界可参考时（合成页、纯图页）一律不认。
    if body is None:
        return False
    if not re.match(r'^图\s*\d+(?:[.\-]\d+)*[^\s\d]', text):
        return False
    left, right = body
    x0 = min(s['bbox'][0] for s in line)
    x1 = max(s['bbox'][2] for s in line)
    indent_left, indent_right = x0 - left, right - x1
    width_ratio = (x1 - x0) / (right - left)
    # 居中判据只在「单栏满宽排版」下成立。这本书有图文并排的页
    # （实测 p.98：`图3.2.9  0C门` 在 x=1035..1231，图在左、正文在右），
    # 图注跟它自己的图对齐而不是跟页面居中对齐，居中差能到 759pt。
    # 所以放行两种：居中，或「明显比正文窄且不贴着正文左沿」。
    centered = abs(indent_left - indent_right) <= 40
    narrow = width_ratio < 0.75
    # 侧栏图注：宽度 < 0.4 且左缩进 > 正文宽的 0.3
    sidebar = width_ratio < 0.4 and indent_left > (right - left) * 0.3
    if not (narrow and (centered or sidebar)):
        return False
    # 版式像图注之后，再排除「所示/如图」这类正文措辞。
    # 满宽的正文就被 narrow 挡掉了，这里只兜住恰好在页面中间的短句。
    return not any(w in text for w in ('所示', '如图', '见图', '参见'))


def _looks_like_prose_line(
    line: list[dict[str, Any]], text: str, body: tuple[float, float] | None
) -> bool:
    """这一行是不是「正文」——图区域向上收碎字时遇到它就该停。

    只看全角句读（`，。、；：！？`）不够：PDF 换行会把句子切断，多数正文行
    根本不以句号结尾，而排印里的小数点与逗号常是半角的。实测印刷页 96 的
    正文行 `=0.9 V,该电压作用于T,的集电结和` 只有一个半角逗号，被判成
    图内碎字吞进图区域，这一行从产物里整段消失（句子级核对抓到的就是它）。

    分开正文与图内标签的是**版式**：正文贴着正文左沿起排，图内标签不会
    （图自己在右栏或居中）。实测全书图区域里含 ≥4 汉字的 327 行，缩进
    ≤10pt 的 17 行里 15 行是正文，其余是图内标签；缩进 >20pt 的一律是
    图内标签（`工作点负载曲线工作点` 缩进 21、`CPL几几几几LLLLL` 缩进 24）。
    """
    if not any('\u4e00' <= ch <= '\u9fff' for ch in text):
        return False
    if body is None:
        return False
    left, _right = body
    x0 = min(s['bbox'][0] for s in line)
    if x0 - left > 20:
        return False
    # 贴左沿但含半角句读的，是排印里的正文（图内标签不会带 `,;:`）
    return any(ch in text for ch in ',;:')


def _figure_regions(
    lines: list[list[dict[str, Any]]],
    page: pymupdf.Page,
    block_lines: set[int] | None = None,
) -> list[tuple[int, int, tuple[float, float, float, float]]]:
    """找图：以图注行为锚点，向上吃掉属于这张图的碎字。

    这本书的图是**扫描进整页位图**的（实测 `get_image_info()` 每页只有
    一个覆盖整页的 1984×2656 位图，`get_drawings()` 返回 0），所以拿不到
    图的矢量边界。但图里的文字（`Vcc`、`t_w`、`0.01μF`、`(a)`）会以
    孤立短行散落在文字层里 —— 它们本来就是图的一部分，被当正文抽出来
    只会污染检索。

    做法：图注行往上，只要行是「短、孤立、不含中文句子」就并入图区域；
    遇到正文行（长、含句读）停止。返回 [(起行, 止行, 裁剪 bbox)]。

    `block_lines` 是不许并进图区域的行号（表格带、公式行）。没有这道闸
    时图区域会一路吃穿表格：实测表格 chunk 从 160 个掉到 117 个。
    """
    blocked = block_lines or set()
    body = _page_body_edges(lines)
    out: list[tuple[int, int, tuple[float, float, float, float]]] = []
    # 所有图注行的行号。向上收碎字时不能越过别的图注 —— 一页上有多个图时
    # （实测 PDF 131 有 4 个：图3.5.1/3.5.2/3.5.3/3.5.4），后一个图的扩展
    # 会把前一个图的图注连同它的图一起吞掉，结果 4 个图只出 2 个块。
    caption_lines = {i for i, ln in enumerate(lines) if _is_caption_line(ln, body)}
    for i, line in enumerate(lines):
        if i not in caption_lines:
            continue

        # 往上收碎字。停止判据是**真的中文正文句子**，不是「长度大」。
        # 只看长度会漏掉图内的英文标尺：实测第 522 页波形图的顶部标尺
        # `500.0 us 4.5 ms8.5 ms…` 去空白后 51 字符但没有中文，被当正文
        # 截断，于是 24 行图碎字进了正文 chunk。
        #
        # 窗口上限 30 行是给「图注上方紧接正文」的页留的余量，但整页大图会超：
        # 实测 p.312 的 GAL16V8 逻辑结构图占满整页，图注在第 40 行，
        # 30 行窗口在第 10 行就被截断，前 10 行碎字（`OLMC`/`719`/`10348]1215`）
        # 全漏进正文。改成 60 行 —— 本书最长的一页图是 45 行。
        top = i
        for j in range(i - 1, -1, -1):
            if i - j > 60:
                break
            if j in blocked or j in caption_lines:
                break
            t = ''.join(s['text'] for s in lines[j]).strip()
            has_cjk = any('\u4e00' <= ch <= '\u9fff' for ch in t)
            has_punct = any(ch in t for ch in '，。、；：！？')
            if has_cjk and has_punct:
                break
            if _looks_like_prose_line(lines[j], t, body):
                break
            top = j
        if top >= i:
            # 图注上方紧接正文或表格带（实测 PDF 71 行 3：`图2.2.1 一变量
            # 卡诺图` 上面两行是被误判成表格带的图本体；PDF 37 行 26：图本体
            # 在上一页）。此时没有可收的碎字，但图注本身必须留下 —— 它是
            # 唯一能检索到这张图的文本。丢掉会让全书少 36 个图。
            out.append((i, i - 1, _caption_box(line)))
            continue

        region = [s for ln in lines[top:i] for s in ln]
        if not region:
            # 图本体在上一页，图注落在本页顶部（实测 PDF 第 37 页：
            # `图1.2.1 用二进制数表示0～15波形图` 上方紧接正文）。
            # 这种「只有图注、没有图」的情况仍要出一个 figure 块 —— 图注
            # 本身就是有用的检索文本，丢掉它等于这本书缺了 45 个图。
            out.append((i, i - 1, _caption_box(line)))
            continue
        clip = (
            min(s['bbox'][0] for s in region) - 8,
            min(s['bbox'][1] for s in region) - 8,
            max(s['bbox'][2] for s in region) + 8,
            max(s['bbox'][3] for s in region) + 8,
        )
        # 区域太窄说明只是几个零散短行，不是一张图
        if clip[2] - clip[0] < 120 or clip[3] - clip[1] < 100:
            # 同上：留图注，不丢
            out.append((top, i - 1, _caption_box(line)))
            continue
        out.append((top, i - 1, clip))
    return out


def _caption_box(line: list[dict[str, Any]]) -> tuple[float, float, float, float]:
    return (
        min(s['bbox'][0] for s in line),
        min(s['bbox'][1] for s in line),
        max(s['bbox'][2] for s in line),
        max(s['bbox'][3] for s in line),
    )


def extract_page(page: pymupdf.Page, page_index: int) -> list[Block]:
    """抽一页。返回按阅读顺序排好的块。"""
    spans = _spans_of(page)
    if not spans:
        return []

    # 先按 y 分行，行内按 x 排序 —— 这是阅读顺序，也是后续分块的基础
    lines = _group_lines(spans)

    bands = _table_bands(lines)
    # 以表注为锚补齐 `_table_bands` 漏掉的表（整行被合并成一个 span、
    # 或表头全是长 token）。已在带里的行不重复收。
    taken = {li for a, b in bands for li in range(a, b + 1)}
    anchored: set[int] = set()
    for ca, cb in _caption_bands(lines, _page_body_edges(lines), taken):
        if len(set(range(ca, cb + 1)) & taken) == 0:
            anchored.add(len(bands))
            bands.append((ca, cb))
    bands.sort()
    # 排序后下标会变，用「起始行」重新标定。以表注为锚的带**一定是真表**，
    # 后面判伪表时必须豁免 —— 实测印刷页 88 的表3.1.4 正下方就是
    # `图3.1.25 三态输出门`，按最近的注判定会被当成伪表让图吃掉。
    anchored_starts = {bands[i][0] for i in anchored if i < len(bands)}
    bands = _extend_band_over_headers(lines, bands, _page_body_edges(lines))
    band_of_line: dict[int, int] = {}
    for bi, (a, b) in enumerate(bands):
        for li in range(a, b + 1):
            band_of_line[li] = bi

    # 每个表格区域单独还原一次
    band_rows: dict[int, list[list[str]]] = {}
    band_fill: dict[int, float] = {}
    for bi, (a, b) in enumerate(bands):
        region = [s for line in lines[a : b + 1] for s in line]
        recon = _reconstruct_table(region, page)
        if recon is not None:
            band_rows[bi], band_fill[bi] = recon

    # 图区域：图注行 + 它上方那些属于图的碎字，整段吞掉，出一个 figure 块。
    #
    # 表格带里有一类是**伪表格**：电路图/波形图/卡诺图被 `_table_bands` 的
    # 短 token 判据误判成表（实测 `A& | A& | A&` 是门电路符号、`L | D | D | L`
    # 是卡诺图）。它们紧邻的是**图注**而不是表注。让图把这些带吃掉。
    #
    # 真表格不能吃（会让 table chunk 从 160 掉到 117，实测过）。区分办法：
    # 看每个带**最近**的注是表注还是图注 —— 不能只看「附近有没有表注」，
    # 一页上表和图并排时两者都「有」，实测 p.284 的两个带就都判成了真表，
    # 上面那个带（`FFm|FFm|FF,m+1`、`Dm-11D`，是移位寄存器的电路图）
    # 于是以空表格的形式留在产物里，格子里那些 token 反而漏进了正文。
    pseudo_bands: set[int] = set()
    body = _page_body_edges(lines)

    def _fragment_like(j: int) -> bool:
        """这一行像不像图里的碎字（`C1`、`Ra`、`G?G?`、`15VREP②6`）。

        判据刻意只管「短、无中文、无句读」—— 正文行至少三十来字且带标点，
        表注行以「表」开头，两者都不会被误认成碎字。
        """
        if not (0 <= j < len(lines)):
            return False
        t = ''.join(s['text'] for s in lines[j]).strip()
        if not t or len(t) > 14:
            return False
        if re.match(r'^[图表]\s*\d', t):
            return False
        if any('\u4e00' <= ch <= '\u9fff' for ch in t):
            return False
        return not any(ch in t for ch in '，。；：！？、')

    for a, b in bands:
        # 以表注为锚找到的带一定是真表，直接放行。实测印刷页 88 的
        # 表3.1.4 正下方就是图3.1.25 的图注，按「最近的注」会被判成伪表。
        if a in anchored_starts:
            continue
        # 判据一：这个带上下紧贴的都是图里的碎字。真表格不会长在碎字堆里 ——
        # 它的上下要么是表注、要么是正文、要么是同一张表的另一个带。
        # 实测 p.470 的并行 A/D 转换器图占了第 8–43 行，中间三段被
        # `_table_bands` 判成表格带（(14,16)、(18,20)、(32,34)），
        # 三段的上下全是 `C1`/`Ra`/`15VREP②6` 这种单 token 行。
        if _fragment_like(a - 1) and _fragment_like(b + 1):
            has_table_cap = any(
                re.match(r'^表\s*\d+', ''.join(s['text'] for s in lines[j]).strip())
                for j in range(max(0, a - 5), min(len(lines), b + 6))
                if not (a <= j <= b)
            )
            if not has_table_cap:
                for li in range(a, b + 1):
                    pseudo_bands.add(li)
                continue

        # 判据二：往上/往下找最近的注。真表最近的是表注，伪表最近的是图注。
        # 不能只看「附近有没有表注」—— 一页上表和图并排时两者都「有」，
        # 实测 p.284 的两个带就都判成了真表，上面那个带（移位寄存器的电路图）
        # 于是以空表格的形式留在产物里，格子里那些 token 反而漏进了正文。
        nearest = None
        for dist in range(1, 9):
            # 同一距离上**先看表注再看图注**：表注只是「带上面一行写着表X.Y.Z」，
            # 它指的就是这个带；图注可能属于带下面另一张图。实测印刷页 475
            # 的表10.2.2 在带上行、图10.2.11 在带下行，先看图注就判成了伪表。
            for j in (a - dist, b + dist):
                if not (0 <= j < len(lines)):
                    continue
                t = ''.join(s['text'] for s in lines[j]).strip()
                if re.match(r'^表\s*\d+', t):
                    nearest = 'table'
                    break
                if _is_caption_line(lines[j], body):
                    nearest = 'figure'
                    break
            if nearest:
                break
        if nearest == 'figure':
            for li in range(a, b + 1):
                pseudo_bands.add(li)

    blocked = set(band_of_line) - pseudo_bands
    fig_regions = _figure_regions(lines, page, blocked)
    fig_of_line: dict[int, int] = {}
    # 每个图区域「最后一行」的行号（含图注与其后的子图说明）。出块时要把
    # 这些文字收进 figure 的 text —— 实测只取图注那一行会丢掉子图说明，
    # 例如 `(a)OD与非门的输出级(b)符号 (c)输出线与连接图`。这些字既不在
    # 正文里（已被吞进图区域），也不在图注里，于是从产物里整段消失。
    fig_last: dict[int, int] = {}
    for fi, (a, b, _clip) in enumerate(fig_regions):
        for li in range(a, b + 1):
            fig_of_line[li] = fi
        # 图注行（b+1）与紧随其后的子图说明行（b+2 起）
        last = b + 1
        while last + 1 < len(lines) and _looks_like_subcaption(''.join(s['text'] for s in lines[last + 1])):
            last += 1
        fig_last[fi] = last
        for li in range(b + 1, last + 1):
            fig_of_line[li] = fi

    blocks: list[Block] = []
    buf: list[dict[str, Any]] = []

    # 正文基准字号：按「字符数加权的中位数」。不用 max、不用中位数本身，
    # 因为标题页码这些小样本会把无权重中位数拉偏。
    weighted: list[float] = []
    for s in spans:
        weighted.extend([s['size']] * max(1, len(s['text'].strip())))
    weighted.sort()
    body_size = weighted[len(weighted) // 2]
    heading_size = body_size * _HEADING_RATIO

    def flush() -> None:
        nonlocal buf
        if not buf:
            return
        text = ''.join(s['text'] for s in buf).strip()
        if text:
            x0 = min(s['bbox'][0] for s in buf)
            y0 = min(s['bbox'][1] for s in buf)
            x1 = max(s['bbox'][2] for s in buf)
            y1 = max(s['bbox'][3] for s in buf)
            size = max(s['size'] for s in buf)
            kind = 'formula' if _looks_like_formula(text, size) else 'paragraph'
            level = 0
            # 页眉/页脚（页码）不该被当成标题：它们孤立、极短、且贴着页面上下缘。
            # 实测康华光的页码形如 `●  8  ●`、`22`、`18 ·`，字号和标题一样大，
            # 只看字号会误判成 heading。
            is_furniture = len(text) <= 6 and (
                (y0 < 120 or y1 > 1800) and not any(ch.isalpha() for ch in text)
            )
            if size >= heading_size and not is_furniture and _looks_like_heading(text):
                kind = 'heading'
                ratio = size / body_size
                level = 3 if ratio >= 1.6 else 2 if ratio >= 1.4 else 1
            blocks.append(Block(kind=kind, page=page_index, bbox=(x0, y0, x1, y1), text=text, level=level))
        buf = []

    for li, line in enumerate(lines):
        text = ''.join(s['text'] for s in line).strip()
        if not text:
            continue
        size = max(s['size'] for s in line)

        # 落在图区域里 → 整段吞掉，在图注行位置出一个 figure 块。
        # 图里的 `Vcc`、`t_w`、`(a)` 这些字是图的组成部分，当正文抽出来
        # 既不可读也会污染检索（实测第 442 页有 24 行这样的碎字）。
        fig = fig_of_line.get(li)
        if fig is not None:
            if fig_of_line.get(li - 1) != fig:
                flush()
                fa, fb, clip = fig_regions[fig]
                # 图注 + 其后的子图说明，两行都要收进来。只取图注会丢掉
                # `(a)OD与非门的输出级(b)符号 (c)输出线与连接图` 这类说明，
                # 而这些字已经从正文里被吞掉了 —— 不在这里收就彻底消失。
                caption = ' '.join(
                    ''.join(s['text'] for s in lines[k]).strip()
                    for k in range(fb + 1, fig_last[fig] + 1)
                    if k < len(lines)
                ).strip()
                blocks.append(
                    Block(
                        kind='figure',
                        page=page_index,
                        bbox=clip,
                        text=caption,
                        clip=clip,
                    )
                )
            continue

        # 落在已识别的表格区域里 → 整段作为一个表格块输出，逐行不再拆。
        # 网格还原失败（band 不在 band_rows 里）时也必须吞掉这些行：让它们
        # 退回正文会和相邻段落粘成一句（实测 `$ENQNAK%5UuEF` 就是这么来的）。
        band = band_of_line.get(li)
        if band is not None:
            if band_of_line.get(li - 1) != band:
                flush()
                a, b = bands[band]
                region = [s for ln in lines[a : b + 1] for s in ln]
                raw = ''.join(s['text'] for s in region).strip()
                bbox = (
                    min(s['bbox'][0] for s in region),
                    min(s['bbox'][1] for s in region),
                    max(s['bbox'][2] for s in region),
                    max(s['bbox'][3] for s in region),
                )
                if band in band_rows:
                    blocks.append(
                        Block(
                            kind='table',
                            page=page_index,
                            bbox=bbox,
                            rows=band_rows[band],
                            fill=band_fill.get(band, 0.0),
                        )
                    )
                else:
                    # 还原不出网格说明这块本来就不是表（实测 p.436 是三个
                    # 连排的多行公式，被短 token 判据当成了表带）。仍要吞掉
                    # 这些行——退回正文会和相邻段落粘成一句——但按内容定性，
                    # 不要吐一个空的 table。
                    kind = 'formula' if _looks_like_formula(raw, max(s['size'] for s in region)) else 'paragraph'
                    blocks.append(
                        Block(kind=kind, page=page_index, bbox=bbox, text=raw)
                    )
            continue

        # 标题：字号比本页正文大 25% 以上，**且字面上像标题**。
        # 只看字号不够：这本书的竖式演算也用大字号，会把「29 ⋯⋯ 余1」之类
        # 判成五个标题（实测第 40 页）。
        if size >= heading_size and _looks_like_heading(text):
            flush()
            ratio = size / body_size
            level = 3 if ratio >= 1.6 else 2 if ratio >= 1.4 else 1
            blocks.append(
                Block(
                    kind='heading',
                    page=page_index,
                    bbox=(
                        min(s['bbox'][0] for s in line),
                        min(s['bbox'][1] for s in line),
                        max(s['bbox'][2] for s in line),
                        max(s['bbox'][3] for s in line),
                    ),
                    text=text,
                    level=level,
                )
            )
            continue

        buf.extend(line)
        # 行尾是句号/问号、或下一行缩进明显 → 断段
        if text.endswith(('。', '？', '！', '：')):
            flush()
    flush()
    return blocks


def extract_pdf(path: str, first: int = 0, last: int | None = None) -> list[Block]:
    doc = pymupdf.open(path)
    end = doc.page_count if last is None else min(last, doc.page_count)
    out: list[Block] = []
    for i in range(first, end):
        out.extend(extract_page(doc[i], i))
    return out
