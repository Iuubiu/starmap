"""目录 → 知识点节点的测试。

这里守两条性质：

1. **章节附件识别必须是整名匹配**。「小结」「习题」「附录」不是可学知识点，
   但 `'小结' in title` 这种子串判据会误伤真知识点 —— 实测 18《原子核物理
   实验方法》第 16 章有「脉冲探测器性能小结」，子串匹配会把它一起降级，
   连带丢掉整章的正文归属。
2. **附件不能是叶节点，但必须仍占自己的页区间**。前者由 `isLeaf=False`
   实现（TS 侧地图/掌握度/出题三处都只认 `is_leaf`），后者由
   `assign.leaf_page_ranges` 单独处理。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from toc import (  # noqa: E402
    TocEntry,
    _source_short,
    build_tree,
    flatten,
    is_answer_key_title,
    is_appendix_title,
    nodes_from_flat,
    parse_toc_text,
)


class TestIsAppendixTitle:
    def test_chapter_end_sections_are_appendix(self):
        for title in (
            '小结',
            '本章小结',
            '习题',
            '思考题',
            '复习思考题',
            '习题与思考题',
            '思考题与练习题',
            '自测题',
            '部分习题答案',
            '参考文献',
            '中英名词对照',
        ):
            assert is_appendix_title(title), title

    def test_appendix_prefixed_titles_are_appendix(self):
        # 没有编号的附录标题带正题（康华光数字部分实测）
        assert is_appendix_title('附录ACMOS和TTL逻辑门电路的技术参数')
        assert is_appendix_title('附录')
        assert is_appendix_title('附录I')
        assert is_appendix_title('附 录 二')

    def test_trailing_paren_is_stripped_before_matching(self):
        """25《电路分析基础》印的是「部分习题答案（上册）」。"""
        assert is_appendix_title('部分习题答案（上册）')
        assert is_appendix_title('部分习题答案(下册)')

    def test_real_knowledge_point_containing_the_word_is_kept(self):
        """18《原子核物理实验方法》第 16 章的真知识点 —— 绝不能降级。"""
        assert not is_appendix_title('脉冲探测器性能小结')
        assert not is_appendix_title('系统的基本组成')
        assert not is_appendix_title('核电子学中的噪声')

    def test_empty_and_punctuation_only_are_not_appendix(self):
        assert not is_appendix_title('')
        assert not is_appendix_title('、')


def _entry(num: str, title: str, page: int) -> tuple[str, str, int]:
    return (num, title, page)


class TestBareAppendixEntries:
    """无编号附件条目（附录/参考文献/索引/部分习题答案）必须进目录树。

    这一组守的是一个真实事故：康华光数字部分的目录末页有 13 条无编号条目，
    `_ENTRY` 要求行首点分编号、`_BARE` 只白名单 4 个词，于是全被静默跳过。
    后果不是「少几个节点」——`assign.leaf_page_ranges` 让最后一个叶子
    `kp-...-p501-习题` 的区间开到书末，把 p530–536 的整本答案吞成「习题
    正文」，答案块门控从此认不出它们。实测 300 次检索里 29 次放行答案。
    """

    # 这本书目录末页的真实 13 行（`pymupdf.get_text()` 原文，省略号保留）
    REAL_LINES = """小结⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯500
习题⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯501
附录ACMOS和TTL逻辑门电路的技术参数⋯⋯⋯⋯⋯⋯504
附录BQuartusⅡ 5.0开发软件简介⋯⋯⋯⋯⋯⋯⋯505
B.1基于Quartus Ⅱ软件的设计流程⋯⋯⋯⋯⋯⋯⋯505
B.2 Quartus Ⅱ软件的使用简介⋯⋯⋯⋯⋯⋯⋯507
附录C电气简图用图形符号——二进制逻辑元件
(GB/T4728.12—1996)简介⋯⋯⋯⋯⋯⋯⋯⋯⋯516
C.1二进制逻辑元件图形符号的组成⋯⋯⋯⋯⋯⋯516
C.2限定符号⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯518
C.3关联标注法⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯520
附录D常用逻辑符号对照表⋯⋯⋯⋯⋯⋯⋯⋯⋯522
参考文献⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯524
索引(汉英对照)⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯526
部分习题答案⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯⋯530"""

    def test_real_toc_tail_entries_are_parsed(self):
        out = parse_toc_text(self.REAL_LINES)
        names = {t for _num, t, _p in out}
        assert '部分习题答案' in names
        assert '参考文献' in names
        assert '索引(汉英对照)' in names
        assert '附录D常用逻辑符号对照表' in names
        # 附录小节（B.1/C.1）不该当顶级条目收进来：它们要挂在附录B下面，
        # 而附录B 建成非叶之后它们的归属会按页区间落到 B 名下。
        assert not any(t.startswith(('B.1', 'B.2', 'C.1', 'C.2', 'C.3')) for t in names), names
        # 小结/习题仍由 `_BARE` 收，不能被新规则改坏
        assert {'小结', '习题'} <= names

    def test_answer_appendix_is_marked_and_gets_own_interval(self):
        """答案附录必须是独立节点：与「习题」同页区间不重叠才拦得住答案。"""
        tree = build_tree(parse_toc_text(self.REAL_LINES))
        nodes = nodes_from_flat(flatten(tree, source_id='digital-kanghua-5e'))
        by_name = {n['name']: n for n in nodes}
        answer = by_name['部分习题答案']
        assert answer['answerKey'] is True
        assert answer['isLeaf'] is False
        assert answer['printedPage'] == 530
        # 「习题」停在 p501，答案在 p530，两者不再共用一个 id
        assert by_name['习题']['printedPage'] == 501
        assert by_name['习题']['microKpId'] != answer['microKpId']

    def test_numbered_appendix_subsections_still_use_entry(self):
        """带编号的 `5.5.2 锁存器…` 仍走 `_ENTRY`，不能被新规则抢走编号。"""
        out = parse_toc_text('5.5.2锁存器和触发器的Verilog建模实例⋯⋯233')
        assert out == [('5.5.2', '锁存器和触发器的Verilog建模实例', 233)], out


class TestIsAnswerKeyTitle:
    """答案附录判定 —— 票 09 的答案门控靠这个标记，不能宽也不能窄。

    这 4 条是全 12 本实测命中的全部答案附录（`answerKey=true`），库侧
    `is_answer_key` 列就由它填充。宽一寸（`'答案' in title`）会把正文里
    带「答案」二字的真知识点当成答案附录；窄一寸会把「部分自测题和习题答案」
    漏掉，那 98 个 chunk 就又变成检索里放行的答案。
    """

    def test_the_four_real_answer_appendix_titles(self):
        for title in ('部分习题答案', '部分自测题和习题答案', '部分习题答案（上册）', '参考答案'):
            assert is_answer_key_title(title), title

    def test_answer_synonyms_are_answer_key(self):
        assert is_answer_key_title('习题解答')
        assert is_answer_key_title('题解')

    def test_appendix_but_not_answer_is_not_answer_key(self):
        """小结/习题/思考题/附录/参考文献都是附件，但不是答案汇编。"""
        for title in ('小结', '本章小结', '习题', '思考题', '自测题', '附录', '参考文献', 'Ⅴ目录', '［附录］'):
            assert is_appendix_title(title), title
            assert not is_answer_key_title(title), title

    def test_real_knowledge_points_are_not_answer_key(self):
        # 「脉冲探测器性能小结」是真知识点，不能因为带「小结」就成答案附录
        assert not is_answer_key_title('脉冲探测器性能小结')
        assert not is_answer_key_title('答案要点')
        assert not is_answer_key_title('系统的基本组成')

    def test_empty_is_not_answer_key(self):
        assert not is_answer_key_title('')
        assert not is_answer_key_title('、')

    def test_node_dict_carries_answer_key(self):
        """入库字段：`answerKey` 必须出现在节点字典里，缺了 import 就写不进库。"""
        tree = build_tree([_entry('1', '第一章', 1), _entry('', '部分习题答案', 300)])
        nodes = nodes_from_flat(flatten(tree, source_id='digital-kanghua-5e'))
        answer = [n for n in nodes if n['name'] == '部分习题答案']
        assert answer, nodes
        assert answer[0]['answerKey'] is True
        assert answer[0]['isLeaf'] is False
        # 普通附件不得被打上答案标记，否则检索侧会把习题也当答案拦
        plain = build_tree([_entry('1', '第一章', 1), _entry('', '习题', 20)])
        nodes = nodes_from_flat(flatten(plain, source_id='digital-kanghua-5e'))
        assert all(n['answerKey'] is False for n in nodes), nodes

    def test_answer_key_appendix_under_a_chapter(self):
        """答案附录按目录惯例挂在章下面，标记不能因为它有父节点就丢。"""
        tree = build_tree([_entry('1', '第一章', 1), _entry('1.1', '节', 2), _entry('', '部分习题答案', 40)])
        nodes = {n['name']: n for n in nodes_from_flat(flatten(tree, source_id='x-5e'))}
        assert nodes['部分习题答案']['answerKey'] is True
        assert nodes['部分习题答案']['isLeaf'] is False


class TestNodesFromFlat:
    def test_appendix_entry_becomes_non_leaf_with_flag(self):
        tree = build_tree([_entry('1', '数字逻辑概论', 1), _entry('', '习题', 30)])
        nodes = nodes_from_flat(flatten(tree))
        by_name = {n['name']: n for n in nodes}
        assert by_name['习题']['isLeaf'] is False
        assert by_name['习题']['appendix'] is True
        # 章本身不是叶（有子节点），但也不是附件
        assert by_name['数字逻辑概论']['isLeaf'] is False
        assert by_name['数字逻辑概论']['appendix'] is False

    def test_real_leaf_stays_leaf(self):
        tree = build_tree([_entry('1', '章', 1), _entry('1.1', '脉冲探测器性能小结', 12)])
        nodes = nodes_from_flat(flatten(tree))
        leaf = [n for n in nodes if n['name'] == '脉冲探测器性能小结'][0]
        assert leaf['isLeaf'] is True
        assert leaf['appendix'] is False

    def test_appendix_with_children_is_not_flagged(self):
        """带子节的附录（康华光「附录A」下面挂几个参数小节）本来就是容器节点。

        它的小节是具体参数表，留着当知识点比合并更可核验，所以不标
        appendix —— 标了会让 `leaf_page_ranges` 把父子两个都当区间所有者。
        """
        tree = build_tree([_entry('1', '章', 1), _entry('', '附录A逻辑门参数', 500)])
        # 附录行没有编号，build_tree 会把它挂到章下面成为子节点；
        # 这里手工给它的子节点，模拟「附录里还有小节」的真实形态。
        appendix = tree[0].children[-1]
        appendix.appendix = True
        appendix.children.append(TocEntry(num='', title='A.1 参数表', printed_page=501))
        nodes = nodes_from_flat(flatten(tree))
        by_name = {n['name']: n for n in nodes}
        assert by_name['附录A逻辑门参数']['appendix'] is False
        assert by_name['附录A逻辑门参数']['isLeaf'] is False
        assert by_name['A.1 参数表']['isLeaf'] is True


class TestSourceNamespace:
    """跨书命名空间：12 本书都有 `kp-1`，不加前缀入库时互相覆盖。

    实测（captain 在真库上复现）：2416 个节点只有 1531 个 unique id，跨书重复
    301 个、49% 节点被改掉 source_id —— 而前一本书的 chunk 仍指着这个 id。
    """

    def test_ids_are_namespaced_by_source(self):
        tree = build_tree([_entry('1', '章', 1), _entry('1.1', '节', 2)])
        ids = [nid for nid, _n, _p in flatten(tree, source_id='digital-kanghua-5e')]
        assert ids == ['kp-kanghua-5e-1', 'kp-kanghua-5e-1-1'], ids

    def test_same_numbering_in_two_books_does_not_collide(self):
        tree = build_tree([_entry('1', '章', 1)])
        a = {nid for nid, _n, _p in flatten(tree, source_id='digital-kanghua-5e')}
        b = {nid for nid, _n, _p in flatten(tree, source_id='digital-electronics-yanshi-6e')}
        assert not (a & b), '两本书的 kp-1 必须不同'

    def test_appendix_ids_are_namespaced_too(self):
        tree = build_tree([_entry('1', '章', 1), _entry('', '小结', 30)])
        ids = [nid for nid, _n, _p in flatten(tree, source_id='digital-kanghua-5e')]
        assert 'kp-kanghua-5e-p30-小结' in ids, ids

    def test_ids_are_stable_across_runs(self):
        """重跑同一本书必须得到同样的 id（不能随机/哈希）。"""
        tree = build_tree([_entry('1', '章', 1), _entry('1.1', '节', 2)])
        first = [nid for nid, _n, _p in flatten(tree, source_id='nuclear-electronics-wangzhiying-1989')]
        second = [nid for nid, _n, _p in flatten(tree, source_id='nuclear-electronics-wangzhiying-1989')]
        assert first == second

    def test_all_twelve_books_get_distinct_prefixes(self):
        ids = [
            'digital-kanghua-5e',
            'nuclear-electronics-wangzhiying-1989',
            'nuclear-electronics-wangjingjin-1983',
            'nuclear-radiation-measurement-tangbin',
            'nuclear-radiation-physics-chenboxian-2011',
            'radiation-detectors-dinghonglin-2010',
            'nuclear-physics-experiment-methods-1997',
            'radiation-detector-handbook-jichangsong-1990',
            'analog-electronics-kanghuaguang-5e',
            'digital-electronics-yanshi-6e',
            'analog-electronics-tongshibai-5e',
            'circuit-analysis-lihansun-5e-vol1',
        ]
        shorts = [_source_short(i) for i in ids]
        assert len(set(shorts)) == len(ids), shorts

    def test_duplicate_suffix_still_applies_within_one_book(self):
        """书内重复仍要加 `-2`，与书级前缀是两层修复。"""
        tree = build_tree([_entry('1', '章甲', 1), _entry('1', '章乙', 5)])
        ids = [nid for nid, _n, _p in flatten(tree, source_id='digital-kanghua-5e')]
        assert ids == ['kp-kanghua-5e-1', 'kp-kanghua-5e-1-2'], ids
