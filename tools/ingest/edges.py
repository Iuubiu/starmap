"""先修边构建：只从书里能找到的证据建边。

为什么不用「目录顺序」当先修关系：那会把整本书压成一条 165 节点的链，
等价于回到用户明确否决过的「按章节组织」。宁可边少而可核验，也不造一条
看起来完整、实际没有任何依据的链。

证据只有一种：**正文里的后向交叉引用**。
- 「如 2.2 节所述」「(2.2 节介绍)」→ 2.2 讲的在本文之前，本文用到它 ⇒ 2.2 是先修
- 「将在 1.3 节介绍」→ 1.3 在本文之后，是后继不是先修 ⇒ 必须排除
- 「见第 4 章」同理，前向引用排除

实测这本书的情况（559 页、3032 chunk）：
- 「X.Y 节」54 处、`式(X.Y.Z)` 100 处、`第 X 章` 26 处、`将在第 X 章` 6 处
- 全部**前向**引用 49 处（「将在…介绍」「见第 4 章」这类）
- 剩下 56 处里能落到具体节点的是 52 条**章内**边，**跨章边 0 条**

跨章边 0 条不是抽取失败，是这本书的真实情况：康华光从不写「学第 2 章前要先
学第 1 章」——章间先修是教师的默认假设，不是教材的显式陈述。所以跨章先修必须
来自课程大纲或专家标注（票 18），不能在这里编。
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from typing import Any

# 后向引用的三种写法。刻意不收「第 X 章」：它是章级模糊引用，
# 落到哪个叶节点上没有依据 —— 一个章有十几个叶节点，随便挑一个是编的。
SECTION_REF = re.compile(r'(\d{1,2}(?:\.\d{1,2}){1,2})\s*节')
FORMULA_REF = re.compile(r'式\s*[\(（]\s*(\d{1,2}(?:\.\d{1,2}){1,2})')

QUOTE_PAD = 18


def _leaves_of(toc: list[dict[str, Any]]) -> dict[str, set[str]]:
    """编号 → 该编号子树下所有叶节点。

    `2.2 节` 指向的是 2.2 整节，而掌握度只在叶节点（ADR-0004），
    所以引用一节时边要从「这一节的所有叶节点」指向引用者。
    """
    out: dict[str, set[str]] = defaultdict(set)
    for n in toc:
        if not n['isLeaf']:
            continue
        parts = (n.get('num') or '').split('.')
        for k in range(1, len(parts) + 1):
            out['.'.join(parts[:k])].add(n['microKpId'])
    return out


def build_edges(
    chunks: list[dict[str, Any]], toc: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """返回 (edges, stats)。edges 里每条都带可复核的原文片段。"""
    page_of = {n['microKpId']: n['printedPage'] for n in toc}
    id_of_num = {n['num']: n['microKpId'] for n in toc if n.get('num')}
    leaves_of = _leaves_of(toc)

    # (from, to) -> 证据列表。同一条边被多处引用时全部保留，便于复核。
    acc: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    stats: dict[str, int] = defaultdict(int)

    for c in chunks:
        owner = c.get('micro_kp_id')
        if not owner:
            continue
        own_page = c['printed_page']
        for label, rx in (('节引用', SECTION_REF), ('式引用', FORMULA_REF)):
            for m in rx.finditer(c['text']):
                num = m.group(1)
                if num not in id_of_num:
                    stats[f'{label}:编号在目录中不存在'] += 1
                    continue
                target = id_of_num[num]
                if page_of.get(target, 10**6) >= own_page:
                    # 被引内容不在引用之前：可能是前向（「将在 2.1 节介绍」），
                    # 也可能同页（页级归属把两边划到同一页）。两种都推不出「先学它」。
                    stats[f'{label}:非后向引用（排除）'] += 1
                    continue
                leaves = leaves_of.get(num, set())
                if not leaves:
                    stats[f'{label}:指向的节下没有叶节点'] += 1
                    continue
                start = max(0, m.start() - QUOTE_PAD)
                quote = c['text'][start : m.end() + QUOTE_PAD].strip()
                for leaf in leaves:
                    if leaf == owner:
                        stats[f'{label}:自引用'] += 1
                        continue
                    acc[(leaf, owner)].append(
                        {
                            'kind': label,
                            'quote': quote,
                            'printedPage': own_page,
                            'chunkId': c['id'],
                            'ref': m.group(0),
                        }
                    )

    edges = [
        {
            'fromId': frm,
            'toId': to,
            'kind': 'prereq',
            'evidence': ev,
        }
        for (frm, to), ev in sorted(acc.items())
    ]
    return edges, dict(stats)


def summarize(edges: list[dict[str, Any]], toc: list[dict[str, Any]]) -> dict[str, Any]:
    """覆盖率与跨章统计 —— 这两个数字决定这张图能不能当导航用。"""
    chap_of = {n['microKpId']: (n.get('num') or '').split('.')[0] for n in toc}
    cross = sum(1 for e in edges if chap_of.get(e['fromId']) != chap_of.get(e['toId']))
    touched = {e['fromId'] for e in edges} | {e['toId'] for e in edges}
    leaves = {n['microKpId'] for n in toc if n['isLeaf']}
    return {
        'edgeCount': len(edges),
        'crossChapter': cross,
        'withinChapter': len(edges) - cross,
        'leavesTouched': len(touched & leaves),
        'leafCount': len(leaves),
        'coverage': round(len(touched & leaves) / len(leaves), 4) if leaves else 0.0,
    }


def write_edges(path: str, edges: list[dict[str, Any]], summary: dict[str, Any]) -> None:
    payload = {'summary': summary, 'edges': edges}
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write('\n')
