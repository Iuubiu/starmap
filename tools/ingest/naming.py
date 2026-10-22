"""同名叶节点的消歧：把章节编号拼回 `name`，让学习者在界面上分得清。

## 为什么需要这一步

`toc.json` 的 `nodes[].name` 是**目录里印的标题**，不含编号 —— 编号在 `num` 里。
但前端拿到的图谱/推荐响应里**没有 `num` 字段**（见 `graph.controller.ts` 的
`GraphNode`：`microKpId / name / state / percent / depth / moduleId / moduleName /
moduleOrdinal / ordinal / reviewDueAt`）。于是同一本书里的 8 个「概述」在界面上
长得一模一样：

    analog-electronics-tongshibai-5e   7.1.1 概述   8.1.1 概述   8.2.1 概述
    digital-electronics-yanshi-6e      1.1 概述 ... 8.1 概述     （共 8 个）
    nuclear-radiation-measurement-tangbin  4.1 概述   6.1 概述

学习者在推荐里看到「概述」，点进去不知道是哪一章的概述。这不是数据脏，是
**展示信息不足**：编号一直在 `num` 里，只是没进 `name`。

## 判据：只改「同书内重名」的叶节点

不给全部 2400 个叶节点加编号 —— 那会把「基尔霍夫电流、电压定律」变成
「2.3 基尔霍夫电流、电压定律」，与书里的实际标题不符，也让检索命中变差
（学习者搜的是标题，不是编号）。

只对**同一本书里、名字与另一个叶节点完全相同**的那些节点加前缀。重名才需要
区分，不重名的保持原样。前缀用 `num`（目录里的真编号），不自己编号。

## 为什么在 `toc.py` 之外

`toc.py` 是目录解析的单一真源，同时被 `toc_books.py`（15 本有文字层的书）复用。
这一步是**产物规格**（重名节点该怎么显示）而不是**解析规则**（目录怎么读），
放在解析之后的归一化步骤里，`run.py` 与 `ocr_run.py` 两个入口各调一次即可 ——
与 `frontmatter.py` 同一个理由、同一个位置。
"""
from __future__ import annotations

import collections
import re

#: 被改名节点的 `(microKpId, 原名, 新名)`，供测试与审计对账。
#: 由 `disambiguate_duplicate_names()` 填充（调用方每次重算，不跨书累积）。
LAST_RENAMES: list[tuple[str, str, str]] = []


def _leaf_name_groups(nodes: list[dict]) -> dict[str, list[dict]]:
    """名字 → 同名的叶节点列表（只看叶节点：容器不进地图、不进推荐）。"""
    groups: dict[str, list[dict]] = collections.defaultdict(list)
    for node in nodes:
        if node.get('isLeaf') is True:
            groups[node.get('name') or ''].append(node)
    return {name: ns for name, ns in groups.items() if len(ns) > 1}


def disambiguate_duplicate_names(nodes: list[dict]) -> list[tuple[str, str, str]]:
    """把编号拼进重名叶节点的 `name`，返回 `(id, 旧名, 新名)` 列表。

    三遗，按可靠度从高到低：

    1. **自己的 `num`**（`"2.1 概述"`）—— 最可靠，编号本来就在目录里。
    2. **父节点的编号或名字**（`"3 概念与术语"`、`"6.8 B．光电倍增管"`）——
       适用于无编号的索引/术语页：它们靠“属于哪一章”区分，不靠自己的号。
    3. **所在节**（`"3.2 一、概述"`）—— 只对「节用第X节、子项用一、二、」的
       目录体例（methods-1997）生效：自己的 `num` 为空，但节次就在兄弟行的
       名字里，从后往前扫一遍就能拿到。

    三遗都拿不到的（同名同父、且都没有编号）不猜 —— 由
    `unresolved_duplicates()` 报出来，交给人工判定。

    幂等：新名已含前缀时不会再加一次（第二遗、第三遗都先检查）。
    """
    renames: list[tuple[str, str, str]] = []

    def _apply(nodes_in_group: list[dict], prefix_of) -> None:
        for node in nodes_in_group:
            prefix = prefix_of(node)
            if not prefix:
                continue
            old = node['name']
            if old.startswith(prefix):
                continue
            new_name = f'{prefix} {old}'
            renames.append((node['microKpId'], old, new_name))
            node['name'] = new_name

    # ---- 第一遗：用自己的 num ----
    for _name, group in _leaf_name_groups(nodes).items():
        if not _name.strip():
            continue
        _apply(group, lambda n: (n.get('num') or '').strip())

    # ---- 第二遗：用父节点的编号（没编号就用父名）----
    by_id = {n['microKpId']: n for n in nodes}

    def _parent_prefix(node: dict) -> str:
        parent = by_id.get(node.get('parentId') or '')
        if parent is None:
            return ''
        num = (parent.get('num') or '').strip()
        return num or (parent.get('name') or '').strip()

    for _name, group in _leaf_name_groups(nodes).items():
        if not _name.strip():
            continue
        # 父前缀必须能区分开：所有同名节点的父前缀互不相同才用，否则跳过。
        prefixes = [_parent_prefix(n) for n in group]
        if all(prefixes) and len(set(prefixes)) == len(prefixes):
            _apply(group, _parent_prefix)

    # ---- 第三遗：用所在节的编号（第X节 + 一、二、 体例）----
    _prefix_by_enclosing_section(nodes, renames, _apply)

    LAST_RENAMES[:] = renames
    return renames


_CN_DIGIT = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
    '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
    '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
}

_SECTION_IN_NAME = re.compile(r'^第\s*([一二三四五六七八九十百零\d]+)\s*节')
_SUBITEM_IN_NAME = re.compile(r'^([一二三四五六七八九十]+)\s*[、.．]')


def _cn_number(text: str) -> int | None:
    """`'十二'` → 12、`'3'` → 3。认不出返回 None。"""
    text = text.strip()
    if text.isdigit():
        return int(text)
    return _CN_DIGIT.get(text)


def _prefix_by_enclosing_section(
    nodes: list[dict],
    renames: list[tuple[str, str, str]],
    apply_fn,
) -> None:
    """给「第X节 / 一、二、」体例的书拼节次号。

    methods-1997 全书都是这个体例：`第一节气体中电子…` 下挂 `一、气体的电离`。
    OCR 拿到的 `num` 全是空，但**节次就在名字里**。从后往前扫一遍兄弟，
    就能给每个子项算出 `3.2.1` 这样的号 —— 不是猜，是读它上面最近的那个节标题。

    **只处理当前仍然重名的叶节点**（`_leaf_name_groups` 的成员）。这一遗是
    消歧的兜底，不是「给所有节点加编号」—— 把不重名的 `第一节概述` 也改成
    `4 第一节概述` 会把本来正确的标题弄脏。
    """
    still_dup = {
        n['microKpId'] for group in _leaf_name_groups(nodes).values() for n in group
    }
    by_parent: dict[str | None, list[dict]] = {}
    for n in nodes:
        by_parent.setdefault(n.get('parentId'), []).append(n)
    by_id = {n['microKpId']: n for n in nodes}

    for parent_id, sibs in by_parent.items():
        parent = by_id.get(parent_id or '')
        chapter = _cn_number((parent or {}).get('num') or '')
        if chapter is None:
            continue
        section: int | None = None
        for node in sibs:
            name = node.get('name') or ''
            m = _SECTION_IN_NAME.match(name)
            if m:
                section = _cn_number(m.group(1))
                continue
            m2 = _SUBITEM_IN_NAME.match(name)
            if not m2 or section is None:
                continue
            if node['microKpId'] not in still_dup:
                continue
            sub = _cn_number(m2.group(1))
            if sub is None:
                continue
            if node.get('isLeaf') is not True:
                continue
            prefix = f'{chapter}.{section}.{sub}'
            if name.startswith(prefix):
                continue
            old = name
            node['name'] = f'{prefix} {old}'
            renames.append((node['microKpId'], old, node['name']))



def unresolved_duplicates(nodes: list[dict]) -> list[dict]:
    """消歧之后仍然重名的叶节点组 —— 这些是「编号真的丢了」，只能报给人看。

    返回 `[{'name': 名字, 'ids': [...], 'pages': [...]}]`。空列表表示全部
    可区分。**不猜**：调用方把它打进日志与测试失败信息，由人判断是 OCR 丢字
    还是目录体例本来如此。
    """
    out: list[dict] = []
    for name, group in sorted(_leaf_name_groups(nodes).items()):
        out.append(
            {
                'name': name,
                'ids': [n['microKpId'] for n in group],
                'pages': [n.get('printedPage') for n in group],
            }
        )
    return out


def report_renames(renames: list[tuple[str, str, str]]) -> str:
    """一行可打日志的摘要 —— 改名必须可见，不能静默改产物。"""
    if not renames:
        return '重名叶节点：无（没有需要拼编号的节点）'
    return f'重名叶节点：{len(renames)} 个拼回编号（例：{renames[0][1]!r} → {renames[0][2]!r}）'
