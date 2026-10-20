"""assign.py 的测试。

两个函数各自有一条硬性质要守：
- `owner_of` 必须把页码映射到**唯一**叶节点，且不能把区间外的页硬塞给首节点
- `is_answer_block` 必须能拒绝「同页但只讲背景」的段落 —— 这是 ADR-0001
  检索门控能否成立的前提（误标 = 答案提前泄露）
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from assign import _core_terms, assign, is_answer_block, leaf_page_ranges, owner_of
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
