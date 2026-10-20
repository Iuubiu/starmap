"""assign.py 的测试。

两个函数各自有一条硬性质要守：
- `owner_of` 必须把页码映射到**唯一**叶节点，且不能把区间外的页硬塞给首节点
- `is_answer_block` 必须能拒绝「同页但只讲背景」的段落 —— 这是 ADR-0001
  检索门控能否成立的前提（误标 = 答案提前泄露）
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from assign import (
    _core_terms,
    assign,
    audit_assignment,
    is_answer_block,
    leaf_page_ranges,
    owner_of,
)
from chunk import Chunk


def _node(kp_id: str, name: str, page: int, is_leaf: bool = True) -> dict:
    return {'microKpId': kp_id, 'name': name, 'printedPage': page, 'isLeaf': is_leaf, 'depth': 1}


class TestLeafRanges:
    def test_ranges_are_left_closed_right_open(self):
        nodes = [_node('a', '甲', 1), _node('b', '乙', 5), _node('c', '丙', 9)]
        ranges = leaf_page_ranges(nodes)
        assert ranges[0] == ('a', '甲', 1, 5)
        assert ranges[1] == ('b', '乙', 5, 9)
        # 最后一个叶节点兜住书末
        assert ranges[2][0] == 'c' and ranges[2][3] > 10_000

    def test_non_leaf_is_skipped(self):
        nodes = [_node('ch', '章', 1, is_leaf=False), _node('a', '甲', 1)]
        assert [r[0] for r in leaf_page_ranges(nodes)] == ['a']

    def test_same_page_leaves_both_get_a_non_empty_range(self):
        """两个叶子印在同一页（实测王芝英 20 组）不能把前一个饿死成 `[p,p)`。

        原来的实现「end = 下一个叶子的 start」在并列时给出空区间，前一个叶子
        永远匹配不到任何页 —— `kp-2-2 电荷灵敏前置放大器` 就是这样 0 chunk 的，
        而它的内容真实存在（修复后 71 chunk）。
        """
        ranges = leaf_page_ranges([_node('a', '甲', 7), _node('b', '乙', 7), _node('c', '丙', 9)])
        assert ranges[0] == ('a', '甲', 7, 8)
        assert ranges[1] == ('b', '乙', 8, 9)
        assert ranges[2] == ('c', '丙', 9, 10**6)

    def test_every_range_is_non_empty(self):
        """任意输入下 `end > start` 都必须成立 —— 空区间等于静默丢知识点。"""
        nodes = [_node(f'n{i}', f'名{i}', p) for i, p in enumerate([1, 1, 1, 2, 2, 5])]
        for _kp, _name, start, end in leaf_page_ranges(nodes):
            assert end > start

    def test_page_regression_does_not_steal_earlier_pages(self):
        """目录页码倒退（实测王芝英 16 处）不能让后来者覆盖已占住的页。"""
        ranges = leaf_page_ranges([_node('a', '甲', 28), _node('b', '乙', 25), _node('c', '丙', 40)])
        by_id = {r[0]: r for r in ranges}
        # 按页码排序后 b(25) 在 a(28) 前面，区间首尾相接且递增
        assert by_id['b'][2] == 25 and by_id['b'][3] == 28
        assert by_id['a'][2] == 28 and by_id['a'][3] == 40
        assert owner_of(26, ranges) == ('b', '乙')
        assert owner_of(30, ranges) == ('a', '甲')

    def test_last_leaf_by_page_absorbs_tail_not_last_in_document_order(self):
        """`end = 10**6` 只能给**页码最大**的叶子，不能给目录里排最后那个。

        原实现按目录出现顺序取最后一个叶子。王芝英的 `kp-5 时间分析`(p164)
        排在 `kp-p142 …`(p142) 后面却是最后一个，于是它吞掉 p164 到书末 ——
        实测 2585/4884 = 52.9%。
        """
        nodes = [
            _node('kp-4-3-3', '逐次比较型模数变换器', 164),
            _node('kp-p142', '、用于幅度分析的模数变换器', 142),
            _node('kp-5', '时间分析', 164),
            _node('kp-6', '数据获取和处理', 252),
        ]
        ranges = leaf_page_ranges(nodes)
        by_id = {r[0]: r for r in ranges}
        assert by_id['kp-6'][3] == 10**6, '页码最大的叶子才兜书末'
        assert by_id['kp-5'][3] == 252, 'p164 的叶子不能吞到书末'
        assert owner_of(200, ranges) == ('kp-5', '时间分析')
        assert owner_of(300, ranges) == ('kp-6', '数据获取和处理')


class TestOwnerOf:
    def test_boundary_page_belongs_to_later_node(self):
        """页 5 同时是「甲」的结束和「乙」的开始，按左闭右开应归乙。"""
        ranges = leaf_page_ranges([_node('a', '甲', 1), _node('b', '乙', 5)])
        assert owner_of(5, ranges) == ('b', '乙')

    def test_page_before_all_ranges_returns_none(self):
        """封面页码小于所有目录区间，不能硬塞给第一个知识点。"""
        ranges = leaf_page_ranges([_node('a', '甲', 10)])
        assert owner_of(3, ranges) is None

    def test_last_node_absorbs_tail(self):
        ranges = leaf_page_ranges([_node('a', '甲', 1), _node('b', '乙', 5)])
        assert owner_of(999, ranges) == ('b', '乙')


class TestIsAnswerBlock:
    def test_definition_sentence_is_answer(self):
        text = '把若干个逻辑变量用运算符连接起来，称为逻辑函数表达式。'
        assert is_answer_block(text, 'text', ['逻辑函数']) is True

    def test_background_paragraph_is_not_answer(self):
        """同页讲历史的段落不能标为答案块 —— 它回答不了「X 是什么」。"""
        text = '电子技术是20世纪发展最迅速的技术，已使工业、农业与科研发生深刻变化。'
        assert is_answer_block(text, 'text', ['数字技术']) is False

    def test_formula_is_answer_regardless_of_naming(self):
        """
        公式块不看文本是否提及知识点名。

        实测依据：795 个公式块里只有 30% 提到所属知识点名，59 个表格块是 0%
        （真值表正文全是 `0 | 0001`）。要求提及会把真值表整类漏标，
        而真值表正是数字电路最典型的答案。
        """
        assert is_answer_block('Y = A + BC', 'formula', ['逻辑函数']) is True

    def test_table_is_answer_regardless_of_naming(self):
        assert is_answer_block('0 | 0001 | 0011', 'table', ['真值表']) is True

    def test_text_chunk_needs_both_term_and_definition_marker(self):
        """定义型必须两条都满足，只有术语没有定义句式不算。"""
        # 有术语、有定义句式
        assert is_answer_block('把变量用运算符连接，称为逻辑函数。', 'text', ['逻辑函数']) is True
        # 有术语、无定义句式（是在讲应用）
        assert is_answer_block('逻辑函数在化简时会用到卡诺图。', 'text', ['逻辑函数']) is False

    def test_prose_mislabeled_as_formula_is_rejected(self):
        """
        实测 p.106 那种段落被 extract 判成了 formula（因为它含 `<` 与 `=`）。
        若规则 (A) 无条件信任 kind，这整段散文会被标成答案块，直接破坏门控。
        """
        prose = (
            '当输入为低电平，并且v?<V?时，T,管截止，输出为高电平，使T?导通，'
            '并且T,管导通时的栅源电压vcs为0.7 V,因此将输出电压v。钳位在0.7V。'
        )
        assert is_answer_block(prose, 'formula', ['开关特性']) is False

    def test_real_formula_still_passes_prose_check(self):
        """挡散文的判据不能把真公式一起挡掉。"""
        assert is_answer_block('(N)D=b0×2n−1+b1×2n−2+⋯+bn−1×20', 'formula', ['数制']) is True


class TestCoreTerms:
    def test_strips_number_prefix(self):
        assert '1.1.1' not in ''.join(_core_terms('1.1.1 数字技术的发展及其应用'))

    def test_splits_on_function_words(self):
        assert _core_terms('1.1.1 数字技术的发展及其应用') == ['数字技术', '发展', '应用']

    def test_keeps_parenthetical_synonym(self):
        """正文常用括号里的说法，漏掉它会让这个知识点永远匹配不到答案块。"""
        assert '真值表' in _core_terms('2.4 逻辑函数的表示方法（真值表）')

    def test_latin_terms_not_truncated(self):
        terms = _core_terms('10.4.1 交通灯控制系统的Verilog HDL描述')
        assert 'Verilog' in terms
        assert not any(t.startswith('Verilo') and t != 'Verilog' for t in terms)


def _chunk(cid: str, page: int, text: str, kind: str = 'text') -> Chunk:
    return Chunk(
        id=cid,
        source_id='test',
        kind=kind,
        text=text,
        printed_page=page,
        pdf_page=page,
        bbox=[0, 0, 1, 1],
        heading_path=[],
    )


class TestAssign:
    def test_chunk_before_first_leaf_gets_no_kp(self):
        nodes = [_node('a', '甲', 10)]
        chunks = [
            _chunk('c1', 2, '封面文字' * 5),
            _chunk('c2', 10, '甲是一种东西，称为甲。'),
        ]
        assign(chunks, nodes)
        assert chunks[0].micro_kp_id is None
        assert chunks[1].micro_kp_id == 'a'

    def test_answer_for_defaults_to_empty_list_not_none(self):
        """下游 import 直接读这个字段，None 会让它崩在 `for kp in ...` 上。"""
        nodes = [_node('a', '甲', 1)]
        chunks = [_chunk('c1', 20, '无关的一段背景叙述文字')]
        assign(chunks, nodes)
        assert chunks[0].answer_for == []


class TestAuditAssignment:
    """自检必须能抓住「目录解析坏了但 assign 照样成功」这种静默错误。

    修复前的王芝英就是典型：4884 个 chunk 全部拿到了 `micro_kp_id`，
    `assign` 一声不响，实际上 52.9% 挤在一个节点、37.7% 的叶子零内容。
    没有这层自检，t17 会把这份坏目录原样建成图谱。
    """

    def test_clean_assignment_raises_no_warning(self):
        nodes = [_node(f'n{i}', f'知识点{i}', i * 10 + 1) for i in range(10)]
        chunks = [_chunk(f'c{i}', 3 + i * 10, f'知识点{i}的正文内容') for i in range(10)]
        assign(chunks, nodes)
        assert audit_assignment(chunks, nodes)['warnings'] == []

    def test_flags_one_node_swallowing_the_book(self):
        """一个节点吃掉一半以上内容 —— 王芝英修复前 `kp-5` 正是 52.9%。"""
        nodes = [_node('a', '甲', 1), _node('b', '乙', 100)]
        chunks = [_chunk(f'c{i}', 5, f'正文{i}') for i in range(10)] + [
            _chunk('c_tail', 120, '尾部正文')
        ]
        assign(chunks, nodes)
        a = audit_assignment(chunks, nodes)
        assert a['largest'] == 'a'
        assert a['largestShare'] > 0.25
        assert any('吞掉' in w for w in a['warnings'])

    def test_flags_mostly_empty_leaves(self):
        """大量叶子零内容 —— 同页并列把区间挤空时的症状。"""
        nodes = [_node(f'n{i}', f'知识点{i}', 5) for i in range(10)]
        chunks = [_chunk('c1', 5, '唯一有内容的一页')]
        assign(chunks, nodes)
        a = audit_assignment(chunks, nodes)
        assert len(a['emptyLeaves']) >= 8
        assert any('零 chunk' in w for w in a['warnings'])

    def test_empty_chunk_list_does_not_crash(self):
        a = audit_assignment([], [_node('a', '甲', 1)])
        assert a['total'] == 0 and a['largestShare'] == 0.0

