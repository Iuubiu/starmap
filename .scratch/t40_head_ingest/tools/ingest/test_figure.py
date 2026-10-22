"""
图注识别与图区域划分的回归测试。

全部断言来自实测。康华光《数字部分》第 5 版全书 202 个图，三种形态：

1. **图注在图下方**（最常见）：图内碎字（`Vcc`、`t_w`、`(a)`）散落在
   文字层里，以图注行为锚点向上收。
2. **图注在图上方**（PDF 131 页）：同一页有 4 个图（图3.5.1–3.5.4），
   图注在图的上方，向上收会撞到上一个图的图注。
3. **图本体在上一页**（PDF 37 页 `图1.2.1`）：图注落在本页顶部，上方紧接
   正文，收不到任何碎字。

三种形态的共同要求：**图注必须留下**。图注是唯一能检索到这张图的文本，
丢掉它等于书里少了一个图。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pytest

from extract import _figure_regions, _looks_like_caption, _looks_like_subcaption


class TestLooksLikeCaption:
    def test_accepts_real_caption(self):
        assert _looks_like_caption('图8.4.6  由555定时器组成的可重复触发的单稳电路')

    def test_accepts_two_level_number(self):
        assert _looks_like_caption('图1.4.2  格雷码')

    def test_accepts_latin_title(self):
        """标题以拉丁字母开头也是图注。

        实测 p.52：`图2.2.7  L(A,B,C,D)的卡诺图图2.2.8  例2.2.3的卡诺图`
        （两个图注粘成一行）。只认中文开头会漏掉它 —— 而它是判断
        这一带是卡诺图、不是表格的关键。
        """
        assert _looks_like_caption('图2.2.7  L(A,B,C,D)的卡诺图图2.2.8  例2.2.3的卡诺图')

    def test_rejects_body_sentence_referencing_figure(self):
        # 正文里大量以「图X.Y.Z」开头的句子，不是图注
        assert not _looks_like_caption('图1.1.1所示为转换过程中各种波形图，图1.1.1(a)所示为模拟电压信')
        assert not _looks_like_caption('图1.6.1所示为一个控制楼梯照明灯的电路，单刀双掷开关A装在楼下，')

    def test_rejects_body_phrasing_even_without_punctuation(self):
        """正文措辞判据：`所示` / `如图` / `见图` / `参见`。

        实测有正文句子不带句读却以图号开头，例如
        `图2.2.6所示四变量卡诺图中的方格5`。只靠「含句读」挡不住。
        """
        assert not _looks_like_caption('图2.2.6所示四变量卡诺图中的方格')
        assert not _looks_like_caption('图3.1.2如图所示的延迟时间')

    def test_accepts_caption_with_punctuation(self):
        """图注里出现顿号、逗号也是图注 —— 区分靠图号后的空格，不靠标点。

        实测 p.142 `图4.4.4  优先编码器CD4532的逻辑图、逻辑符号和引脚图`
        是真图注。早先版本用句读黑名单把它判成正文，导致整页图区域识别失败、
        二十多行图碎字（`I2&`/`Yo`/`Gs`）漏进正文。全书 266 条以图号开头的
        行逐条看过：带逗号/顿号的是真图注，真正文的图号后**没有空格**。
        """
        assert _looks_like_caption('图4.4.4  优先编码器CD4532的逻辑图、逻辑符号和引脚图')
        assert _looks_like_caption('图7.2.2  第j列，第i行的存储单元结构示意图')
        assert _looks_like_caption('图7.4.5 Spartan-Ⅱ、Virtex系列简化的CLB原理框图')

    def test_rejects_too_long(self):
        assert not _looks_like_caption('图' + '9.9.9  ' + '很' * 60)

    def test_rejects_number_without_title(self):
        # 编号后必须直接跟标题（1–4 个空格）
        assert not _looks_like_caption('图1.2.1')
        assert not _looks_like_caption('图1.2.1abc')


class TestLooksLikeSubcaption:
    def test_accepts_paren_letter(self):
        assert _looks_like_subcaption('(a)电路图  (b)工作波形')
        assert _looks_like_subcaption('（a）电路图')

    def test_rejects_ordinary_text(self):
        assert not _looks_like_subcaption('图8.4.6  由555定时器组成')
        assert not _looks_like_subcaption('如果将单稳态电路')


def _line(text: str, y: float, x0: float = 100, x1: float | None = None) -> list[dict]:
    x1 = x1 if x1 is not None else x0 + 20 * len(text)
    return [{'text': text, 'size': 32.0, 'x': (x0 + x1) / 2, 'y': y, 'bbox': (x0, y - 18, x1, y + 18)}]


def _page_lines(*specs: tuple) -> list[list[dict]]:
    """spec 是 `(text, y)` 或 `(text, y, x0, x1)`。"""
    return [_line(*spec) for spec in specs]


class TestFigureRegions:
    """三种图注形态都必须留下 figure 块。"""

    def test_caption_at_top_without_figure_still_kept(self):
        """形态 3：图本体在上一页，图注上方紧接正文。

        实测 PDF 37 页行 26。早先版本在这里 `continue` 掉了，全书丢掉 45 个图。
        """
        lines = _page_lines(
            ('上文的一段正文，用来挡住向上收碎字。', 100),
            ('图1.2.1  用二进制数表示0～15波形图', 180),
        )
        regions = _figure_regions(lines, None, set())
        assert len(regions) == 1
        a, b, clip = regions[0]
        # b < a 表示「只有图注、没有图区域」，这是刻意的
        assert b < a
        assert clip[1] < 200 < clip[3] or clip[1] <= 180 <= clip[3]

    def test_caption_blocked_by_table_band_still_kept(self):
        """形态 3 变体：图注上方是被判成表格带的图本体。

        实测 PDF 71 页行 3，`图2.2.1 一变量卡诺图` 上面两行 `LDDLDL`/`(a)(b)(c)`
        被 `_table_bands` 判成表格带，扩展立刻撞闸。
        """
        lines = _page_lines(
            ('LDDLDL', 60),
            ('(a)(b)(c)', 100),
            ('图2.2.1  一变量卡诺图', 160),
        )
        regions = _figure_regions(lines, None, {0, 1})
        assert len(regions) == 1
        assert regions[0][1] < regions[0][0]

    def test_expansion_stops_at_previous_caption(self):
        """形态 2：一页多图时，后一个图的扩展不能吞掉前一个图的图注。

        实测 PDF 131 页有 4 个图（图3.5.1–3.5.4）。不加这道闸时后一个图
        的扩展会越过前一个图注，4 个图只出 2 个块。
        """
        lines = _page_lines(
            ('A&L=A·BA—o≥1L=1+B', 60),
            ('图3.5.1  与非门及其等效符号', 120),
            ('A·≥1L=A+B&L=A·B', 180),
            ('图3.5.2  或非门及其等效符号', 240),
        )
        regions = _figure_regions(lines, None, set())
        assert len(regions) == 2
        first, second = regions
        # 第二个区域的起点必须晚于第一个图注行（下标 1）
        assert second[0] > 1
        assert first[1] < first[0] or first[0] <= 1

    def test_expansion_consumes_figure_fragments_above(self):
        """形态 1：图内碎字（上方孤立短行）应被并进图区域。"""
        lines = _page_lines(
            ('如果要继续说明的正文句子，带句读。', 60, 100, 1200),
            ('Vcc', 120, 100, 700),
            ('(a)', 200, 100, 640),
            ('图8.4.6  由555定时器组成的可重复触发的单稳电路', 290, 100, 1100),
        )
        regions = _figure_regions(lines, None, set())
        assert len(regions) == 1
        a, _b, clip = regions[0]
        assert a == 1  # 从 Vcc 开始，不停在上面的正文
        # 裁剪框必须覆盖从 Vcc 到 (a) 的整段（y 102..218），而不是只有图注
        assert clip[1] <= 102 and clip[3] >= 218

    def test_english_figure_ruler_is_consumed(self):
        """图内的英文/数字标尺没有中文，不能被当正文截断。

        实测 PDF 522 页波形图上方 `500.0 us 4.5 ms8.5 ms…` 去空白后 51 字符，
        按「长度 > 24」判据会被当正文，导致 24 行图碎字进正文。
        """
        lines = _page_lines(
            ('500.0 us 4.5 ms8.5 ms12.5 ms16.5 ms20.5 ms24.5 ms28.5 ms', 60),
            ('Name', 100),
            ('图10.4.3  数字密码锁的仿真波形图', 160),
        )
        regions = _figure_regions(lines, None, set())
        assert regions[0][0] == 0


def _cells(row: str, y: float, x0: float = 100, pitch: float = 90) -> list[dict]:
    """一行里放多个短 token span —— 真值表/电路符号行的真实形态。

    `_table_bands` 要求每行 ≥3 个 span，单 span 行永远判不成表格带
    （`len(line) < 3` 直接 False）。写夹具时必须按真实形态铺开。
    """
    out = []
    for i, tok in enumerate(row.split('|')):
        x = x0 + i * pitch
        out.append(
            {'text': tok, 'size': 32.0, 'x': x + 20, 'y': y, 'bbox': (x, y - 18, x + 40, y + 18)}
        )
    return out


class TestPseudoTable:
    """伪表格判定：表格带旁边是图注而不是表注时，它是图不是表。

    实测 78 个表格带旁有表注（真表）、36 个旁边只有图注（伪表 —— 电路图、
    波形图、卡诺图被短 token 判据误判）、47 个两者都没有（仍是真表，表注
    印在别页或被跨页拆开）。删掉伪表后 table chunk 从 160 降到 132，
    正文里的电路符号噪声随之减少。
    """

    def test_figure_caption_without_table_caption_marks_pseudo(self):
        import re

        from extract import _table_bands

        lines = [
            _cells('A&|B·|≥1L|&|A&', 60),
            _cells('0|0|0|1|1', 100),
            _cells('0|1|0|0|1', 140),
            _cells('1|0|1|1|0', 180),
            _line('图3.5.1  与非门及其等效符号', 240, 100, 900),
        ]
        bands = _table_bands(lines)
        assert bands, '连续短 token 行应判成表格带'
        a, b = bands[0]
        near = [
            ''.join(s['text'] for s in lines[j]).strip()
            for j in range(max(0, a - 8), min(len(lines), b + 9))
            if not (a <= j <= b)
        ]
        has_table_cap = any(re.match(r'^表\s*\d+', t) for t in near)
        has_figure_cap = any(re.match(r'^图\s*\d+', t) for t in near)
        assert has_figure_cap and not has_table_cap

    def test_real_table_has_table_caption(self):
        import re

        from extract import _table_bands

        lines = [
            _line('表1.4.2  格雷码', 40, 100, 900),
            _cells('0|0|0|0|0|0|0|0', 100),
            _cells('0|0|0|1|0|0|0|1', 140),
            _cells('0|0|1|0|0|0|1|1', 180),
        ]
        bands = _table_bands(lines)
        assert bands, '连续短数字行应判成表格带'
        a, b = bands[0]
        near = [
            ''.join(s['text'] for s in lines[j]).strip()
            for j in range(max(0, a - 8), min(len(lines), b + 9))
            if not (a <= j <= b)
        ]
        assert any(re.match(r'^表\s*\d+', t) for t in near)


class TestPageTestSuiteSanity:
    """全书图注数与 figure 数必须一致 —— 这条是票 02 的抽样核对结论。"""

    @pytest.mark.skipif(
        not Path('资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf').exists(),
        reason='原书不在本机',
    )
    def test_every_caption_becomes_a_figure_chunk(self):
        import json

        import pymupdf

        from extract import _group_lines, _spans_of

        pdf = '资源库/books/21_电子技术基础_数字部分_康华光_第5版.pdf'
        out = Path('content/digital-kanghua-5e/chunks.jsonl')
        if not out.exists():
            pytest.skip('内容产物尚未生成，先跑 tools/ingest/run.py')

        doc = pymupdf.open(pdf)
        captions = set()
        for pi in range(24, doc.page_count):
            for ln in _group_lines(_spans_of(doc[pi])):
                t = ''.join(s['text'] for s in ln).strip()
                if _looks_like_caption(t):
                    captions.add(t)

        figures = [
            json.loads(line)['text']
            for line in out.open(encoding='utf-8')
            if json.loads(line)['kind'] == 'figure'
        ]
        # figure 块的 text 是「图注 + 子图说明」拼起来的
        # （`图1.1.1  模拟量的数字表示 (a)模拟电压信号  (b)取样信号`），
        # 所以用包含判定，不能用精确相等。
        missing = [c for c in captions if not any(c in f for f in figures)]
        assert not missing, f'这些图注没有变成 figure: {sorted(missing)[:5]}'
