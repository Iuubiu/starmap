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
    _looks_like_table_line,
    _merge_toc_band,
    _page_number_lines,
    _parse_page_number,
    _split_table_cells,
    _starts_figure,
    _toc_denoise,
    _toc_page_number,
    boxes_to_blocks,
    detect_page_offset,
    load_page,
    ocr_page,
    parse_toc_ocr,
    render_page,
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
        ('2.2.17', None),    # 公式号，不是页码
        ('图3.4', None),     # 图注号
        ('第五章', None),
        ('', None),
    ],
)
def test_parse_page_number_accepts_only_real_page_numbers(raw: str, expected: int | None) -> None:
    """页码判定必须同时挡住公式号和图注号，否则 `printed_page` 会混进 `(2.2.17)`。"""
    assert _parse_page_number(raw) == expected


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

def test_table_line_needs_at_least_three_short_cells() -> None:
    """表格行靠「多列 + 每列短」判定；正文一句话被空格切开不能当表格。"""
    assert _looks_like_table_line('型号  增益  带宽')
    assert not _looks_like_table_line('这是一个很长很长的句子 中间只有一个空格')
    assert not _looks_like_table_line('只有  两列')


def test_split_table_cells_keeps_single_space_words_together() -> None:
    """OCR 的空格不可靠：单空格视为词内分隔，连续两个以上才是列分隔。"""
    assert _split_table_cells('频率  增益') == ['频率', '增益']


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
    path = tmp_path / 'page-0010.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    data['version'] = CACHE_VERSION - 1
    path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    assert load_page(tmp_path, 10, dpi=200) is None


def test_load_page_returns_none_when_absent(tmp_path: Path) -> None:
    assert load_page(tmp_path, 99, dpi=200) is None


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


def test_engine_missing_dependency_raises_clear_error() -> None:
    """装不上 openvino / rapidocr 时要给出可操作的错，不是 ImportError 裸抛。"""
    with pytest.raises(OcrSessionError):
        OcrEngine(site=Path('/nonexistent/rapidocr-dir'))
