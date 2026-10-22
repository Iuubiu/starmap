"""先修边构建的测试。

核心断言只有一句：**没有证据的边不能出现**。这条比「能建出多少边」重要 ——
一条编出来的先修边会让门控挡住本来该学的知识点，而且看不出错在哪。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from edges import build_edges, summarize  # noqa: E402


def _toc(spec):
    """spec: [(id, num, page, is_leaf, parent)]"""
    return [
        {
            'microKpId': i,
            'num': num,
            'printedPage': page,
            'isLeaf': leaf,
            'parentId': parent,
            'name': f'节点{i}',
            'depth': len(num.split('.')),
        }
        for i, num, page, leaf, parent in spec
    ]


# 形状取自真书：节（1.1）底下挂小节（1.1.1 / 1.1.2），小节才是叶节点。
# 公式引用在书里总是三级（式(1.1.1)），所以夹具必须有三级节点，
# 否则测的是「编号不存在」分支而不是建边。
TOC = _toc(
    [
        ('kp-1', '1', 1, False, None),
        ('kp-1-1', '1.1', 2, False, 'kp-1'),
        ('kp-1-1-1', '1.1.1', 3, True, 'kp-1-1'),
        ('kp-1-1-2', '1.1.2', 5, True, 'kp-1-1'),
        ('kp-1-2', '1.2', 10, False, 'kp-1'),
        ('kp-1-2-1', '1.2.1', 11, True, 'kp-1-2'),
        ('kp-2', '2', 40, False, None),
        ('kp-2-1', '2.1', 41, True, 'kp-2'),
    ]
)


def _chunk(cid, owner, page, text):
    return {'id': cid, 'micro_kp_id': owner, 'printed_page': page, 'text': text}


def test_backward_reference_to_leaf_creates_one_prereq_edge():
    """「如 1.1.1 节所述」出现在 1.2.1 里 ⇒ 1.1.1 是 1.2.1 的先修。"""
    chunks = [_chunk('c1', 'kp-1-2-1', 11, '如1.1.1节所述，先做这一步。')]
    edges, _ = build_edges(chunks, TOC)
    assert len(edges) == 1
    e = edges[0]
    assert (e['fromId'], e['toId'], e['kind']) == ('kp-1-1-1', 'kp-1-2-1', 'prereq')


def test_forward_reference_creates_no_edge():
    """「将在 2.1 节介绍」是后继不是先修，建边就会把因果反过来。"""
    chunks = [_chunk('c1', 'kp-1-2-1', 11, '这个问题将在2.1节介绍。')]
    edges, stats = build_edges(chunks, TOC)
    assert edges == []
    assert stats['节引用:非后向引用（排除）'] == 1


def test_reference_is_not_an_edge_when_not_strictly_earlier():
    """只有**严格在前**的引用才建边。

    判据是 `目标起始页 < 引用所在页`，不是 `<=`。相等意味着被引内容与引用方
    从同一页开始，那要么是自引用（已被另一分支拦掉），要么是页级归属把两边
    划到了同一页——两种情况都推不出「先学它」。
    """
    chunks = [_chunk('c1', 'kp-1-1-2', 3, '见1.1.1节')]
    assert chunks[0]['printed_page'] == 3
    edges, stats = build_edges(chunks, TOC)
    assert edges == []
    assert stats['节引用:非后向引用（排除）'] == 1


def test_self_reference_is_dropped():
    """引用自己所在的节，不构成边。"""
    chunks = [_chunk('c1', 'kp-1-1-1', 20, '本节用式(1.1.1)计算。')]
    edges, stats = build_edges(chunks, TOC)
    assert edges == []
    assert stats['式引用:自引用'] == 1


def test_unknown_number_creates_no_edge():
    """引用了目录里不存在的编号（这里 9.9 不存在）⇒ 不建边，计数留痕。"""
    chunks = [_chunk('c1', 'kp-2-1', 50, '详见9.9节的说明。')]
    edges, stats = build_edges(chunks, TOC)
    assert edges == []
    assert any('编号在目录中不存在' in k for k in stats)


def test_edge_carries_quotable_evidence():
    """每条边必须带原文片段，否则复核时只能信任抽取器。"""
    chunks = [_chunk('c1', 'kp-2-1', 50, '根据式(1.1.1)，可以推出下一步。')]
    edges, _ = build_edges(chunks, TOC)
    assert len(edges) == 1
    ev = edges[0]['evidence']
    assert len(ev) == 1
    assert ev[0]['ref'] == '式(1.1.1'
    assert '根据式(1.1.1)' in ev[0]['quote']
    assert ev[0]['printedPage'] == 50
    assert ev[0]['chunkId'] == 'c1'


def test_reference_to_section_expands_to_all_its_leaves():
    """引用一节时，边要从该节下**每个**叶节点出发（掌握度只挂叶节点）。"""
    chunks = [_chunk('c1', 'kp-2-1', 41, '如1.1节所述。')]
    edges, _ = build_edges(chunks, TOC)
    assert {e['fromId'] for e in edges} == {'kp-1-1-1', 'kp-1-1-2'}
    assert all(e['toId'] == 'kp-2-1' for e in edges)


def test_multiple_quotes_on_one_edge_are_all_kept():
    """同一个依赖被多处引用时保留全部证据，方便交叉复核。"""
    chunks = [
        _chunk('c1', 'kp-2-1', 45, '如1.1.1节所述。'),
        _chunk('c2', 'kp-2-1', 47, '参见1.1.1节。'),
    ]
    edges, _ = build_edges(chunks, TOC)
    assert len(edges) == 1
    assert len(edges[0]['evidence']) == 2


def test_chunk_without_owner_contributes_nothing():
    """没有归属的 chunk（封面、目录）不能成为边的来源。"""
    chunks = [_chunk('c1', None, 11, '如1.1.1节所述。')]
    edges, _ = build_edges(chunks, TOC)
    assert edges == []


def test_summarize_counts_cross_chapter_and_coverage():
    edges = [
        {'fromId': 'kp-1-1-1', 'toId': 'kp-1-2-1', 'kind': 'prereq', 'evidence': []},
        {'fromId': 'kp-1-1-1', 'toId': 'kp-2-1', 'kind': 'prereq', 'evidence': []},
    ]
    s = summarize(edges, TOC)
    assert s['edgeCount'] == 2
    assert s['crossChapter'] == 1
    assert s['withinChapter'] == 1
    assert s['leavesTouched'] == 3
    assert s['leafCount'] == 4
    assert s['coverage'] == 0.75
