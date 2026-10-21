"""票 17 的单元测试：OCR 版式规则、页码配对、断点续跑、不丢页。

这里刻意**不**跑真 OCR —— 引擎在 CI 上不一定装得上，而且一页就要 3 秒。
测的是「拿到行之后怎么判版面 / 怎么配页码 / 怎么落盘」这几段纯逻辑，输入
用真实识别结果摘出来的行（坐标、置信度都照抄实测）。

真·端到端产物（chunks.jsonl、ocr/pages.jsonl 等）由 `test_ocr_artifacts.py`
在有产物时再验一遍。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from ocr import (  # noqa: E402
    CACHE_VERSION,
    REVIEW_THRESHOLD,
    OcrEngine,
    OcrLine,
    OcrPage,
    OcrSessionError,
    _assign_nums,
    _clamp_pages,
    _merge_toc_band,
    _page_number_lines,
    _parse_page_number,
    _starts_figure,
    _toc_denoise,
    _toc_page_number,
    boxes_to_blocks,
    detect_page_offset,
    apply_review_threshold,
    choose_review_threshold,
    load_page,
    ocr_page,
    parse_toc_ocr,
    render_page,
    resolve_page_offsets,
    save_page,
    summarize,
    write_page_artifacts,
)


def L(text: str, x0: float, y0: float, x1: float, y1: float, conf: float = 0.9) -> OcrLine:
    return OcrLine(text=text, conf=conf, x0=x0, y0=y0, x1=x1, y1=y1)


# ---------------------------------------------------------------- 页码识别

@pytest.mark.parametrize(
    'raw,expected',
    [
        ('47', 47),          # 纯数字
        ('· 47 ·', 47),      # 老式页码两侧的装饰点
        ('- 12', 12),
        (':48:', 48),        # 实测 p61 认回来的形状
        ('........1', 1),    # 引导点 + 页码被并成一个框（长度上限就是为它放宽的）
        ('(357)', 357),      # 18/19 两本的括号页码（半角）
        ('（194）', 194),     # 同一批书的全角括号
        ('( 194 )', 194),    # 括号内侧带空格
        ('2.2.17', None),    # 公式号，不是页码
        ('图3.4', None),     # 图注号
        ('(2.2.17)', None),  # 加了括号的公式号仍然是公式号
        ('第五章', None),
        ('', None),
    ],
)
def test_parse_page_number_accepts_only_real_page_numbers(raw: str, expected: int | None) -> None:
    """页码判定必须同时挡住公式号和图注号，否则 `printed_page` 会混进 `(2.2.17)`。"""
    assert _parse_page_number(raw) == expected


@pytest.mark.parametrize(
    'raw,expected',
    [
        ('357', 357),
        ('(357)', 357),      # 18《原子核物理实验方法》行尾括号页码
        ('(194 )', 194),     # 19《核辐射探测器及其实验技术手册》
        ('（194）', 194),
        ('........1', 1),
        ('(2.2.17)', None),
        ('第五章', None),
    ],
)
def test_toc_page_number_accepts_parenthesised_form(raw: str, expected: int | None) -> None:
    """目录列里的页码：18/19 两本没有独立页码列，页码是行尾括号。

    这两本 `_band_from_lines` 量不出带子（返回 None），完全靠整页识别 + 这条
    正则；不接受括号它们会一条页码都配不上。
    """
    assert _toc_page_number(raw) == expected


def test_page_number_lines_only_looks_in_top_and_bottom_bands() -> None:
    """页眉页脚带以外出现的数字不算页码 —— 正文里的 `300` 不能当页号。"""
    height = 2000.0
    lines = [
        L('· 47 ·', 1600, 30, 1700, 60),       # 页眉带内（y0/h = 0.015）
        L('287', 900, 1930, 960, 1960),        # 页脚带内（y0/h = 0.965）
        L('300', 400, 1000, 470, 1030),        # 正文中间 → 不算
    ]
    got = _page_number_lines(lines, height, band=0.12)
    assert sorted(v for _, v in got) == [47, 287]


# ---------------------------------------------------------------- 表格
#
# 扫描件的表格是**逐格独立的 OCR 行**（一个格子一行），所以靠空格切列的老
# 判据在 5800 页里命中 0 次。现在的两个信号是：表题做锚点、x0 几何聚列。
# 下面的坐标全部摘自 `data/ocr-cache/.../v4/page-NNNN.json` 的真实识别结果
# （王芝英 p20 表 1.3、p30 表 1.5、p223 表 5.1）。

def test_table_found_from_caption_anchor() -> None:
    """表题下一段的格子必须聚成一张表：4 行 4 列，表题留在 text 里。

    真实数据：王芝英 p20 的「表1.3 线性响应指标」，每行 3 个独立格子；
    表下方紧跟 `5.稳定性` 小节标题，不能把它吞成表格的最后一行。
    """
    lines = [
        L('表1.3 线性响应指标', 279, 1100, 800, 1135),
        L('气体探测器', 279, 1194, 452, 1226),
        L('小于0.01%', 589, 1194, 735, 1227),
        L('固能量分辨率为1%，后级线性应为0.1%', 869, 1197, 1403, 1224),
        L('半导体探测器', 278, 1258, 454, 1292),
        L('0.015%', 616, 1259, 720, 1287),
        L('作高能量分辨测量时，要求后级线性为0.01%', 868, 1258, 1449, 1289),
        L('闪烁计数器', 279, 1320, 455, 1354),
        L('1 -- 5 %', 609, 1321, 724, 1352),
        L('线性要求一般，性约为1%左右', 867, 1320, 1305, 1351),
        L('5.稳定性', 280, 1386, 456, 1426),
    ]
    blocks, _ = boxes_to_blocks(lines, page=20, width=1740, height=2187)
    tables = [b for b in blocks if b.kind == 'table']
    assert len(tables) == 1
    t = tables[0]
    assert t.text.startswith('表1.3')
    assert len(t.rows) == 3
    assert t.rows[0][0] == '气体探测器'
    assert t.rows[0][1] == '小于0.01%'
    assert t.rows[0][2].startswith('固能量分辨率')
    # 小节标题不能被当作表格行了
    assert all('稳定性' not in cell for row in t.rows for cell in row)
    assert any(b.kind == 'paragraph' for b in blocks)


def test_table_caption_sharing_row_with_formula_still_anchors() -> None:
    """表题与左侧公式聚成同一视觉行时，仍要认出表题。

    王芝英 p30 的 `表1.5 常用脉冲信号的傅氏变换…` 与 `h(t) =h (t) *h2(t) *h3 (t)`
    的 y0 相差不到半个行高，整行拼接后行首是公式，全行匹配永远失败。
    """
    lines = [
        L('h(t) =h (t) *h2(t) *h3 (t)', 209, 714, 732, 755),
        L('表1.5常用脉冲信号的傅氏变换和拉氏变换', 908, 720, 1486, 756),
        L('信号名称', 943, 773, 1037, 801),
        L('信号波形', 1097, 772, 1192, 802),
        L('傅氏变换和拉氏变换', 1229, 775, 1495, 798),
        L('单位阶跃脉冲', 943, 826, 1039, 860),
        L('1/s', 1288, 867, 1318, 893),
    ]
    blocks, _ = boxes_to_blocks(lines, page=30, width=1740, height=2187)
    tables = [b for b in blocks if b.kind == 'table']
    assert len(tables) == 1
    assert tables[0].text.startswith('表1.5')
    assert len(tables[0].rows) >= 2


def test_table_caption_does_not_swallow_the_body_text() -> None:
    """正文行不能被当成表格的一行（汤彬 p17 的 `表1.3计算了…，` 是正文句）。"""
    lines = [
        L('表1.3计算了部分核素的比结合能，并绘于图1.2中', 37, 2029, 900, 2064),
        L('由此可见，比结合能随质量数变化', 37, 2070, 900, 2105),
    ]
    blocks, _ = boxes_to_blocks(lines, page=17, width=1740, height=2187)
    assert [b for b in blocks if b.kind == 'table'] == []


def test_table_needs_at_least_two_rows() -> None:
    """只有表题、下面只有一行格子 —— 那不是表，不能凭空造一张。"""
    lines = [
        L('表9.9 单行表', 200, 400, 700, 435),
        L('一号', 200, 450, 400, 480),
        L('二号', 700, 450, 900, 480),
        L('正文从这里开始，这是一行足够长的正文内容', 150, 500, 1500, 535),
    ]
    blocks, _ = boxes_to_blocks(lines, page=9, width=1740, height=2187)
    assert [b for b in blocks if b.kind == 'table'] == []


def test_table_in_right_column_ignores_left_column_body() -> None:
    """表排在右栏时，左栏的正文行不能当表格的边界。

    实测丁洪林 p284：`表 9.5…` 在右栏 x782–1281，表体从 y276 开始；
    而左栏正文（x128–749）在 y242 就有一句正文。不区分列时左栏那句会
    把表直接切断，整张表消失。
    """
    lines = [
        L('分辨率变差十分严重。所以作为一般要求，在加', 128, 242, 749, 278),
        L('表 9.5不同类型的HPGe 探测器的阔注量率', 782, 225, 1281, 261),
        L('类型', 841, 276, 891, 306),
        L('效率/%', 1000, 276, 1100, 306),
        L('阔注量/cm-2', 1150, 276, 1281, 306),
        L('同轴P型HPGe', 841, 320, 1000, 350),
        L('20', 1000, 320, 1050, 350),
        L('2 x 108', 1150, 320, 1281, 350),
    ]
    blocks, _ = boxes_to_blocks(lines, page=284, width=1740, height=2187)
    tables = [b for b in blocks if b.kind == 'table']
    assert len(tables) == 1
    assert len(tables[0].rows) == 2


def test_left_column_body_sharing_a_visual_row_is_not_eaten() -> None:
    """双栏页里左栏正文与右栏表头同高 —— 只吞右栏格子，左栏正文要留着。

    实测丁洪林 p230：左栏 `线，其能量至少可高至40keV。`（y0=836）与右栏
    表头 `能量/eV`（y0=831）相差 5px，被 `_group_rows` 聚成同一视觉行。
    按整行收取时因为右栏格子存在而 `_row_beside_table` 不成立，左栏正文就
    变成表格里的一格 —— 那一句永远不进 chunk（静默丢正文）。
    所以要用 `_cells_of_table` 逐格判：`x1 < 表题x0 - 8` 的格子留给正文。
    """
    lines = [
        L('表7.3X射线在硅和Au层中的透射比率', 741, 780, 1207, 812),
        L('测器。尽管如此，硅（锂）探测器对X射', 150, 794, 626, 826),
        L('线，其能量至少可高至40keV。', 148, 836, 518, 868),
        L('能量/eV', 827, 831, 908, 863),
        L('硅片厚度', 937, 831, 1034, 863),
        L('金层厚度', 1179, 834, 1272, 866),
        L('钠Na Z=11', 664, 926, 802, 958),
        L('1 041', 839, 929, 892, 961),
        L('0.82', 958, 926, 1012, 958),
        L('0.90', 1200, 931, 1251, 963),
    ]
    blocks, _ = boxes_to_blocks(lines, page=230, width=1409, height=1814)
    tables = [b for b in blocks if b.kind == 'table']
    assert len(tables) == 1
    joined = ' '.join(c for r in tables[0].rows for c in r)
    assert '能量至少可高至' not in joined, '左栏正文被当成表格格子了'
    body = ' '.join(b.text for b in blocks if b.kind != 'table')
    assert '能量至少可高至' in body, '左栏正文没进任何正文块'


def test_side_by_side_tables_merge_and_keep_other_captions() -> None:
    """两张表并排时合成一张宽表，但另一张表的题注**不能**被当格子吞掉。

    实测阎石 p88 是两张表并排：一行里 `表3.2.1` / `图3.2.5所示电路的
    逻辑电平` / `表3.2.2` / `图3.2.5所示电路的真值表`，下面 5 行数据是
    两张 3 列表并排（实际 6 列）。此时只认第一个表题、矩阵合成宽表；
    但若把整行标成已用，`表3.2.2` 与后两个题注就静默消失（实测丢 50 字）。
    """
    lines = [
        L('表3.2.1', 185, 300, 283, 332),
        L('图3.2.5所示电路的逻辑电平', 302, 300, 628, 332),
        L('表3.2.2', 809, 300, 910, 332),
        L('图3.2.5所示电路的真值表', 930, 300, 1228, 332),
        L('A/V', 185, 349, 250, 381),
        L('B/V', 400, 349, 460, 381),
        L('Y/N', 570, 349, 630, 381),
        L('A', 809, 349, 840, 381),
        L('B', 900, 349, 930, 381),
        L('Y', 1000, 349, 1030, 381),
        L('0', 185, 400, 210, 432),
        L('0', 400, 400, 425, 432),
        L('0.7', 570, 400, 620, 432),
        L('0', 809, 400, 834, 432),
        L('0', 900, 400, 925, 432),
        L('0', 1000, 400, 1025, 432),
        L('3', 185, 449, 210, 481),
        L('3', 400, 449, 425, 481),
        L('3.7', 570, 449, 620, 481),
        L('1', 809, 449, 834, 481),
        L('1', 900, 449, 925, 481),
        L('1', 1000, 449, 1025, 481),
    ]
    blocks, _ = boxes_to_blocks(lines, page=88, width=1376, height=1968)
    tables = [b for b in blocks if b.kind == 'table']
    assert len(tables) == 1, '两张并排的表应当合成一张'
    assert tables[0].text.startswith('表3.2.1')
    assert len(tables[0].rows) == 3, '表头行 + 两行数据'
    assert len(tables[0].rows[0]) == 6, '两张 3 列表并排应是 6 列'
    body = ' '.join(b.text for b in blocks if b.kind != 'table')
    # `图3.2.5所示电路的真值表` 在表题行右端；若把整行标成表格已用，它就
    # 不可能出现在任何正文块里（静默丢字）。`表3.2.2` 这种纯数字短行会被
    # 图区域当碎字吞掉（`_is_fragment`，与表格无关的既有行为），不在这里断言。
    assert '图3.2.5所示电路的真值表' in body, '同行右侧的图注被表格吞了'


# ---------------------------------------------------------------- 图与图注

def test_only_caption_line_can_start_a_figure() -> None:
    """`(a)`/`(b)` 只能补充已有图注，绝不能自己起一张图（实测会造出空图）。"""
    assert _starts_figure('图2.2.9电荷灵敏前置放大器的噪声等效电路')
    assert _starts_figure('图题 3-4 放大器')
    assert not _starts_figure('（a）等效电路')
    assert not _starts_figure('(b)')
    assert not _starts_figure('这就是正文的一段话')


def test_figure_block_carries_caption_text_and_clip() -> None:
    """图块的 `text` 就是图注：`import-content` 只把 bbox 存进 meta，图注是唯一能检索的文本。"""
    lines = [
        L('图2.2.9电荷灵敏前置放大器的a、b、c噪声等效电路', 300, 1900, 1300, 1935),
        L('（a）等效到前置放大器输入端的a、b、c电流噪声', 320, 1945, 1250, 1975),
    ]
    blocks, figures = boxes_to_blocks(lines, page=60, width=1740, height=2187)
    fig = [b for b in blocks if b.kind == 'figure']
    assert len(fig) == 1
    assert '图2.2.9' in fig[0].text
    assert '（a）' in fig[0].text, '子图注必须并进图注，否则 (a)(b) 单独成块丢掉'
    assert fig[0].clip is not None and fig[0].clip == fig[0].bbox
    assert figures and figures[0]['caption'].startswith('图2.2.9')


def test_subcaption_alone_does_not_create_figure() -> None:
    """孤立的 `(a)` 行不得产图 —— 没有图注的图块检不出来源，也无法被引用。"""
    lines = [L('(a)', 300, 500, 340, 530), L('(b)', 700, 500, 740, 530)]
    blocks, figures = boxes_to_blocks(lines, page=15, width=1740, height=2187)
    assert not [b for b in blocks if b.kind == 'figure']
    assert figures == []


# ---------------------------------------------------------------- 目录配对

def _toc_lines(rows: list[tuple[str, float, str, float]]) -> list[OcrLine]:
    """rows: (标题, 标题y, 页码文本, 页码y)，坐标照抄王芝英 p10 的实测值。

    标题 x0=266 必须**大于**章号行的 x1（`第一章` 在 167–259）—— `prefix`
    那条路按 `tln.x0 > mln.x1` 判「这个标记属于右边那条标题」。
    """
    out: list[OcrLine] = []
    for title, ty, num, ny in rows:
        out.append(L(title, 266, ty, 675, ty + 30, 0.9))
        if num:
            out.append(L(num, 1307, ny, 1332, ny + 28, 0.45))
    return out


def test_parse_toc_ocr_pairs_title_with_page_number_by_y() -> None:
    """标题与页码按 y 距离一对一配对，页码列取最靠右那一桶。"""
    lines = _toc_lines(
        [
            ('二、核辐射探测器的主要类别和输出信号', 576, '2', 587),
            ('三、核辐射探测器的基本性能(指标)', 616, '5', 627),
        ]
    )
    entries = parse_toc_ocr(lines)
    pages = {t: p for _, t, p in entries}
    assert pages['二、核辐射探测器的主要类别和输出信号'] == 2
    assert pages['三、核辐射探测器的基本性能(指标)'] == 5


def test_parse_toc_ocr_borrows_next_page_for_chapter_heading() -> None:
    """章标题行右边常常没认出页码，必须借下一条的 —— 否则整个章节点丢失。

    实测王芝英 p10：`第一章 / 核电子学系统中的信号与噪声`（y=447）在页码列
    里只有 y=461 的 `工`（conf 0.16，不是数字），严格配对会把它整条丢掉，
    于是 `_assign_nums` 看不到任何 `第X章`，后面所有小节都挂不上章。
    """
    lines = _toc_lines(
        [
            ('核电子学系统中的信号与噪声', 447, '工', 461),
            ('核辐射探测器及其输出信号', 493, '1', 505),
            ('一、核辐射探測器的要求和特点', 536, '1', 547),
        ]
    )
    # 章号独占一行（x1 < 标题 x0），靠 y 并回标题
    lines.insert(0, L('第一章', 167, 448, 259, 478, 0.74))
    entries = parse_toc_ocr(lines)
    by_title = {t: (num, p) for num, t, p in entries}
    assert '第一章核电子学系统中的信号与噪声' in by_title, by_title
    assert by_title['第一章核电子学系统中的信号与噪声'][1] == 1


def test_toc_page_number_accepts_leader_merged_digits() -> None:
    """引导点和页码会并进同一个框，长度上限必须放得下 10 个点 + 页码。"""
    assert _toc_page_number('........1') == 1
    assert _toc_page_number('……………… 10') == 10
    assert _toc_page_number('2.2.17') is None


def test_merge_toc_band_replaces_band_region_instead_of_appending() -> None:
    """页码带的结果要**替换**带内那一片，追加会把同一页码数两遍。

    实测追加版 105 条里 7 条页码倒退；替换版 111 条、0 条倒退。
    """
    full = [
        L('标题一', 200, 500, 600, 530),
        L('..1', 1290, 505, 1332, 528, 0.4),        # 整页认出来的（整行落在带内）
        L('600961-50', 1200, 800, 1251, 830, 0.3),  # 引导点拖到带左边
    ]
    band = [L('50', 1300, 800, 1332, 828, 0.55)]
    merged = _merge_toc_band(full, band, x0=1287.0)
    texts = [l.text for l in merged]
    assert '标题一' in texts, '带左边的标题必须保留'
    assert '..1' not in texts, '整行落在带内的整页结果要被带结果替换掉，否则页码重复'
    assert '600961-50' in texts, '整行在带左边的行不归带管，不能被顺手删掉（脏行交给去噪）'
    assert texts.count('50') == 1


def test_merge_toc_band_keeps_full_page_lines_when_band_failed() -> None:
    """裁带一条都没认出来时原样返回：宁可留着整页结果，也不能把整列页码丢光。"""
    full = [L('..1', 1290, 505, 1332, 528, 0.4)]
    assert _merge_toc_band(full, [], x0=1287.0) == full


def test_toc_denoise_drops_backwards_and_degenerate_titles() -> None:
    """印刷页码单调不减：倒退的条目一定是认错了；标题至少要有一个汉字。"""
    entries = [
        ('', '核电子学系统中的信号与噪声', 1),
        ('', '核辐射探测器及其输出信号', 1),
        ('', '三、核辐射探测器', 5),
        ('', '四、输出电路', 3),      # 倒退 → 丢
        ('', '·…·', 9),               # 无汉字无数字 → 丢
    ]
    kept = _toc_denoise(entries)
    assert [t for _, t, _ in kept] == ['核电子学系统中的信号与噪声', '核辐射探测器及其输出信号', '三、核辐射探测器']


def test_assign_nums_translates_chapter_section_subitem() -> None:
    """`第X章` / `§N` / `一、` → `k` / `k.s` / `k.s.u`，层级才能被 `build_tree` 用上。"""
    entries = [
        ('', '第一章核电子学系统中的信号与噪声', 1),
        ('', '$1核辐射探测器及其输出信号', 1),
        ('', '一、、核辐射探測器的要求和特点', 1),
        ('', '二、核辐射探测器的主要类别和输出信号', 2),
        ('', '第二章前置放大器', 34),
        ('', '$2噪声', 40),
    ]
    got = _assign_nums(entries)
    assert [num for num, _, _ in got] == ['1', '1.1', '1.1.1', '1.1.2', '2', '2.2']


def test_assign_nums_leaves_unmarked_entries_without_number() -> None:
    """`习题与思考题` 这类没有标记的条目要保留空编号，`build_tree` 会挂到当前章下。"""
    got = _assign_nums([('', '第一章绪论', 1), ('', '习题与思考题', 56)])
    assert got[1][0] == ''


def test_assign_nums_recovers_subitem_whose_number_ocr_ate() -> None:
    """序号被 OCR 吃掉、只剩前导 `、` 的子节要续号，不能落成孤立合成节点。

    实测王芝英 p25 的目录行是 `、系统的基本组成`（原本 `一、系统的基本组成`，
    后面紧跟 `二、核电子学常用的信号处理系统`）。落到无编号分支后
    `build_tree` 给它造了个 `kp-p25-、系统的基本组成`：没有编号、没有层级、
    内容挂不上去 —— 修复前 69 个叶子里有 26 个是这种零内容节点。
    续号后它是 `1.4.1`，正好接上后面的 `二、`。
    """
    entries = [
        ('', '第一章核电子学系统中的信号与噪声', 1),
        ('', '$1核辐射探测器及其输出信号', 1),
        ('', '、系统的基本组成', 1),          # 序号丢了，实为「一、」
        ('', '二、核电子学常用的信号处理系统', 2),
        ('', '三、核电子学信号处理单元插件标准化', 3),
    ]
    got = _assign_nums(entries)
    assert [num for num, _, _ in got] == ['1', '1.1', '1.1.1', '1.1.2', '1.1.3']
    assert got[2][1] == '系统的基本组成', '前导顿号要被剥掉，不能留在标题里'


def test_assign_nums_orphan_subitem_continues_after_real_ones() -> None:
    """真子节之后出现的孤儿条依次续号，不会和已用掉的编号撞车。"""
    entries = [
        ('', '第一章甲', 1),
        ('', '$1乙', 1),
        ('', '一、丙', 1),
        ('', '二、丁', 2),
        ('', '、戊子', 3),
        ('', '、己丑', 4),
    ]
    got = _assign_nums(entries)
    assert [num for num, _, _ in got] == ['1', '1.1', '1.1.1', '1.1.2', '1.1.3', '1.1.4']
    assert got[4][1] == '戊子', '前导顿号必须剥掉，标题里不能留'


def test_assign_nums_does_not_treat_short_punctuation_as_orphan_subitem() -> None:
    """孤立的 `、` 或 `，` 不是子节标题 —— 长度门槛挡住它们。"""
    got = _assign_nums([('', '第一章绪论', 1), ('', '$1甲', 1), ('', '、', 2), ('', '，', 3)])
    assert [n for n, _, _ in got] == ['1', '1.1', '', '']


def test_repair_page_swaps_transposed_two_digit_page_number() -> None:
    """`08` 是 `80` 被认反 —— 靠「页码不带前导零」这条印刷事实判定。

    实测 02 王经瑾 p8 的 `11.3.5`：页码列认成 `08`，前后条目是 79 和 82，
    真值 80。不修的话这条 `printed_page` 落到 8，会挂到第十一章以外去。

    必须在 `_toc_page_number` 里按**原始字符串**修：`int('08')` 已经是 8，
    转成 int 之后就和真值第 8 页完全无法区分了。
    """
    assert _toc_page_number('08') == 80
    assert _toc_page_number('03') == 30


def test_repair_page_leaves_normal_page_numbers_alone() -> None:
    """正常页码一律不动 —— 修页号必须极保守，错改比漏改更糟。"""
    for raw, want in [('7', 7), ('80', 80), ('194', 194), ('357', 357), ('100', 100)]:
        assert _toc_page_number(raw) == want


def test_toc_denoise_still_drops_real_backsteps() -> None:
    """真倒退仍然按噪声丢掉。"""
    entries = [('1', '甲章节', 50), ('2', '乙章节', 30)]
    assert [p for _, _, p in _toc_denoise(entries)] == [50]




def test_clamp_pages_fixes_out_of_range_page_numbers() -> None:
    """`189` 被认成 `681` 时必须修掉：错误页号会让整章 chunk 无归属。"""
    entries = [('4.3', '逐次比较型模数变换器', 164), ('5', '时间分析', 681), ('5.1', '概述', 192)]
    got = _clamp_pages(entries, max_page=345)
    assert got[1][2] == 164, '用前一条的页号补，至少落在合理区间'
    assert all(p <= 345 for _, _, p in got)


# ---------------------------------------------------------------- 断点续跑

def mkpage(
    page: int,
    *,
    lines: list[OcrLine] | None = None,
    conf: float = 0.9,
    status: str = 'ok',
    footer: int | None = None,
    error: str = '',
) -> OcrPage:
    """构造一页 OCR 结果。`char_count` 按真实规则由行内容算，别手填。"""
    lines = lines or []
    chars = sum(len(l.text) for l in lines)
    return OcrPage(
        page=page,
        blocks=[],
        lines=lines,
        line_count=len(lines),
        char_count=chars,
        mean_conf=conf if lines else 0.0,
        median_conf=conf if lines else 0.0,
        min_conf=conf if lines else 0.0,
        footer_page=footer,
        elapsed=1.0,
        status=status,
        error=error,
    )


def test_save_and_load_page_roundtrips_lines(tmp_path: Path) -> None:
    """缓存必须连原始行一起存 —— 目录解析靠 `p.lines`，丢了就要重跑 OCR。"""
    page = mkpage(10, lines=[L('目录', 667, 280, 830, 310)])
    save_page(tmp_path, page, dpi=200)
    back = load_page(tmp_path, 10, dpi=200)
    assert back is not None
    assert back.lines and back.lines[0].text == '目录'
    assert back.line_count == 1
    assert back.lines[0].x0 == 667


def test_load_page_rejects_cache_from_other_dpi(tmp_path: Path) -> None:
    """换了 dpi 版式坐标全变，旧缓存必须失效，否则会串页。"""
    save_page(tmp_path, mkpage(10, lines=[L('目录', 0, 0, 10, 10)]), dpi=200)
    assert load_page(tmp_path, 10, dpi=300) is None


def test_load_page_rejects_cache_from_other_version(tmp_path: Path) -> None:
    """版式规则一改就要作废旧缓存（`CACHE_VERSION` 是那个开关）。"""
    save_page(tmp_path, mkpage(10, lines=[L('目录', 0, 0, 10, 10)]), dpi=200)
    path = tmp_path / 'v3' / 'page-0010.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    data['version'] = CACHE_VERSION - 1
    path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    assert load_page(tmp_path, 10, dpi=200) is None


def test_cache_is_keyed_by_recogniser(tmp_path: Path) -> None:
    """缓存必须按识别模型分开，否则换型后的重跑全部命中旧结果而看不出异常。

    实测来源：换成 PP-OCRv4 之后 `CACHE_VERSION` 与 `dpi` 都不变，5087 页
    v3 缓存会把 v4 的重跑全部顶回去，跑完与跑前逐字节相同。
    """
    save_page(tmp_path, mkpage(10, lines=[L('v3 的结果', 0, 0, 10, 10)]), dpi=200, rec='v3')
    assert load_page(tmp_path, 10, dpi=200, rec='v4') is None
    v4 = load_page(tmp_path, 10, dpi=200, rec='v3')
    assert v4 is not None and v4.lines[0].text == 'v3 的结果'

    save_page(tmp_path, mkpage(10, lines=[L('v4 的结果', 0, 0, 10, 10)]), dpi=200, rec='v4')
    assert load_page(tmp_path, 10, dpi=200, rec='v4').lines[0].text == 'v4 的结果'
    assert load_page(tmp_path, 10, dpi=200, rec='v3').lines[0].text == 'v3 的结果'


def test_load_page_returns_none_when_absent(tmp_path: Path) -> None:
    assert load_page(tmp_path, 99, dpi=200) is None


def test_layout_version_marks_old_cache_stale_instead_of_discarding(tmp_path: Path) -> None:
    """版式规则改了绝不能让页缓存失效。

    5000 页重跑一次是 9 小时。缓存里已存了原始行，改版式只需重算块（毫秒级），
    所以 `load_page` 对旧版式返回页对象而不是 None，只打上 `layout_stale`。
    """
    page = mkpage(10, lines=[L('表1.3 线性响应指标', 200, 400, 700, 435)])
    save_page(tmp_path, page, dpi=200)
    path = tmp_path / 'v3' / 'page-0010.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    data.pop('layout')  # 模拟加 LAYOUT_VERSION 之前写的老缓存
    path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')

    back = load_page(tmp_path, 10, dpi=200)
    assert back is not None  # 不能丢页
    assert back.layout_stale is True
    assert back.lines[0].text.startswith('表1.3')  # 行还在，能重算版式

    fresh = mkpage(11, lines=[L('正文', 0, 0, 10, 10)])
    save_page(tmp_path, fresh, dpi=200)
    assert load_page(tmp_path, 11, dpi=200).layout_stale is False


# ---------------------------------------------------------------- 不丢页

def test_ocr_page_returns_blank_page_instead_of_dropping() -> None:
    """认不出任何行的页必须返回 `blank` 页对象（空文本 + 0 置信度 + 页号），
    绝不能返回 None —— 票 17 明令「不得静默丢页」。"""

    class _EmptyEngine:
        def lines(self, image, *, text_score=None):  # noqa: ANN001
            return []

    class _Doc:
        def __getitem__(self, i):  # noqa: ANN001
            return _Page()

    class _Page:
        rect = type('R', (), {'width': 626.0, 'height': 889.0})()

        def get_pixmap(self, dpi: int = 200):  # noqa: ANN201
            raise AssertionError('不应走到渲染——render_page 已被打桩')

    import ocr as _ocr

    orig = _ocr.render_page
    _ocr.render_page = lambda doc, index, dpi=200: __import__('numpy').zeros((100, 100, 3), 'uint8')
    try:
        page = ocr_page(_EmptyEngine(), _Doc(), 7, dpi=200)
    finally:
        _ocr.render_page = orig
    assert page is not None
    assert page.page == 7
    assert page.status == 'blank'
    assert page.text == ''
    assert page.mean_conf == 0.0
    assert page.line_count == 0


def test_ocr_page_turns_exception_into_recorded_error() -> None:
    """单页渲染/识别炸了不能让整本书中断，要落成带 `error` 的页记录。"""

    class _BoomEngine:
        def lines(self, image, *, text_score=None):  # noqa: ANN001
            raise RuntimeError('boom')

    class _Page:
        rect = type('R', (), {'width': 626.0, 'height': 889.0})()

    class _Doc:
        def __getitem__(self, i):  # noqa: ANN001
            return _Page()

    import ocr as _ocr

    orig = _ocr.render_page
    _ocr.render_page = lambda doc, index, dpi=200: __import__('numpy').zeros((100, 100, 3), 'uint8')
    try:
        page = ocr_page(_BoomEngine(), _Doc(), 8, dpi=200)
    finally:
        _ocr.render_page = orig
    assert page.page == 8
    assert page.status == 'blank'
    assert 'boom' in page.error


# ---------------------------------------------------------------- 汇总与产物

def test_summarize_marks_review_pages_and_lists_blanks() -> None:
    """汇总要给出复核页数与 blank 页号清单，blank 页号是「没静默丢页」的证据。"""
    pages = [
        mkpage(1, lines=[L('正文一行', 0, 0, 100, 20)], conf=0.90, footer=47),
        mkpage(2, lines=[L('糊', 0, 0, 10, 10, 0.3)], conf=0.70, status='review'),
        mkpage(3, status='blank'),
    ]
    s = summarize(pages)
    assert s['pageCount'] == 3
    assert s['okPages'] == 1
    assert s['reviewPages'] == 1
    assert s['blankPages'] == 1
    assert s['blankPageIndexes'] == [3]
    assert s['threshold'] == REVIEW_THRESHOLD
    assert s['totalChars'] == 5


def test_write_page_artifacts_writes_a_row_for_every_page(tmp_path: Path) -> None:
    """页账本必须逐页一行：这是「11 本 5181 页一页不少」的机器可查证据。"""
    pages = [
        mkpage(1, lines=[L('正文', 0, 0, 10, 10)], conf=0.90, footer=47),
        mkpage(2, status='blank'),
        mkpage(3, lines=[L('糊', 0, 0, 10, 10, 0.3)], conf=0.60, status='review'),
    ]
    out = tmp_path / 'ocr'
    summary = write_page_artifacts(pages, out, [], chunk_index={})
    rows = [json.loads(x) for x in (out / 'pages.jsonl').read_text(encoding='utf-8').splitlines()]
    assert [r['page'] for r in rows] == [1, 2, 3]
    assert rows[0]['confidence'] == 0.9 and rows[0]['footerPage'] == 47
    review = [json.loads(x) for x in (out / 'review.jsonl').read_text(encoding='utf-8').splitlines()]
    assert {r['page'] for r in review} == {2, 3}
    reasons = {r['page']: r['reason'] for r in review}
    assert reasons[2] == 'no-text' and reasons[3] == 'low-confidence'
    assert summary['pageCount'] == 3


def test_write_page_artifacts_links_figures_to_chunks(tmp_path: Path) -> None:
    """图记录要挂上 chunkId，否则前端点图找不到对应 chunk。"""
    pages = [mkpage(23, lines=[L('图1.1.8闪烁探测器', 0, 0, 10, 10)])]
    figures = [{'page': 23, 'index': 0, 'image': 'page-0023-fig-0.png', 'bbox': [1.0, 2.0, 3.0, 4.0], 'caption': '图1.1.8闪烁探测器'}]
    out = tmp_path / 'ocr'
    write_page_artifacts(pages, out, figures, chunk_index={(23, (1.0, 2.0, 3.0, 4.0)): 'ck-x'})
    row = json.loads((out / 'figures.jsonl').read_text(encoding='utf-8').splitlines()[0])
    assert row['chunkId'] == 'ck-x'


class _FakeDoc:
    """最小的 doc 替身：只提供 `page_count` 和下标的 `rect`。"""

    def __init__(self, page_count: int = 200):
        self.page_count = page_count

    def __getitem__(self, i: int):  # noqa: ANN001
        return type('P', (), {'rect': type('R', (), {'width': 626.0, 'height': 889.0})()})()


def test_detect_page_offset_takes_the_mode_of_agreements() -> None:
    """页偏移取众数：单页误认（表格里的 `550`）不能把全局偏移带跑。

    王芝英实测：16 页抽样命中 9 页，众数 13，一致率 1.0 —— 即 PDF 页 60 是
    印刷页 47。这里用打桩的 `measure_page_number` 复现同一组数字，顺带验证
    一页 `550`（正文表格里的数字被当页码认了）不会把众数带跑。
    """
    import ocr as _ocr

    # 采样点是 range(1, page_count, step) 且 step = page_count // samples，
    # 让 page_count == samples + 1 使 step == 1，采样点才是可预期的 1..samples。
    printed = {30: 17, 31: 18, 32: 19, 33: 20, 34: 550}
    orig = _ocr.measure_page_number
    _ocr.measure_page_number = lambda engine, doc, i, band=0.12: printed.get(i)
    try:
        offset, agreement, hits = detect_page_offset(object(), _FakeDoc(41), samples=40)
    finally:
        _ocr.measure_page_number = orig
    assert offset == 13
    assert agreement == 0.8, '5 次命中里 4 次指向同一个偏移，1 次是噪声'
    assert (30, 17) in hits and (34, 550) in hits


def test_detect_page_offset_falls_back_to_zero_when_nothing_readable() -> None:
    """一页页码都认不出时返回 0/0.0，调用方据此提示用户显式指定 --page-offset。"""
    import ocr as _ocr

    orig = _ocr.measure_page_number
    _ocr.measure_page_number = lambda engine, doc, i, band=0.12: None
    try:
        assert detect_page_offset(object(), _FakeDoc(10), samples=3) == (0, 0.0, [])
    finally:
        _ocr.measure_page_number = orig


def test_detect_page_offset_refuses_to_trust_two_lucky_hits() -> None:
    """只有 2 次命中时不信众数 —— 18 那本就是这样算出 -49 的。

    18《原子核物理实验方法》整本印的是括号页码 `(357)`，页眉页脚带里没有
    页码，`measure_page_number` 一页都认不出。实测抽样只碰到 2 次误读（同一张
    表格里的 `49`），众数偏移 -49、一致率 0.50 —— 采用它会让全书每页的
    printed_page 都错 49 页。返回 0 让调用方要求显式 `--page-offset`。
    """
    import ocr as _ocr

    printed = {10: 59, 20: 69}  # 两页都误读，算出来都是 -49
    orig = _ocr.measure_page_number
    _ocr.measure_page_number = lambda engine, doc, i, band=0.12: printed.get(i)
    try:
        offset, agreement, hits = detect_page_offset(object(), _FakeDoc(30), samples=30)
    finally:
        _ocr.measure_page_number = orig
    assert len(hits) == 2
    assert offset == 0, '证据不足时不能把 -49 当真'
    assert agreement == 1.0, '一致率本身仍是 1.0，靠命中数门槛挡住'


def test_detect_page_offset_refuses_low_agreement() -> None:
    """一致率 < 0.5 时不采用众数 —— 05 那本 16 次命中 11 次是噪声。

    05《核辐射测量原理》真偏移是 14，但页眉里有表格数字被当成页码，16 次
    命中只有 5 次指向 14（0.31）。众数虽然对，这种「对得少、错得多」的局面
    不该自动采用，交给人显式指定。
    """
    import ocr as _ocr

    printed = {10: -5, 20: -5, 30: -5, 40: -5, 50: 36, 60: 38, 70: 40, 80: 42}
    orig = _ocr.measure_page_number
    _ocr.measure_page_number = lambda engine, doc, i, band=0.12: printed.get(i)
    try:
        offset, agreement, _hits = detect_page_offset(object(), _FakeDoc(90), samples=90)
    finally:
        _ocr.measure_page_number = orig
    assert agreement < 0.5
    assert offset == 0, '一致率不足时不采用众数'


# ------------------------------------------------------- 逐页偏移（漂移的书）
#
# 05《核辐射测量原理》464 页里 442 页页脚印着页码，实测偏移不是常数：
# pdf 0–155 → 14、160–240 → 16、240–300 → 18/20、320–440 → 24、440– → 32。
# 用 14 一个常数，pdf 320 之后每页的 printed_page 就错 10 页以上，
# `assign` 按 printedPage 分区间必然把整章挂错知识点。

def test_resolve_page_offsets_follows_a_drifting_book() -> None:
    """偏移漂移时必须逐页校正，不能全书一个常数。"""
    # 造一本 300 页的书：前 100 页偏移 14，中 100 页 16，后 100 页 24
    pages = []
    for i in range(300):
        off = 14 if i < 100 else (16 if i < 200 else 24)
        pages.append(mkpage(i, footer=i - off))
    offsets, report = resolve_page_offsets(pages)

    assert report['pagesWithNumber'] == 300
    assert report['distinctOffsets'] == 3, '三段偏移必须被识别成三种，不是一种'
    assert report['drift'] == 10, '最少 14、最多 24，跨度 10'
    # 段中间必须准
    assert offsets[50] == 14
    assert offsets[150] == 16
    assert offsets[250] == 24
    # 用错常数会错多少：pdf 250 真印刷页是 226，按全局众数 14 会算出 236
    assert 250 - offsets[250] == 226


def test_resolve_page_offsets_collapses_to_a_constant_when_stable() -> None:
    """偏移稳定的书退化成常数 —— 王芝英 280 页里 261 页都是 13。"""
    pages = [mkpage(i, footer=i - 13) for i in range(200)]
    offsets, report = resolve_page_offsets(pages)
    assert report['distinctOffsets'] == 1, '投票结果只有一种偏移，夹紧不算漂移'
    assert report['drift'] == 0
    # 前 13 页按偏移 13 算会得到负数，被夹到 0 —— 那是保 printed_page >= 0 的
    # 防护（真书里这几页是封面/目录，页脚根本没有页码）；第 13 页起必须准。
    assert all(i - offsets[i] >= 0 for i in offsets), 'printed_page 不允许为负'
    assert offsets[13] == 13 and offsets[150] == 13


def test_resolve_page_offsets_survives_a_misread_page() -> None:
    """单页页码误读不能把该页的偏移带跑 —— 靠邻域投票吃掉离群值。"""
    pages = [mkpage(i, footer=i - 16) for i in range(40)]
    pages[20] = mkpage(20, footer=550)  # 表格里的数字被当成页码
    offsets, _report = resolve_page_offsets(pages)
    assert offsets[20] == 16, '邻域 15 页都指向 16，单页 550 必须被投票吃掉'


def test_resolve_page_offsets_falls_back_when_no_page_has_a_number() -> None:
    """整本没有页码（18 那样括号页码印在行尾、页眉页脚带里没有）→ 常数兜底。"""
    pages = [mkpage(i) for i in range(30)]
    offsets, report = resolve_page_offsets(pages, fallback=7)
    assert report['pagesWithNumber'] == 0
    assert set(offsets.values()) == {7}
    assert len(offsets) == 30, '每一页都要有偏移，不能漏页'


def test_engine_missing_dependency_raises_clear_error() -> None:
    """装不上 openvino / rapidocr 时要给出可操作的错，不是 ImportError 裸抛。"""
    with pytest.raises(OcrSessionError):
        OcrEngine(site=Path('/nonexistent/rapidocr-dir'))
class TestNoSilentPageDrop:
    """票 17 的硬要求：不得静默丢页。

    一个页面 OCR 出了字、却因为「每块都短于 MIN_CHARS」被逐块滤掉，
    最终整页 0 个 chunk —— 这就是静默丢页。实测 11 本扫描书的正文里有
    60 页栽在这里，最长的一页 OCR 出 42 行、全部是 `12V` / `(5.6k)` /
    `施密特电路` 这种图注碎片（王芝英 p236 / p268）。
    """

    def test_fragments_only_page_still_yields_one_chunk(self):
        from chunk import blocks_to_chunks
        from extract import Block

        blocks = [
            Block(kind='paragraph', page=236, bbox=(10, 10, 90, 20), text='12V'),
            Block(kind='paragraph', page=236, bbox=(10, 30, 90, 40), text='(5.6k)'),
            Block(kind='paragraph', page=236, bbox=(10, 50, 90, 60), text='施密特电路'),
            Block(kind='paragraph', page=236, bbox=(10, 70, 90, 80), text='(4.64k)'),
        ]
        chunks = blocks_to_chunks(blocks, 'demo', page_offset=13)
        assert len(chunks) == 1, '碎片页必须拼成一条，不能整页丢'
        assert chunks[0].pdf_page == 236
        assert chunks[0].printed_page == 223
        assert '12V' in chunks[0].text and '施密特电路' in chunks[0].text

    def test_page_with_real_content_is_not_merged(self):
        """正常页不受影响：块还在门槛之上时各成一条。"""
        from chunk import blocks_to_chunks
        from extract import Block

        blocks = [
            Block(kind='paragraph', page=10, bbox=(0, 0, 100, 20), text='噪声可以按来源分成两类。'),
            Block(kind='paragraph', page=10, bbox=(0, 30, 100, 50), text='第一类是探测器本身的散粒噪声。'),
        ]
        chunks = blocks_to_chunks(blocks, 'demo', page_offset=0)
        assert len(chunks) == 2

    def test_page_number_only_page_is_still_dropped(self):
        """真的只有页码的页不能凭空造 chunk。"""
        from chunk import blocks_to_chunks
        from extract import Block

        blocks = [Block(kind='paragraph', page=5, bbox=(0, 0, 50, 20), text='· 12 ·')]
        assert blocks_to_chunks(blocks, 'demo', page_offset=0) == []


# ---------------------------------------------------------------- 复核阈值标定

def test_review_threshold_never_goes_below_the_ticket_floor() -> None:
    """票面写死「低于 0.85 进复核队列」是**下限**，换模型也只能更严。

    实测来源：v3 的分布 p15 是 0.836，按百分位直接取会让阈值降到票面之下，
    等于少标票面要求必标的页 —— 违约。
    """
    info = choose_review_threshold([0.80, 0.82, 0.84, 0.86, 0.90])
    assert info['threshold'] == 0.85
    assert info['ticketThreshold'] == 0.85


def test_review_threshold_rises_when_the_model_is_more_confident() -> None:
    """换 PP-OCRv4 后置信度整体上移，沿用 0.85 会让复核队列几乎空掉。

    实测来源：v4 在王芝英前 161 页的分布 —— p15 = 0.8756，按 0.85 筛只剩
    10/161 = 6.2%，按 p15 筛是 20/161 = 12.4%（captain 要求 10–20%）。
    """
    confs = [0.95] * 70 + [0.90] * 15 + [0.86] * 15
    info = choose_review_threshold(confs)
    assert info['threshold'] > 0.85, '应当高于票面下限，而不是停在 0.85'
    assert info['rule'].startswith('max(')
    share = sum(1 for c in confs if c < info['threshold']) / len(confs)
    assert 0.05 <= share <= 0.20, f'复核占比 {share:.0%} 超出 10–20% 的目标区间'


def test_review_threshold_survives_an_empty_book() -> None:
    """整本一页都没认出来时不能除零，也不能把阈值定成 0（那等于不复核）。"""
    info = choose_review_threshold([])
    assert info['threshold'] == 0.85
    assert info['calibrated'] is None


def test_apply_review_threshold_recomputes_status_from_cached_confidence() -> None:
    """阈值是派生逻辑，页缓存里存的是原始置信度 —— 换阈值不许重跑 OCR。

    这条守住「换算阈值只花几秒」这件事：11 本 5181 页重跑一次要 4 小时，
    调一次阈值就重跑一遍是不可接受的。
    """
    # `mkpage` 无行时 mean_conf 强制为 0（真实规则：没字就没置信度），
    # 所以这里必须给每页一行，否则测的就不是阈值而是 mkpage 的默认值。
    pages = [
        mkpage(1, lines=[L('甲乙丙丁', 0, 0, 100, 20)], conf=0.90),
        mkpage(2, lines=[L('戊己庚辛', 0, 0, 100, 20)], conf=0.84),
        mkpage(3, status='blank'),
    ]
    n = apply_review_threshold(pages, 0.85)
    assert n == 1
    assert pages[0].status == 'ok' and pages[1].status == 'review'
    assert pages[2].status == 'blank', 'blank 页不该被阈值改写'

    n = apply_review_threshold(pages, 0.80)
    assert n == 0 and pages[1].status == 'ok'


def test_summary_records_where_the_threshold_came_from() -> None:
    """阈值来历必须进 summary.json，否则半年后没人知道这个数字怎么定的。"""
    info = choose_review_threshold([0.95] * 8 + [0.88] * 2)
    s = summarize([mkpage(1, lines=[L('甲乙丙丁', 0, 0, 100, 20)], conf=0.95)], threshold_info=info)
    assert s['threshold'] == info['threshold']
    assert s['reviewThresholdRule'].startswith('max(')
    assert s['reviewThresholdQuantile'] == 0.15
