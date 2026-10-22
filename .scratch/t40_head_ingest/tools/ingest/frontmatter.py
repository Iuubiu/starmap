"""书首前置页的归一化：`depth=0 && num==''` 的叶节点不是可掌握知识点。

## 为什么需要这一步

目录解析（`toc.py::build_tree`）把「无编号标题」挂到 `stack[0]`。当书的扉页/目录/
前言排在第一个真正的章（`num='1'`，depth=0 但 `is_leaf=False`）之前时，那一页会被
建成一个 **depth=0 的叶知识点**。后果是用户可见的：

- 地图上出现一个叫「上册」的格子，点进去是第一章第 2 页的正文；
- `POST /recommendations` 把它当作「下一课」推荐出来 —— `compareScored` 的排序键是
  `moduleOrdinal → depth → ordinal → microKpId`，depth=0 永远赢过正常的 depth=2/3；
- 掌握度把它算进分母，学习者永远「掌握」不了「上册」。

实测 5 条（12 本目录全量普查，`depth=0 && isLeaf && num==''`）：
`上册`（李瀚荪）、`绪论`（阎石）、`目電录`+`绪论`（王芝英）、`概念与术语`（汲长松）。

## 为什么是降级不是删

这 5 条各挂着 10–62 个 chunk（书首的序、目录、术语表正文）。降级成容器后 chunk 仍
挂在它下面，`content.controller.ts` 的 `WITH RECURSIVE subtree` 仍能查到 —— 内容不丢；
而地图/掌握度/出题/推荐四处消费方都只看 `is_leaf`，自动不再把它当学习目标。

汲长松的「序言」（同一页、同一类东西）本来就是 `is_leaf=false` —— 这是同类东西的
正确形态，本模块把它推广到剩下 5 条。

## 为什么不在 toc.py 里改

`toc.py` 是目录解析的单一真源，同时被 `toc_books.py`（15 本有文字层的书）复用，改动
面大。这一步是**产物规格**（什么算可掌握知识点）而不是**解析规则**（目录怎么读），
放在解析之后的归一化步骤里，`run.py` 与 `ocr_run.py` 两个入口各调一次即可。
"""
from __future__ import annotations

#: 明文列出被降级的节点，供测试与审计对账。
#: 不写成「所有 depth=0 的节点」—— seed 的 `kp-logic`（depth 0、`is_leaf=False`）
#: 是正常容器，按 `depth == 0` 一刀切会把它也卷进来。
DEMOTED_FRONT_MATTER: tuple[tuple[str, str], ...] = (
    ('kp-lihansun-5e-vol1-p2-上册', '卷名'),
    ('kp-yanshi-6e-p1-绪论', '书前绪论'),
    ('kp-wangzhiying-1989-p1-目電录', '目录（「目录」的 OCR 错字）'),
    ('kp-wangzhiying-1989-p1-绪论', '书前绪论'),
    ('kp-jichangsong-1990-p1-概念与术语', '书前术语表'),
)


def is_front_matter_leaf(node: dict) -> bool:
    """`depth==0` 且无编号，却被打成叶节点 —— 一定是书首前置页。

    只认结构，不认名字：名字是 OCR 出来的，`目電录`/`目区`/`举目` 都是「目录」
    的误识，按名字正则枚举错字只会越补越漏。
    """
    return (
        node.get('depth') == 0
        and node.get('isLeaf') is True
        and not (node.get('num') or '').strip()
    )


def demote_front_matter_leaves(nodes: list[dict]) -> list[str]:
    """把这些节点原地改成容器，返回被降级的 id 列表。

    幂等：已经是 `is_leaf=False` 的不再计入。放在 `nodes_from_flat()` 之后、
    写 `toc.json` 之前调用。
    """
    demoted: list[str] = []
    for node in nodes:
        if is_front_matter_leaf(node):
            node['isLeaf'] = False
            demoted.append(node['microKpId'])
    return demoted


def report_demotions(demoted: list[str]) -> str:
    """一行可打日志的摘要 —— 降级必须可见，不能静默改产物。"""
    if not demoted:
        return '书首前置页：无（目录里没有 depth=0 的无编号叶节点）'
    return f'书首前置页：{len(demoted)} 个节点降级为容器（不是可掌握知识点）：{", ".join(demoted)}'
