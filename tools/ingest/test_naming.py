"""`naming.py` 的单元测试 + 管线接线守门（t24 第二件）。

## 为什么要单独一个文件

`test_content_artifacts.py` 守的是**产物**（`content/*/toc.json` 干不干净）。
产物测试有个盲区：**把 `disambiguate_duplicate_names()` 从入口摘掉，产物仍然
是干净的**（因为产物已经改过了），测试不会红 —— 要等到下一次重跑产物才暴露。

所以这里补两层：
1. 纯函数测试：三遗 fallback 各自的行为、幂等、不误伤不重名的节点；
2. **接线测试**：四个写 `toc.json` 的入口都必须调用它。摘掉任何一处就红。
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from naming import (  # noqa: E402
    _leaf_name_groups,
    disambiguate_duplicate_names,
    report_renames,
    unresolved_duplicates,
)

INGEST = Path(__file__).resolve().parent


def node(nid: str, name: str, *, num: str = '', parent: str | None = None,
         depth: int = 2, leaf: bool = True, page: int = 1) -> dict:
    """造一个最小节点。字段名与 `toc.nodes_from_flat()` 的产物一致。"""
    return {
        'microKpId': nid,
        'name': name,
        'num': num,
        'printedPage': page,
        'depth': depth,
        'parentId': parent,
        'isLeaf': leaf,
        'appendix': False,
        'answerKey': False,
    }


# ---- 判据：只动重名的叶节点 ------------------------------------------------


def test_only_duplicate_leaf_names_are_touched() -> None:
    """不重名的节点一个都不该改 —— 加编号会让检索命中变差、与书中标题不符。"""
    nodes = [
        node('a', '基尔霍夫电流、电压定律', num='2.3'),
        node('b', '叠加定理', num='2.4'),
        node('c', '概述', num='3.1'),
        node('d', '概述', num='4.1'),
    ]
    renames = disambiguate_duplicate_names(nodes)
    assert {r[0] for r in renames} == {'c', 'd'}
    assert nodes[0]['name'] == '基尔霍夫电流、电压定律'
    assert nodes[1]['name'] == '叠加定理'


def test_container_nodes_are_not_counted_as_duplicates() -> None:
    """容器（`isLeaf=False`）不进地图、不进推荐，重名无所谓，不该被改名。

    实测来源：康华光章 5 的「小结」「习题」在每章都出现、都是容器。
    """
    nodes = [
        node('c1', '小结', parent='ch1', leaf=False, depth=1),
        node('c2', '小结', parent='ch2', leaf=False, depth=1),
    ]
    assert _leaf_name_groups(nodes) == {}
    assert disambiguate_duplicate_names(nodes) == []


# ---- 第一遗：用自己的 num --------------------------------------------------


def test_first_fallback_uses_own_num() -> None:
    nodes = [
        node('y1', '概述', num='1.1', parent='ch1'),
        node('y2', '概述', num='2.1', parent='ch2'),
        node('y3', '概述', num='3.1', parent='ch3'),
    ]
    disambiguate_duplicate_names(nodes)
    assert [n['name'] for n in nodes] == ['1.1 概述', '2.1 概述', '3.1 概述']


def test_first_fallback_skips_already_prefixed_names() -> None:
    """名字已经以 `num` 开头时不再重复加（否则会变成 `1.1 1.1 概述`）。

    这种情形真实存在：同一页被 OCR 拆出两个同名条目（重复行），两个节点的
    `num` 相同、名字也相同 —— 它们不能靠加前缀区分，`_apply` 必须先看到
    「已经带过了」而直接跳过，留给 `unresolved_duplicates()` 报出来。
    """
    nodes = [
        node('y1', '1.1 概述', num='1.1', parent='ch1'),
        node('y2', '1.1 概述', num='1.1', parent='ch1'),
    ]
    assert disambiguate_duplicate_names(nodes) == []
    assert [n['name'] for n in nodes] == ['1.1 概述', '1.1 概述']
    assert len(unresolved_duplicates(nodes)) == 1


# ---- 第二遗：用父节点的编号或名字 ------------------------------------------


def test_second_fallback_uses_parent_number() -> None:
    """无自己的编号时用父编号：jichangsong 的「概念与术语」每章一个。"""
    nodes = [
        node('p1', '第 3 章', num='3', parent=None, depth=1, leaf=False),
        node('p2', '第 6 章', num='6', parent=None, depth=1, leaf=False),
        node('g1', '概念与术语', num='', parent='p1'),
        node('g2', '概念与术语', num='', parent='p2'),
    ]
    disambiguate_duplicate_names(nodes)
    assert [n['name'] for n in nodes[2:]] == ['3 概念与术语', '6 概念与术语']


def test_second_fallback_falls_back_to_parent_name_when_unnumbered() -> None:
    """父节点也没编号时用父名 —— 总比两个一模一样的「概念与术语」强。"""
    nodes = [
        node('p1', '闪烁探测器', num='', parent=None, depth=1, leaf=False),
        node('p2', '实验技术', num='', parent=None, depth=1, leaf=False),
        node('g1', 'A．闪烁体', num='', parent='p1'),
        node('g2', 'A．闪烁体', num='', parent='p2'),
    ]
    disambiguate_duplicate_names(nodes)
    assert [n['name'] for n in nodes[2:]] == ['闪烁探测器 A．闪烁体', '实验技术 A．闪烁体']


def test_second_fallback_refuses_when_parents_collide() -> None:
    """同名节点的父前缀**相同**时不能用第二遗 —— 加了也一样分不清，只是变长。

    实测来源：康华光章 5 下两个 `MOSFET`（同父、都无编号）。这条守着
    「不猜」：它们进 `unresolved_duplicates()`，由人判断。
    """
    nodes = [
        node('p', '场效应管', num='5', parent=None, depth=1, leaf=False),
        node('m1', 'MOSFET', num='', parent='p', page=205),
        node('m2', 'MOSFET', num='', parent='p', page=211),
    ]
    renames = disambiguate_duplicate_names(nodes)
    assert renames == []
    assert [n['name'] for n in nodes[1:]] == ['MOSFET', 'MOSFET']
    assert unresolved_duplicates(nodes) == [
        {'name': 'MOSFET', 'ids': ['m1', 'm2'], 'pages': [205, 211]}
    ]


# ---- 第三遗：用所在节的编号（「第X节 / 一、二、」体例）---------------------


def test_third_fallback_uses_enclosing_section_number() -> None:
    """methods-1997 全书按「第X节 / 一、二、三」组织，`num` 全空但节次在名字里。

    父是章 3，兄弟里先出现「第一节…」再出现「第二节…」，于是两个「一、概述」
    分别落在 3.2.1 与 3.3.1（不是猜页码，是读它上面最近的那个节标题）。
    """
    nodes = [
        node('ch', '第三章', num='3', parent=None, depth=1, leaf=False),
        node('s1', '第一节气体中电子和离子的运动规律', num='', parent='ch'),
        node('a1', '一、气体的电离', num='', parent='ch'),
        node('s2', '第二节电离室', num='', parent='ch'),
        node('a2', '一、概述', num='', parent='ch', page=74),
        node('s3', '第三节正比计数器', num='', parent='ch'),
        node('a3', '一、概述', num='', parent='ch', page=82),
    ]
    disambiguate_duplicate_names(nodes)
    names = {n['microKpId']: n['name'] for n in nodes}
    assert names['a2'] == '3.2.1 一、概述'
    assert names['a3'] == '3.3.1 一、概述'
    # 不重名的子项**不该**被加编号（这一遗是消歧兜底，不是给全书编号）。
    assert names['a1'] == '一、气体的电离'
    assert names['s2'] == '第二节电离室'


def test_third_fallback_leaves_other_books_alone() -> None:
    """没有「第X节」体例的书，第三遗不该碰（父 num 解析不出来就跳过）。"""
    nodes = [
        node('ch', '第一章', num='一', parent=None, depth=1, leaf=False),
        node('x1', '概述', num='', parent='ch'),
        node('x2', '概述', num='', parent='ch'),
    ]
    assert disambiguate_duplicate_names(nodes) == []


# ---- 幂等 ------------------------------------------------------------------


def test_disambiguation_is_idempotent() -> None:
    """跑第二遍必须一个都不改 —— 否则每重跑一次多一层前缀。"""
    nodes = [
        node('y1', '概述', num='1.1', parent='ch1'),
        node('y2', '概述', num='2.1', parent='ch2'),
    ]
    first = disambiguate_duplicate_names(nodes)
    assert len(first) == 2
    second = disambiguate_duplicate_names(nodes)
    assert second == []
    assert [n['name'] for n in nodes] == ['1.1 概述', '2.1 概述']


def test_last_renames_records_the_latest_call() -> None:
    """`LAST_RENAMES` 每次重算，不跨书累积（否则审计日志会越滚越长）。"""
    from naming import LAST_RENAMES

    disambiguate_duplicate_names([node('a', '概述', num='1.1'), node('b', '概述', num='2.1')])
    assert len(LAST_RENAMES) == 2
    disambiguate_duplicate_names([node('c', '引言', num='1.1'), node('d', '引言', num='2.1')])
    assert len(LAST_RENAMES) == 2
    assert {r[0] for r in LAST_RENAMES} == {'c', 'd'}


# ---- 报告 ------------------------------------------------------------------


def test_report_renames_is_readable_and_mentions_nothing_when_empty() -> None:
    assert '无' in report_renames([])
    text = report_renames([('id', '概述', '1.1 概述')])
    assert '1' in text and '概述' in text


# ---- 接线：四个入口都必须调用 ----------------------------------------------
#
# 产物测试看不见「代码里摘掉调用」这种回归（产物已经改过了，照样干净）。
# 这里直接读入口源码 —— 粗暴但有效：这四条调用是管线的一部分，不是可选优化。

ENTRYPOINTS = ('run.py', 'ocr_run.py', 'toc_batch.py', 'books_batch.py')


def test_every_toc_writer_wires_the_disambiguation() -> None:
    missing: list[str] = []
    for name in ENTRYPOINTS:
        source = io.open(INGEST / name, encoding='utf-8').read()
        if 'disambiguate_duplicate_names(' not in source:
            missing.append(name)
    assert not missing, (
        '这些入口写 toc.json 但没有调用 disambiguate_duplicate_names()，'
        f'重跑会把这些书的同名叶节点名打回原形：{missing}'
    )


def test_entrypoints_also_log_the_renames() -> None:
    """改名必须可见：静默改产物等于没法审计「为什么这个名字变了」。"""
    silent = [
        name
        for name in ENTRYPOINTS
        if 'report_renames(' not in io.open(INGEST / name, encoding='utf-8').read()
    ]
    assert not silent, f'这些入口改了名却没打日志：{silent}'
