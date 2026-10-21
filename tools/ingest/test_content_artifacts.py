"""产物不变量：`content/*/toc.json` 必须由**当前代码**生成（票 17 / is_answer_key）。

守的是产物，不是代码。今天这条测试会红一次 —— 已生成的 toc.json 里有 6 本是
`answerKey` 字段落地之前跑的，字段根本不存在，`import-content.ts` 读
`n.answerKey === true` 得到 undefined ⇒ false ⇒ 数据库里 `is_answer_key` 整列
0 行、`kp_answer_key_idx` 索引 0 行，检索侧只能靠 `name ~ '答案|解答'` 的
第二真源兜底。重出产物后这条变绿；以后改了判定规则而忘记重出，它会立刻再红。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from toc import is_answer_key_title  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CONTENT = ROOT / 'content'


def _tocs() -> list[Path]:
    return sorted(CONTENT.glob('*/toc.json'))


@pytest.mark.skipif(not _tocs(), reason='没有已生成的内容目录')
def test_answer_key_flag_matches_the_rule_for_every_book() -> None:
    """每本书里 `answerKey===true` 的节点集合，必须等于按标题算出来的集合。

    判据在 `toc.is_answer_key_title()`：附件 **且** 标题以 答案/解答/题解 结尾。
    实测应命中的 4 条：`部分习题答案`（康华光模拟、阎石）、
    `部分自测题和习题答案`（童诗白）、`部分习题答案（上册）`（李瀚荪）。
    """
    bad: list[str] = []
    missing_field: list[str] = []
    for path in _tocs():
        toc = json.loads(path.read_text(encoding='utf-8'))
        nodes = toc.get('nodes', [])
        if nodes and not any('answerKey' in n for n in nodes):
            missing_field.append(path.parent.name)
            continue
        flagged = {n['microKpId'] for n in nodes if n.get('answerKey') is True}
        expected = {n['microKpId'] for n in nodes if is_answer_key_title(n.get('name', ''))}
        if flagged != expected:
            bad.append(
                f'{path.parent.name}: 产物 {sorted(flagged)} != 规则 {sorted(expected)}'
            )
    assert not missing_field, (
        '这些书的 toc.json 没有 answerKey 字段，是旧代码生成的，必须重出：'
        + ', '.join(missing_field)
    )
    assert not bad, 'answerKey 与判定规则不一致：\n' + '\n'.join(bad)


def test_the_answer_appendixes_are_flagged() -> None:
    """答案附录必须在产物里被标出来 —— 它们名下 500+ 个 chunk 的检索门控靠这个。

    实测来源：这些节点 `is_leaf=false`，学习者永远不会以它们为当前知识点，
    `answerChunkIdsFor(leafKp)` 永远查不到；300 次 retrieval/debug 里 29 次
    放行了答案 chunk。

    这里从 4 条涨到 5 条，是**内容变对了**而不是规则放宽了：
    `kp-kanghua-5e-p530-部分习题答案` 一直印在康华光数字部分 p.530，但
    `parse_toc_text` 当时只认数字编号行与 4 个固定无编号标题，这条被静默丢掉，
    于是 p530–536 的整本答案被上一个叶子 `kp-kanghua-5e-p501-习题` 按页区间
    吞成「习题正文」，门控认不出它们（实测这 7 页 22 条里只有 9 条被标）。
    修 `toc.py` 后它才作为独立节点出现。

    断言是**子集**而不是相等：本测试守「这 5 个已知的不能丢」，而不是
    「不能有第 6 个」。多出来的答案附录由上面那条 `answerKey` 与判定规则
    对账的测试负责，不需要在这里再钉一份清单。
    """
    wanted = {
        'kp-kanghuaguang-5e-p573-部分习题答案',
        'kp-kanghua-5e-p530-部分习题答案',
        'kp-lihansun-5e-vol1-p305-部分习题答案上册',
        'kp-tongshibai-5e-p609-部分自测题和习题答案',
        'kp-yanshi-6e-p464-部分习题答案',
    }
    found: set[str] = set()
    for path in _tocs():
        toc = json.loads(path.read_text(encoding='utf-8'))
        for n in toc.get('nodes', []):
            if n.get('answerKey') is True:
                found.add(n['microKpId'])
    # 子集断言而不是相等断言：这里要守的是「这 5 个已知答案附录一个都不能丢」，
    # 「不能有第 6 个」不是目标 —— 以后加书多出答案附录是应该的，写成 `==`
    # 会让下一个人加书时被迫回来改这份清单，而改清单的人不会去想「为什么」。
    missing = wanted - found
    assert not missing, f'答案附录标记缺失：{sorted(missing)}（产物里共 {len(found)} 个）'


# ---- t24：书首前置页不该是可掌握知识点 -------------------------------------
#
# 判据是**结构**不是名字：`depth === 0 && isLeaf && num === ''`。这些是书的
# 卷名（「上册」）、目录（「目電录」是 OCR 错字）、书前绪论/术语表 —— 目录解析
# 把「无编号标题」挂到 stack[0]，它们就变成了根下的叶节点。
#
# 危害是用户可见的：`recommend.ts::compareScored` 的排序键是
# `moduleOrdinal → depth → ordinal → microKpId`，depth=0 永远赢过正常的
# depth=2/3，于是 `/recommendations` 前三名是「上册」「豐录」「目電录」。
#
# 归一化在 `frontmatter.py`，`run.py` 与 `ocr_run.py` 两个入口都调它，
# 所以这条测试守的是**产物**（重出后必须干净），不是某一次手工修补。


def test_no_depth0_unnumbered_leaf_survives() -> None:
    """任何一本书里都不该有「depth=0 且无编号」的叶节点。

    豁免：无。`jichangsong` 的「序言」（同一页、同一类东西）本来就是
    `isLeaf=false` —— 那是同类东西的正确形态，不是豁免项。降级后它仍在
    `nodes` 里、仍占着自己的 chunk，只是不再算可掌握知识点。
    """
    offenders: list[str] = []
    for path in _tocs():
        toc = json.loads(path.read_text(encoding='utf-8'))
        for n in toc.get('nodes', []):
            if n.get('depth') == 0 and n.get('isLeaf') is True and not (n.get('num') or '').strip():
                offenders.append(f"{path.parent.name}: {n['microKpId']} ({n.get('name')!r})")
    assert not offenders, (
        '这些书首前置页仍是叶知识点，学习者会在推荐里看到「上册」「目录」：\n'
        + '\n'.join(offenders)
        + '\n重出产物：python tools/ingest/fix_frontmatter.py'
    )


def test_front_matter_demotion_landed_for_the_known_five() -> None:
    """降级必须**保住 chunk**，不能为了修图而删内容。

    这 5 条各挂着 10–62 个 chunk（书首的序/目录/术语表正文）。降级成容器后
    地图/掌握度/出题/推荐都不再把它当知识点，但 chunk 仍挂在它下面、
    `content.controller.ts` 的 `WITH RECURSIVE subtree` 仍能查到。
    """
    from frontmatter import DEMOTED_FRONT_MATTER

    by_book: dict[str, dict] = {}
    for path in _tocs():
        by_book[path.parent.name] = {
            n['microKpId']: n for n in json.loads(path.read_text(encoding='utf-8')).get('nodes', [])
        }
    missing: list[str] = []
    still_leaf: list[str] = []
    for kp, _reason in DEMOTED_FRONT_MATTER:
        found = next((nodes[kp] for nodes in by_book.values() if kp in nodes), None)
        if found is None:
            missing.append(kp)
        elif found.get('isLeaf') is not False:
            still_leaf.append(kp)
    assert not missing, f'这 5 个书首前置页在产物里找不到了（被删了？）：{missing}'
    assert not still_leaf, f'这些仍是叶节点（降级没落进产物）：{still_leaf}'


def test_same_parent_same_name_leaves_have_distinct_numbers() -> None:
    """同一个父节点下、同名的叶节点，`num` 必须非空且互不相同。

    这是「OCR 丢了编号」的守门测试。一个父节点下出现两个同名叶节点，只在一种
    情况下可能：目录里它们本来各有编号，但编号在 OCR 时被拆行/丢了。

    范围限定在「该父节点下**本来就用编号**」的组（`num` 非空的兄弟 >= 2）：
    像 `methods-1997` 全书按「一、二、三 / 第X节」组织、`jichangsong` 手册体，
    它们的目录体例本来就不编号，把那些算成违规只会得到一份必须永久豁免的名单。

    豁免（必须写明理由）：
    - `kp-kanghuaguang-5e-p205-MOSFET` / `p211-MOSFET`：章 5 的 5.1 是**非叶**
      节点「金属-氧化物-半导体（M0S）场效应管」，它的 5.1.1–5.1.5 才是编号所在；
      这两个「MOSFET」是 OCR 把 5.1 的正文页标题当成了平级条目，页码 205/211
      分别落在 5.1.2 与 5.2 之内 —— 编号无法从父下的序列唯一确定（缺口为空），
      强行补一个号会把它们挂到错误的层级。已列入报告交 captain 判断。
    """
    ALLOWED = {
        # 康华光模拟：章 5 的 5.1 是**非叶**节点「金属-氧化物-半导体（M0S）场效应管」，
        # 它的 5.1.1–5.1.5 才是编号所在；这两个「MOSFET」是 OCR 把 5.1 的正文页标题
        # 当成了平级条目。页码 205/211 分别落在 5.1.2 与 5.2 之内 —— 父下的编号序列
        # 缺口是**空集**，无法唯一反推出该给哪一个号，强行补一个会把它们挂错层级。
        ('kp-kanghuaguang-5e-5', 'MOSFET'): '父下 5.1 是非叶，编号在 5.1.x；缺口为空，无法唯一推断',
        # Grupen《粒子探测器》第二章末尾的「未收录术语」小节：p69 的
        # 「辐射测量与的单位」与 p71 的「辐射源」是**术语索引页**上被 OCR 拆出来的
        # 残行，紧接着 p71/p76 才是真正的 3.1「辐射测量的单位」与 3.2「辐射源」——
        # 同名是「上一个词的残行 + 下一个词的标题」，不是同一个知识点丢了两个号。
        # 该父下 2.1–2.6 连续无缺口，没有任何号可以补。
        ('kp-grupen-2e-2008-2', '辐射源'): '第二章末的术语残行，真节点是同名 3.2（在第三章下）',
    }
    bad: list[str] = []
    for path in _tocs():
        toc = json.loads(path.read_text(encoding='utf-8'))
        nodes = toc.get('nodes', [])
        kids: dict[str | None, list[dict]] = {}
        for n in nodes:
            kids.setdefault(n.get('parentId'), []).append(n)
        for parent_id, sibs in kids.items():
            numbered = [s for s in sibs if (s.get('num') or '').strip()]
            if len(numbered) < 2:
                continue  # 这个父下本来就不用编号
            groups: dict[str, list[dict]] = {}
            for s in sibs:
                if s.get('isLeaf'):
                    groups.setdefault(s['name'], []).append(s)
            for name, ns in groups.items():
                if len(ns) < 2:
                    continue
                if (parent_id, name) in ALLOWED:
                    continue
                nums = [(n.get('num') or '').strip() for n in ns]
                if any(not x for x in nums) or len(set(nums)) != len(nums):
                    bad.append(
                        f'{path.parent.name}: 父 {parent_id} 下 {name!r} ×{len(ns)}，num={nums} '
                        f'（{", ".join(n["microKpId"] for n in ns)}）'
                    )
    assert not bad, '同父同名叶节点编号重复或缺失（OCR 丢了编号）：\n' + '\n'.join(bad)


# ---- t24：同名叶节点必须可区分（前端 `GraphNode` 不带 `num`）----------------


#: 消歧之后**仍然**同名同 depth 的叶节点组，豁免（每条必须写明理由）。
#:
#: 豁免不是「测试写不过就加名单」——每一条都必须是「编号真的无法从产物里
#: 反推」的结构性情形。能推的（有 `num` 的、父前缀不同的、节次在名字里的）
#: 都已由 `naming.disambiguate_duplicate_names()` 的三遗解决，不走这里。
DUPLICATE_NAME_ALLOWED: dict[tuple[str | None, str], str] = {
    # 康华光模拟：章 5 的 5.1 是**非叶**节点「金属-氧化物-半导体（MOS）场效应管」，
    # 编号在它的 5.1.1–5.1.5 下；这两个「MOSFET」是 OCR 把 5.1 的正文页标题当成
    # 平级条目（depth=2，与 5.1/5.2 平级）。页码 205/211 分别落在 5.1.2 与 5.2.1
    # 之内，要「拼回编号」必须同时改 depth 与 parentId —— 那是猜层级，不是补编号。
    # 已列入 t24 报告交 captain 判断，不猜。
    ('kp-kanghuaguang-5e-5', 'MOSFET'): '父下 5.1 是非叶，编号缺口为空，补号必须改层级=猜',
}


def test_duplicate_leaf_names_are_disambiguated() -> None:
    """同书内同名的叶节点，`name` 必须已经把编号拼进去。

    前端拿到的图谱/推荐响应里**没有 `num` 字段**（`graph.controller.ts` 的
    `GraphNode` 只有 `microKpId / name / state / percent / depth / moduleId /
    moduleName / moduleOrdinal / ordinal / reviewDueAt`），所以「7.1.1 概述」
    与「8.1.1 概述」在界面上长得一模一样 —— 学习者在推荐里看到「概述」，点进去
    不知道是哪一章的概述。把编号拼回 `name` 是**展示信息补全**，不新增字段、
    不改契约。

    归一化在 `naming.py`，三个入口（`run.py` / `ocr_run.py` / `toc_batch.py`）
    都调它。这条测试守的是**产物**：以后改了消歧规则而忘记重出，它会立刻红。

    豁免（必须写明理由，见 `naming.unresolved_duplicates` 的调用方日志）：
    """
    from naming import unresolved_duplicates

    bad: list[str] = []
    for path in _tocs():
        toc = json.loads(path.read_text(encoding='utf-8'))
        nodes = toc.get('nodes', [])
        for group in unresolved_duplicates(nodes):
            ids = group['ids']
            key = next(
                ((n.get('parentId'), group['name']) for n in nodes if n['microKpId'] == ids[0]),
                (None, None),
            )
            if key in DUPLICATE_NAME_ALLOWED:
                continue
            bad.append(
                f'{path.parent.name}: {group["name"]!r} ×{len(ids)} '
                f'ids={ids} pages={group["pages"]}'
            )
    assert not bad, (
        '这些叶节点同书同名，学习者在推荐里分不清是哪一章的：\n'
        + '\n'.join(bad)
        + '\n重出产物：python tools/ingest/fix_names.py'
    )


def test_naming_normalization_is_idempotent() -> None:
    """消歧是幂等的：对已经改过的产物再跑一次，一个都不该再改。

    管线会在每次重跑时调用 `disambiguate_duplicate_names()`，而 `fix_names.py`
    又把已落盘的旧产物打到同一状态 —— 两条路径都会在**同一份**产物上再跑一次。
    不幂等就会变成 `1.1 1.1 概述`，每重跑一次多一层前缀。
    """
    from naming import disambiguate_duplicate_names

    changed: list[str] = []
    for path in _tocs():
        toc = json.loads(path.read_text(encoding='utf-8'))
        nodes = toc.get('nodes', [])
        again = disambiguate_duplicate_names(nodes)
        if again:
            changed.append(f'{path.parent.name}: {again[:3]}')
    assert not changed, '产物里的名字还没消歧，或消歧不幂等：\n' + '\n'.join(changed)


def test_same_book_same_depth_leaves_have_distinct_names() -> None:
    """任何书内**同名且同 depth** 的叶节点，`name` 必须互不相同（且 `num` 非空）。

    这是 captain 给 t24 的原话判据，与上一条互补：
    - 上一条查「同书同名」（不限 depth）—— 更严，但只报**未消歧**的组；
    - 这一条查「同 depth 同名」的组里 `num` 是否非空且互不相同。

    今天只剩 1 组（康华光 `MOSFET`×2，见 `DUPLICATE_NAME_ALLOWED` 的理由），
    所以这条测试主要是**防回归**：谁把 `naming.disambiguate_duplicate_names()`
    从入口摘掉、或重跑产物时忘了走管线，它立刻红 —— 而不是等到学习者在推荐里
    看到 8 个「概述」才发现。

    `num` 必须非空：只靠 `name` 不同还不够，`num` 是「这条知识点在书里的
    位置」的机器可读形式，检索/排序/溯源都靠它。
    """
    bad: list[str] = []
    for path in _tocs():
        nodes = json.loads(path.read_text(encoding='utf-8')).get('nodes', [])
        groups: dict[tuple[int, str], list[dict]] = {}
        for n in nodes:
            if n.get('isLeaf') is True:
                groups.setdefault((n.get('depth'), n.get('name') or ''), []).append(n)
        for (depth, name), ns in groups.items():
            if len(ns) < 2:
                continue
            if (ns[0].get('parentId'), name) in DUPLICATE_NAME_ALLOWED:
                continue
            nums = [(n.get('num') or '').strip() for n in ns]
            if any(not x for x in nums) or len(set(nums)) != len(nums):
                bad.append(
                    f'{path.parent.name}: depth={depth} {name!r} ×{len(ns)} num={nums} '
                    f'（{", ".join(n["microKpId"] for n in ns)}）'
                )
    assert not bad, (
        '同书同 depth 的叶节点重名，且 num 不足以区分：\n'
        + '\n'.join(bad)
        + '\n重出产物：python tools/ingest/fix_names.py'
    )
