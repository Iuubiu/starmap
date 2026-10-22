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
    owners_at,
)
from chunk import Chunk


def _node(kp_id: str, name: str, page: int, is_leaf: bool = True, appendix: bool = False) -> dict:
    return {
        'microKpId': kp_id,
        'name': name,
        'printedPage': page,
        'isLeaf': is_leaf,
        'appendix': appendix,
        'depth': 1,
    }


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

    def test_same_page_leaves_share_the_same_range(self):
        """两个叶子印在同一页（实测王芝英 20 组）共享 `[p, 下一个不同起始页)`。

        t30 之前是「第几条就往后推几页」，正文里看似无害，但附录区一页能并列
        3–6 个条目，偏移量累积会把整组推过书末（汲长松 30 个附录条目被推到
        `[580, 1000000)`，而书只有 562 页）。现在共享同一段区间，一页的内容
        归谁由 `assign()` 按 chunk 顺序切块决定。
        """
        ranges = leaf_page_ranges([_node('a', '甲', 7), _node('b', '乙', 7), _node('c', '丙', 9)])
        assert ranges[0] == ('a', '甲', 7, 9)
        assert ranges[1] == ('b', '乙', 7, 9)
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
        # p164 并列两条：`owner_of` 返回目录顺序第一条（kp-4-3-3 在 kp-5 之前），
        # 但真实归属由 `assign()` 按 chunk 顺序切块 —— 两条都在 `owners_at()` 里。
        assert owner_of(200, ranges) == ('kp-4-3-3', '逐次比较型模数变换器')
        assert [o[0] for o in owners_at(200, ranges)] == ['kp-4-3-3', 'kp-5']
        assert owner_of(300, ranges) == ('kp-6', '数据获取和处理')


class TestNoOverflow:
    """t30 的硬判据：区间不允许被推出书末，同页内容按顺序切块而不是推后。

    这些用例的数字全部来自真实产物（汲长松 1990 附录区、methods-1997），
    不是构造出来的极端值 —— 缺陷本身是真实数据暴露的。
    """

    def test_start_is_always_the_printed_page(self):
        """`start` 恒等于条目自己的印刷页码 —— 一个偏移都不加。

        这就是「区间不可能被推出书末」的充分条件：只要目录页码不超过书末，
        `start` 就不超过书末。附录区 30 个条目把区间推到 580（书只有 562 页）
        的那个缺陷，在这一条上不可能复发。
        """
        pages = [1, 1, 1, 2, 2, 5, 550, 550, 550, 550, 557, 557, 557, 557]
        nodes = [_node(f'n{i}', f'名{i}', p) for i, p in enumerate(pages)]
        by_id = {r[0]: r for r in leaf_page_ranges(nodes)}
        for i, p in enumerate(pages):
            assert by_id[f'n{i}'][2] == p, f'第 {i} 条的 start 应该是 {p}'

    def test_no_start_past_the_last_page(self):
        """同页并列 30 个条目也不会把 start 推过 maxPage + 1（汲长松实测场景）。"""
        pages = [549] + [550] * 3 + [552] * 2 + [555] * 2 + [557] * 4 + [558] * 2
        pages += [559] * 4 + [560] * 3 + [561] * 6 + [562] * 2
        nodes = [_node(f'n{i}', f'名{i}', p) for i, p in enumerate(pages)]
        max_page = max(pages)
        for _kp, _name, start, _end in leaf_page_ranges(nodes):
            assert start <= max_page + 1, '区间被推出书末'

    def test_last_page_chunks_do_not_go_to_early_appendix(self):
        """p559–p562 的 chunk 归 `source_page` 就在这几页的节点，不得归 549/550 的。

        修复前汲长松的 32 个 chunk（p559–562）全挂到 `source_page` 549–552 的
        条目上 —— 「希腊字母及其读音」那页的名字变成了「附录1」。
        """
        nodes = [
            _node('a549', '附录1', 549, is_leaf=False, appendix=True),
            _node('a550', '化学元素周期表', 550, is_leaf=False, appendix=True),
            _node('b559', '希腊字母及其读音', 559, is_leaf=False, appendix=True),
            _node('b560', '单位换算表', 560, is_leaf=False, appendix=True),
            _node('b562', '换算表', 562, is_leaf=False, appendix=True),
        ]
        chunks = [
            _chunk('c549', 549, '附录1 的正文'),
            _chunk('c559a', 559, '希腊字母 α β γ'),
            _chunk('c559b', 559, '读音表'),
            _chunk('c562', 562, '换算表'),
        ]
        assign(chunks, nodes)
        assert chunks[1].micro_kp_id == 'b559'
        assert chunks[2].micro_kp_id == 'b559'
        assert chunks[3].micro_kp_id == 'b562'

    def test_same_page_chunks_are_split_in_reading_order(self):
        """同页多条按 chunk 顺序**连续切块**，不是轮转。

        轮转会让一页的正文在几个知识点之间来回跳（a1 b1 c1 a2 b2），读起来是
        碎的；切块是 a1 a2 b1 b2 c1 —— 同一条内容保持连续。
        """
        nodes = [_node('a', '甲', 7), _node('b', '乙', 7), _node('c', '丙', 7)]
        chunks = [_chunk(f'c{i}', 7, f'第{i}段') for i in range(5)]
        assign(chunks, nodes)
        assert [c.micro_kp_id for c in chunks] == ['a', 'a', 'b', 'b', 'c']

    def test_leaf_wins_over_appendix_when_there_is_only_one_chunk(self):
        """一页并列多个条目只有 1 个 chunk 时，叶节点优先拿，附件饿着。

        附件是「小结/习题/附录」这类容器，零内容不影响地图与掌握度；微知识点
        零内容会让它在图谱上永远是一块空白。汲长松 p557 正是这种混排
        （附录5 / 常用物理常数表 / 附录6 / 基本粒子表）。
        """
        nodes = [
            _node('ex5', '附录5', 557, is_leaf=False, appendix=True),
            _node('kp-phys', '常用物理常数表', 557),
            _node('ex6', '附录6', 557, is_leaf=False, appendix=True),
            _node('kp-particle', '基本粒子表', 557),
        ]
        chunks = [_chunk('c1', 557, '唯一的正文')]
        assign(chunks, nodes)
        assert chunks[0].micro_kp_id == 'kp-phys', '叶节点优先'

    def test_owners_at_is_deterministic(self):
        """`owners_at()` 在同一并列组上永远返回同一顺序 —— 归属必须可复现。"""
        nodes = [_node(f'n{i}', f'名{i}', 7) for i in range(5)] + [_node('z', '尾', 9)]
        ranges = leaf_page_ranges(nodes)
        first = [o[0] for o in owners_at(7, ranges)]
        for _ in range(5):
            assert [o[0] for o in owners_at(7, ranges)] == first
        assert first == ['n0', 'n1', 'n2', 'n3', 'n4']
        # p7 的组一直占到自己 end=9（下一个不同起始页），所以 p8 仍是同一组
        assert [o[0] for o in owners_at(8, ranges)] == first
        # 目录第一条之前的页没有所有者
        assert owners_at(5, ranges) == ()


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


class TestAppendixNodes:
    """章节附件（小结/习题/附录）不是知识点，但仍要占住自己的页区间。

    两个性质一起守，缺一个都会坏：
    - 附件**不占**叶子身份，否则地图上多出「习题」格子、掌握度把习题算进
      章节、出题器拿习题当考点；
    - 附件**占住**页区间，否则那几页会被相邻知识点按页区间吞掉 —— 康华光
      20 个附件节点挂着 707 个 chunk（20%），并回相邻知识点会同时污染两侧。
    """

    def test_appendix_node_owns_its_pages_but_is_not_a_leaf(self):
        nodes = [
            _node('a', '甲', 1),
            dict(_node('ex', '本章小结', 5, is_leaf=False), appendix=True),
            _node('b', '乙', 9),
        ]
        ranges = leaf_page_ranges(nodes)
        assert [r[0] for r in ranges] == ['a', 'ex', 'b']
        assert ranges[1] == ('ex', '本章小结', 5, 9)

    def test_appendix_chunks_are_counted_separately_from_leaves(self):
        nodes = [
            _node('a', '甲', 1),
            dict(_node('ex', '习题', 5, is_leaf=False), appendix=True),
        ]
        chunks = [_chunk('c1', 2, '甲的正文'), _chunk('c2', 6, '习题题干')]
        assign(chunks, nodes)
        assert chunks[1].micro_kp_id == 'ex'
        a = audit_assignment(chunks, nodes)
        # 附件不进叶子的分母，否则会凭空多出一个「零内容叶子」
        assert a['leafCount'] == 1
        assert a['emptyLeaves'] == []
        assert a['appendixCount'] == 1
        assert a['appendixChunks'] == 1

