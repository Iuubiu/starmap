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
    修 `toc.py` 后它才作为独立节点出现。以后再加书这里应继续增长，而不是被
    改成子集断言。
    """
    want = {
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
    assert found == want, f'答案附录标记缺失：{sorted(want - found)}'
