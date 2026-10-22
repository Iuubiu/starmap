"""
表格还原的回归测试。

全部断言都来自实测：康华光《数字部分》第 5 版 PDF 第 50 页（印刷页 28）
上有两张表 —— 表1.4.2 格雷码与表1.4.3A ASCII 码。这两张表把三种还原策略
依次证伪过，所以每个测试都锁住一个具体的失败模式，而不是锁住当前实现。

真值一律以书上印的为准。格雷码表 8 个数据行，二进制码 b₃b₂b₁b₀ 从 0000
到 0111（左半）与 1000 到 1111（右半），对应格雷码 G₃G₂G₁G₀：
    0000→0000  0001→0001  0010→0011  0011→0010
    0100→0110  0101→0111  0110→0101  0111→0100
    1000→1100  1001→1101  1010→1111  1011→1110
    1100→1010  1101→1011  1110→1001  1111→1000
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pytest

from extract import _align_rows, _rows_from_chars, _split_row_cells, _to_cell


def _char(text: str, x0: float, x1: float, y: float) -> dict:
    return {'text': text, 'y': y, 'bbox': (x0, y - 18, x1, y + 18)}


def _line(cells: list[tuple[str, float, float]], y: float) -> list[dict]:
    """一格串起来的字符 —— 模拟 PDF 文本层把整格合并成一个 span。"""
    out = []
    for text, x0, x1 in cells:
        step = (x1 - x0) / max(len(text), 1)
        for i, ch in enumerate(text):
            out.append(_char(ch, x0 + i * step, x0 + (i + 1) * step, y))
    return out


class TestSplitRowCells:
    """一行内切格：格子之间的大间距是唯一可靠的分隔信号。"""

    def test_splits_on_gap_larger_than_char_width(self):
        # 三个格子，格内字符紧挨（间隔 = 字宽 20），格间空 50
        chars = _line([('0000', 100, 180), ('0011', 230, 310), ('0101', 360, 440)], y=300)
        cells = _split_row_cells(chars)
        assert [c[0] for c in cells] == ['0000', '0011', '0101']

    def test_does_not_split_within_a_word(self):
        # 中文标题 `二进制码`，字与字之间无空隙，不该被切成四个格
        chars = _line([('二进制码', 100, 200)], y=300)
        cells = _split_row_cells(chars)
        assert [c[0] for c in cells] == ['二进制码']

    def test_keeps_subscript_attached(self):
        # `b` 与下标 `3` 之间只有极小的空隙（远小于字宽），必须留在一格里
        chars = [
            _char('b', 100, 120, 300),
            _char('3', 121, 131, 305),
            _char('b', 200, 220, 300),
            _char('2', 221, 231, 305),
        ]
        cells = _split_row_cells(chars)
        assert [c[0] for c in cells] == ['b3', 'b2']

    def test_cell_center_is_span_midpoint(self):
        chars = _line([('00', 100, 140)], y=300)
        cells = _split_row_cells(chars)
        assert cells[0][1] == pytest.approx(120.0)

    def test_empty_input(self):
        assert _split_row_cells([]) == []


class TestAlignRows:
    """把逐行切出的格对齐成矩形。列基准取格子最多的那一行。"""

    def test_uses_widest_row_as_reference(self):
        # 第 0 行只有 2 格（少了右半边），第 1 行有 4 格
        rows = [
            [('a', 100.0), ('b', 200.0)],
            [('w', 100.0), ('x', 200.0), ('y', 300.0), ('z', 400.0)],
        ]
        grid = _align_rows(rows)
        assert len(grid) == 2
        assert all(len(r) == 4 for r in grid)
        assert grid[0] == ['a', 'b', '', '']

    def test_places_cells_by_center_not_order(self):
        # 第 1 行缺中间的格：剩下的格必须按 x 归位，不能左移补空
        rows = [
            [('p', 100.0), ('q', 200.0), ('r', 300.0)],
            [('P', 100.0), ('R', 300.0)],
        ]
        grid = _align_rows(rows)
        assert grid[1] == ['P', '', 'R']

    def test_reference_ignores_split_header(self):
        """基准行不能被切碎的标题行带偏。

        实测场景：`二进制码` 被逐行切格切成 `二进` + `制码` 两半时，
        标题行的格数比数据行多，拿它当基准会把 16 列的表切成两列。
        """
        rows = [
            # 标题行：跨列标题被切成两半，格数最多
            [('左', 100.0), ('半', 260.0), ('右', 500.0)],
            # 数据行：格数少但占多数
            [('a', 100.0), ('b', 500.0)],
            [('c', 100.0), ('d', 500.0)],
            [('e', 100.0), ('f', 500.0)],
        ]
        grid = _align_rows(rows)
        assert all(len(r) == 2 for r in grid)
        # 被切成两半的标题应拼回一格（两半都落在第一列）
        assert grid[0] == ['左半', '右']

    def test_merges_cells_landing_in_same_column(self):
        # 同一列里落进两个格（跨列标题被切开）→ 按 x 顺序拼回去
        rows = [
            [('a', 100.0), ('b', 500.0)],
            [('左', 100.0), ('半', 180.0)],
            [('c', 100.0), ('d', 500.0)],
        ]
        grid = _align_rows(rows)
        assert grid[1][0] == '左半'

    def test_prefers_wider_header_when_mode_merges_cells(self):
        """表头比数据行宽时，众数基准会把两格并进一列。

        实测印刷页 40 的表2.1.1：原书 4 列（基本定律 / 或 / 与 / 非），
        数据行大量只填 2–3 格（或、与两列有上下两行合并），众数是 3，
        于是 `A·A=A` 和 `A=A` 被并进同一列 —— 读出来是 `A·A=AA=A`。
        """
        rows = [
            [('基本定律', 250.0), ('或', 520.0), ('与', 910.0), ('非', 1225.0)],
            [('0-1律', 250.0), ('A+0=A', 520.0), ('A·0=0', 910.0)],
            [('A+A=A', 520.0), ('A·A=A', 910.0), ('A=A', 1225.0)],
            [('结合律', 250.0), ('(A+B)+C', 520.0), ('(AB)C', 910.0)],
        ]
        grid = _align_rows(rows)
        assert len(grid[0]) == 4
        assert grid[0] == ['基本定律', '或', '与', '非']
        # 这一行原来会被并成 3 列里的 `A·A=AA=A`
        assert grid[2] == ['', 'A+A=A', 'A·A=A', 'A=A']

    def test_ignores_header_split_into_pieces(self):
        """表头被逐字切碎时不能当基准 —— 会造出整列没有数据的假列。

        实测印刷页 361 的表头 `引脚号功能` 被切成 `引|脚|功|能`。
        此时众数基准本来就不并格，没有换基准的理由。
        """
        rows = [
            [('引', 100.0), ('脚', 140.0), ('功', 180.0), ('能', 220.0), ('号', 260.0)],
            [('1', 100.0), ('VCC', 260.0)],
            [('2', 100.0), ('GND', 260.0)],
            [('3', 100.0), ('OUT', 260.0)],
        ]
        grid = _align_rows(rows)
        assert all(len(r) == 2 for r in grid)

    def test_header_found_below_cross_page_residue(self):
        """表格带首行是上一页的跨页残留时，表头在第二行。

        实测印刷页 28 的 ASCII 表：带的首行只有 1 格（`b?b?bs`，上一页表格
        的跨列表头），真正的表头 `b?b?b?b。|000|001|…|111` 在第二行。
        直接取 rows[0] 会把它当表头，整张表缩成一列。
        """
        rows = [
            [('b?b?bs', 400.0)],
            [('b?b?b?b。', 100.0), ('000', 200.0), ('001', 300.0), ('010', 400.0)],
            [('0000', 100.0), ('NUL', 200.0), ('DLE', 300.0)],
            [('0001', 200.0), ('SOH', 300.0), ('DC1', 400.0)],
            [('0010', 100.0), ('STX', 200.0), ('DC2', 300.0)],
        ]
        grid = _align_rows(rows)
        assert len(grid[0]) == 4
        assert grid[1] == ['b?b?b?b。', '000', '001', '010']

    def test_keeps_mode_when_header_has_no_extra_collisions(self):
        """表头更宽但众数基准本来就不并格时，不要换基准。"""
        rows = [
            [('a', 100.0), ('b', 200.0), ('c', 300.0), ('d', 400.0)],
            [('1', 100.0), ('2', 400.0)],
            [('3', 100.0), ('4', 400.0)],
        ]
        grid = _align_rows(rows)
        assert all(len(r) == 2 for r in grid)
        assert grid[0] == ['ab', 'cd']

    def test_single_row(self):
        assert _align_rows([[('x', 100.0)]]) == [['x']]

    def test_empty(self):
        assert _align_rows([]) == []


class TestRowsFromChars:
    """字符按 y 聚行。行内容差的容差必须容纳上下标。"""

    def test_subscripts_stay_on_one_row(self):
        # 同一行里 `G` 的 y=300，下标 `3` 的 y=307。差 7pt，应同行
        chars = []
        for i in range(4):
            x = 100 + i * 100
            chars.append(_char('0', x, x + 20, 300))
            chars.append(_char('1', x + 20, x + 40, 300))
        chars.append(_char('3', 100, 110, 307))
        rows = _rows_from_chars(chars)
        assert len(rows) == 1

    def test_separate_lines_stay_separate(self):
        # 行间距 37pt（实测表行间距 32–37），必须分成两行
        chars = _line([('00', 100, 140)], y=300) + _line([('01', 100, 140)], y=337)
        rows = _rows_from_chars(chars)
        assert len(rows) == 2


class TestToCell:
    def test_joins_text_and_computes_midpoint(self):
        elems = [
            {'text': '1', 'bbox': (100, 0, 120, 40)},
            {'text': '2', 'bbox': (121, 0, 141, 40)},
        ]
        text, cx = _to_cell(elems)
        assert text == '12'
        assert cx == pytest.approx((100 + 141) / 2)

    def test_single_element(self):
        text, cx = _to_cell([{'text': '0', 'bbox': (100, 0, 120, 40)}])
        assert (text, cx) == ('0', pytest.approx(110.0))
