"""跨书先修边的测试（票 18 AC3）。

四条要求（captain 原文）：
1. 每条跨书边的 `from` 层 ordinal 严格小于 `to` 层；
2. `evidence` 非空且含「跨书」；
3. 白名单每条都能在产出里找到；
4. 造一条反向候选，断言被拒绝。

再加四条守住容易悄悄退化的地方：
- 端点必须是真实存在的叶节点（拼错一个 id 就静默少一条边，而总数 31 仍在
  15–60 区间里，没有测试根本发现不了）；
- 层序表要与 `course_map.LAYERS` 一致（两处各写一份 ordinal 会漂移）；
- `basis` 与 `matchedTerms` 自洽（有共同术语 → `term_match`，没有 → `whitelist`）；
- 同层不许连边（票面明写）。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import course_map as cm  # noqa: E402
import cross_edges as ce  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def leaves() -> dict[str, ce.Leaf]:
    return ce.load_leaves()


@pytest.fixture(scope='module')
def built(leaves):
    return ce.build_edges(leaves)


def test_target_count_is_between_15_and_60(built):
    """票面目标 15–60 条。宁可少而准，但不能少到没有意义。"""
    edges, _ = built
    assert 15 <= len(edges) <= 60, f'{len(edges)} 条，不在 15–60'


def test_every_edge_goes_from_earlier_layer_to_later(built):
    """每条边的层序严格递增（票面第一条要求）。"""
    edges, _ = built
    for e in edges:
        detail = e['evidenceDetail']
        a, b = ce.LAYER_ORD[detail['fromLayer']], ce.LAYER_ORD[detail['toLayer']]
        assert a < b, f"{e['fromId']} → {e['toId']} 违反层序：{detail['fromLayer']}({a}) → {detail['toLayer']}({b})"


def test_no_edge_within_the_same_layer(built):
    """同层不许连边（票面明写）。"""
    edges, _ = built
    for e in edges:
        detail = e['evidenceDetail']
        assert detail['fromLayer'] != detail['toLayer'], f"{e['fromId']} → {e['toId']} 同层连边"


def test_every_edge_has_cross_book_evidence(built):
    """`evidence` 非空且含「跨书」二字。"""
    edges, _ = built
    for e in edges:
        text = e['evidence']
        assert text and text.strip(), f"{e['fromId']} → {e['toId']} 的 evidence 为空"
        assert '跨书' in text, f"{e['fromId']} → {e['toId']} 的 evidence 不含「跨书」：{text[:60]}"


def test_every_edge_carries_structured_detail(built):
    """`evidence_detail` 的必填字段齐全，且 `type` 是 `cross_book`。"""
    edges, _ = built
    for e in edges:
        detail = e['evidenceDetail']
        assert detail['type'] == 'cross_book'
        for key in ('from_book', 'to_book', 'fromLayer', 'toLayer', 'basis', 'curriculumSource'):
            assert detail.get(key), f"{e['fromId']} → {e['toId']} 缺 {key}"
        assert detail['curriculumSource'].strip(), 'curriculumSource 不能是空白'


def test_every_whitelist_entry_appears_in_the_output(built, leaves):
    """白名单每条都能在产出里找到（票面第三条要求）。

    除了「产出条数 == 白名单条数」，还要逐条核对：只比总数会让「一条重复、一条
    丢失」这种交换恰好抵消的情况漏过去。
    """
    edges, rejected = built
    produced = {(e['fromId'], e['toId']) for e in edges}
    expected = {(w.from_id, w.to_id) for w in ce.WHITELIST}
    assert produced == expected, (
        f'产出与白名单不一致；缺 {sorted(expected - produced)}；多 {sorted(produced - expected)}'
    )
    assert rejected == [], f'有白名单项被拒：{rejected}'


def test_reverse_candidate_is_rejected(leaves):
    """造一条反向候选，断言被拒绝（票面第四条要求）。

    反向 = 把一条真实边的两端对调。层序判据必须把它挡下来 —— 否则跨书边会
    出现环，推荐引擎的 `prereqSatisfied` 会互相挡住，学习者两个节点都进不去。
    """
    real = ce.WHITELIST[0]
    reversed_entry = ce.CrossEdge(
        from_id=real.to_id,
        to_id=real.from_id,
        matched=real.matched,
        reason='（测试用的反向候选）',
        curriculum=real.curriculum,
    )
    edges, rejected = ce.build_edges(leaves, whitelist=(reversed_entry,))
    assert edges == [], f'反向候选竟然产出了边：{edges}'
    assert len(rejected) == 1
    assert rejected[0]['reason'] == 'layer_order', rejected[0]


def test_same_layer_candidate_is_rejected(leaves):
    """同层候选必须被拒（层序判据是严格小于，不是小于等于）。"""
    same = next(
        (leaf for leaf in leaves.values() if leaf.book == 'knoll-4e-2010'),
        None,
    )
    other = next(
        (leaf for leaf in leaves.values() if leaf.book == 'knoll-3e-2000'),
        None,
    )
    assert same and other, '测试前提不成立：找不到 knoll 的叶节点'
    entry = ce.CrossEdge(
        from_id=same.id, to_id=other.id, matched=(), reason='测试', curriculum='测试',
    )
    edges, rejected = ce.build_edges(leaves, whitelist=(entry,))
    assert edges == []
    assert rejected and rejected[0]['reason'] == 'layer_order', rejected


def test_unknown_leaf_is_rejected(leaves):
    """拼错 id 必须被拒绝并说明原因，不能静默少一条边。"""
    entry = ce.CrossEdge(
        from_id='kp-does-not-exist', to_id='kp-also-missing',
        matched=(), reason='测试', curriculum='测试',
    )
    edges, rejected = ce.build_edges(leaves, whitelist=(entry,))
    assert edges == []
    assert rejected[0]['reason'] == 'unknown_leaf', rejected[0]
    assert 'kp-does-not-exist' in rejected[0]['detail']


def test_endpoints_are_real_leaf_nodes(built, leaves):
    """每条边的两端都是真实叶节点，且属于 `evidenceDetail` 声明的书。"""
    edges, _ = built
    for e in edges:
        for side in ('from', 'to'):
            leaf_id = e[f'{side}Id']
            leaf = leaves.get(leaf_id)
            assert leaf is not None, f'{side} 端 {leaf_id} 不是任何一本书的叶节点'
            assert leaf.book == e['evidenceDetail'][f'{side}_book'], (
                f'{side} 端 {leaf_id} 属于 {leaf.book}，与 detail 声明的 '
                f"{e['evidenceDetail'][f'{side}_book']} 不一致"
            )
            assert leaf.name.strip(), f'{side} 端 {leaf_id} 的名字为空'


def test_basis_is_consistent_with_matched_terms(built):
    """`basis` 必须与 `matchedTerms` 自洽。

    有共同术语 → `layer_order+term_match`；没有 → `whitelist`。
    反过来写会让「靠人工判断」和「靠术语命中」两件事混在一起，审计时分不清
    哪条边有机器可验证的依据。
    """
    edges, _ = built
    for e in edges:
        detail = e['evidenceDetail']
        has_terms = bool(detail['matchedTerms'])
        expected = 'layer_order+term_match' if has_terms else 'whitelist'
        assert detail['basis'] == expected, (
            f"{e['fromId']} → {e['toId']} 的 basis={detail['basis']}，"
            f"但 matchedTerms={detail['matchedTerms']}"
        )


def test_common_terms_actually_appear_in_both_names(built, leaves):
    """`matchedTerms` 里的每个词都必须**两端名字都含**。

    这条是自查出来的真缺陷的回归：早期版本把「逐次逼近」和「逐次比较」当成
    共同术语写进 `matchedTerms`，但前者只在数字电路那端、后者只在核电子学那端 ——
    它们不是共同术语，是同义不同词。混在一起会让 `term_match` 这个判据失去意义
    （任何两条边都能靠编一个词声称命中）。
    """
    edges, _ = built
    for e in edges:
        a, b = leaves[e['fromId']].name, leaves[e['toId']].name
        for term in e['evidenceDetail']['matchedTerms']:
            assert term in a, f'{term!r} 不在 from 端名字里：{a!r}'
            assert term in b, f'{term!r} 不在 to 端名字里：{b!r}'


def test_synonym_pairs_are_cross_side(built, leaves):
    """`synonymPairs` 的每一对必须一侧出现在 from、另一侧出现在 to。"""
    edges, _ = built
    for e in edges:
        a, b = leaves[e['fromId']].name, leaves[e['toId']].name
        for x, y in e['evidenceDetail']['synonymPairs']:
            ok = (x in a and y in b) or (y in a and x in b)
            assert ok, f'同义对 {x!r}/{y!r} 与两端名字对不上：{a!r} → {b!r}'


def test_layer_ordinals_match_course_map():
    """`cross_edges.LAYER_ORD` 必须与 `course_map.LAYERS` 一致。

    两处各写一份 ordinal 是最典型的漂移源：课程层顺序一改，跨书边方向判据
    就会悄悄反过来（原来的先修边变成后继边），而所有测试仍然绿。
    """
    assert ce.LAYER_ORD == {layer.id: layer.ordinal for layer in cm.LAYERS}


def test_every_book_in_edges_is_mapped(leaves):
    """边里出现的每本书都必须在 `course_map` 里有映射。

    没有映射的书会让 `LAYER_ORD[...]` 抛 KeyError；更糟的是如果代码用 `.get()`
    兜底，它会静默跳过层序检查。
    """
    edges, _ = ce.build_edges(leaves)
    for e in edges:
        for side in ('from_book', 'to_book'):
            book = e['evidenceDetail'][side]
            assert book in cm.BOOK_TO_LAYER, f'{book} 没有课程层映射'


def test_validate_catches_a_reversed_edge(built, leaves):
    """`validate()` 本身也要能发现反向边 —— 它是写库前的最后一道闸。"""
    edges, _ = built
    bad = json.loads(json.dumps(edges[0]))
    bad['fromId'], bad['toId'] = bad['toId'], bad['fromId']
    detail = bad['evidenceDetail']
    detail['from_book'], detail['to_book'] = detail['to_book'], detail['from_book']
    detail['fromLayer'], detail['toLayer'] = detail['toLayer'], detail['fromLayer']
    problems = ce.validate([bad], leaves)
    assert any('违反层序' in p for p in problems), problems


def test_validate_catches_missing_cross_book_word(built, leaves):
    """`evidence` 里去掉「跨书」两个字，`validate()` 必须报错。"""
    edges, _ = built
    bad = json.loads(json.dumps(edges[0]))
    bad['evidence'] = bad['evidence'].replace('跨书', '书内')
    problems = ce.validate([bad], leaves)
    assert any('不含「跨书」' in p for p in problems), problems


def test_generated_file_matches_the_module(leaves):
    """`content/cross-edges.json` 与 `build_edges()` 的产出一致。

    产物是提交进仓库的（写库脚本读它），与代码不同步会让「测的是一套、写进库的
    是另一套」。
    """
    path = REPO / 'content' / 'cross-edges.json'
    if not path.exists():
        pytest.skip('content/cross-edges.json 还没生成')
    on_disk = json.loads(path.read_text(encoding='utf-8'))
    fresh, _ = ce.build_edges(leaves)
    assert on_disk['edgeCount'] == len(fresh)
    assert [(e['fromId'], e['toId']) for e in on_disk['edges']] == [
        (e['fromId'], e['toId']) for e in fresh
    ]
    assert on_disk['edges'] == fresh


def test_candidate_audit_is_honest(leaves):
    """候选审计的四个数字必须互相自洽，且能回答「有多少对有证据」。

    票 18 AC3 要求「可列出全部有证据／无证据的边数」。这个审计是那份账：
    自动找到多少对、多少对因层序被拒、多少对层序合法但不是应用关系。
    """
    audit = ce.sweep_candidates(leaves)
    assert audit['layerOrderOk'] >= audit['keptByWhitelist']
    assert audit['rejectedNotApplication'] >= 0
    assert audit['rejectedSameLayer'] > 0, '同层同名对应该大量存在（同一物理概念各书都讲）'
    assert audit['rejectedReverseLayer'] > 0, '反向同名对应该存在（层序高的书更细）'
    assert audit['layerOrderOk'] == audit['keptByWhitelist'] + audit['rejectedNotApplication']
