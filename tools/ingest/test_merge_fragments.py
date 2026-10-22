"""`merge_fragments.py` 的单元测试 + 管线接线守门（t61）。

## 两层，理由与 `test_naming.py` 相同

1. **纯函数测试**：A 类去标点、B 类合并续行、C 类误报不合并、幂等。
2. **接线测试**：四个写 `toc.json` 的入口都必须调用它 —— 摘掉任何一处，
   产物测试看不见（产物已经改过了），要等下次重跑才暴露。
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from merge_fragments import (  # noqa: E402
    DANGLING,
    LEADING_PUNCT,
    find_fold_candidates,
    folded_into,
    format_changes,
    is_leading_punct_fragment,
    merge_fragments,
    report_changes,
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
    }


# ---- A 类：去起首标点 ------------------------------------------------------


def test_strips_leading_punct_only() -> None:
    """只剥起首的、且只剥 `LEADING_PUNCT` 里的那几个。"""
    nodes = [node('a', '、晶体三极管模型及其参数'), node('b', '。中子探测方法'), node('c', '：工作原理')]
    changes = merge_fragments(nodes)
    assert [n['name'] for n in nodes] == ['晶体三极管模型及其参数', '中子探测方法', '工作原理']
    assert [c['kind'] for c in changes] == ['strip', 'strip', 'strip']
    assert all(c['microKpId'] for c in changes)


def test_leading_punct_set_matches_the_sql() -> None:
    """票面 acceptance 的 SQL 是 `name ~ '^[、，。；：）)]'`，集合必须逐字对齐。"""
    assert LEADING_PUNCT == '、，。；：）)'
    for ch in LEADING_PUNCT:
        assert is_leading_punct_fragment(node('x', ch + '标题'))


def test_does_not_touch_mid_string_punct() -> None:
    """正文里的顿号是内容的一部分（`核科学、核试验`），不能动。"""
    nodes = [node('a', '核探测技术在核科学、核试验测试中的应用')]
    assert merge_fragments(nodes) == []
    assert nodes[0]['name'] == '核探测技术在核科学、核试验测试中的应用'


def test_does_not_touch_a_name_that_is_only_punct() -> None:
    """整名就是一个标点：不是标题，不猜，留给人工。"""
    nodes = [node('a', '、')]
    assert merge_fragments(nodes) == []
    assert nodes[0]['name'] == '、'


# ---- B 类：合并折行续行 ----------------------------------------------------


def test_folds_continuation_into_previous_sibling() -> None:
    """dinghonglin-2010 的真实形状：前一条以「的」结尾，本条无编号且同页。"""
    nodes = [
        node('ch', '绪论', num='1', depth=1, leaf=False),
        node('a', '核探测技术在核科学研究、核试验测试、核技术应用中的', num='1.1', parent='ch', page=1),
        node('b', '作用与地位', num='', parent='ch', page=1),
        node('c', '核辐射探测器的发展及其应用简介', num='1.2', parent='ch', page=3),
    ]
    changes = merge_fragments(nodes)
    assert len(changes) == 1
    assert changes[0]['kind'] == 'fold'
    assert changes[0]['keeperId'] == 'a'
    assert changes[0]['microKpId'] == 'b'
    assert [n['microKpId'] for n in nodes] == ['ch', 'a', 'c']
    assert nodes[1]['name'] == '核探测技术在核科学研究、核试验测试、核技术应用中的作用与地位'
    assert folded_into(changes) == {'b': 'a'}


def test_every_dangling_char_is_really_dangling() -> None:
    """判据表的每个字都要能触发合并 —— 防止有人改表却没改测试。"""
    for ch in DANGLING:
        nodes = [
            node('a', f'标题以{ch}', num='1.1', parent='p', page=1),
            node('b', '续行', num='', parent='p', page=1),
        ]
        assert len(find_fold_candidates(nodes)) == 1, f'{ch!r} 没有触发合并'


def test_numbered_node_is_never_folded() -> None:
    """有编号就是独立条目（`leo-2e` 的 `时间至幅度转换器或` + `14.15 定标器`）。"""
    nodes = [
        node('a', '时间至幅度转换器或', num='14.14', parent='p', page=294),
        node('b', '定标器', num='14.15', parent='p', page=294),
    ]
    assert merge_fragments(nodes) == []
    assert len(nodes) == 2


def test_different_page_is_never_folded() -> None:
    """跨页的「续行」更像真条目，不猜（`lutz-2007` 的 `小结与` + `部分：半导体探测器`）。"""
    nodes = [
        node('a', '基础半导体结构 小结与', num='', parent='p', page=73),
        node('b', '部分：半导体探测器', num='', parent='p', page=77),
    ]
    assert merge_fragments(nodes) == []


def test_different_parent_is_never_folded() -> None:
    """跨父节点不合并：那会把两个章节的条目并到一起。"""
    nodes = [
        node('a', '标题以的', num='', parent='p1', page=1),
        node('b', '续行', num='', parent='p2', page=1),
    ]
    assert merge_fragments(nodes) == []


# ---- C 类误报：票面点名不许合并 --------------------------------------------


def test_appendix_pairs_are_not_merged() -> None:
    """`附录A…` / `附录B…` 是同级真附录（digital-kanghua-5e 的真实形状）。"""
    nodes = [
        node('a', '附录ACMOS和TTL逻辑门电路的技术参数', num='', leaf=False, page=504),
        node('b', '附录BQuartusⅡ 5.0开发软件简介', num='', leaf=False, page=505),
    ]
    assert merge_fragments(nodes) == []
    assert len(nodes) == 2


def test_real_sibling_items_are_not_merged() -> None:
    """`二、同轴型HPGe…` / `三、HPGe探测器…` 与 `二、探测器望远镜…` / `三、超灵敏…`。

    两条都以实词结尾，且带「二、」「三、」序号 —— 判据 1（前一条以悬空连接词
    结尾）不成立。
    """
    nodes = [
        node('a', '二、同轴型HPGe探测器的电场和电容', num='', page=148),
        node('b', '三、HPGe探测器的主要性能', num='', page=149),
        node('c', '二、探测器望远镜方法', num='', page=404),
        node('d', '三、超灵敏加速器质谱仪', num='', page=405),
    ]
    assert merge_fragments(nodes) == []
    assert len(nodes) == 4


# ---- 幂等与报告 ------------------------------------------------------------


def test_is_idempotent() -> None:
    nodes = [
        node('a', '、晶体三极管模型及其参数'),
        node('b', '标题以的', num='1.1', parent='p', page=1),
        node('c', '续行', num='', parent='p', page=1),
    ]
    first = merge_fragments(nodes)
    assert len(first) == 2
    second = merge_fragments(nodes)
    assert second == [], '第二遍不能再改任何东西'


def test_report_is_readable_and_silent_when_empty() -> None:
    assert '0' in report_changes([])
    text = report_changes(
        [
            {'kind': 'strip', 'microKpId': 'a', 'before': '、标题', 'after': '标题'},
            {'kind': 'fold', 'microKpId': 'b', 'before': '续行', 'after': '标题续行', 'keeperId': 'a'},
        ]
    )
    assert '2' in text and '去标点 1' in text and '合并续行 1' in text


def test_format_changes_lists_every_item() -> None:
    """票面 AC③ 要求逐条可核对，不是只报个数。"""
    lines = format_changes(
        [
            {'kind': 'strip', 'microKpId': 'a', 'before': '、标题', 'after': '标题'},
            {'kind': 'fold', 'microKpId': 'b', 'before': '续行', 'after': '标题续行', 'keeperId': 'a'},
        ]
    )
    assert len(lines) == 2
    assert 'a' in lines[0] and '标题' in lines[0]
    assert 'b' in lines[1] and 'a' in lines[1]


# ---- 接线：四个入口都必须调用 ----------------------------------------------

ENTRYPOINTS = ('run.py', 'ocr_run.py', 'toc_batch.py', 'books_batch.py')


def test_every_toc_writer_wires_the_merge() -> None:
    missing: list[str] = []
    for name in ENTRYPOINTS:
        source = io.open(INGEST / name, encoding='utf-8').read()
        if 'merge_fragments(' not in source:
            missing.append(name)
    assert not missing, (
        '这些入口写 toc.json 但没有调用 merge_fragments()，'
        f'重跑会把碎片名打回原形：{missing}'
    )


def test_entrypoints_log_the_merge() -> None:
    """改产物必须可见：静默改等于没法审计「为什么这个名字变了」。"""
    silent = [
        name
        for name in ENTRYPOINTS
        if 'report_changes(' not in io.open(INGEST / name, encoding='utf-8').read()
    ]
    assert not silent, f'这些入口改了名却没打日志：{silent}'


def test_merge_runs_before_disambiguation() -> None:
    """A 类去标点后可能与既有节点重名，必须先合并再去重消歧。

    反序时 `disambiguate_duplicate_names()` 看不到新造出来的重名。
    """
    wrong: list[str] = []
    for name in ENTRYPOINTS:
        source = io.open(INGEST / name, encoding='utf-8').read()
        i_merge = source.find('merge_fragments(')
        i_dedup = source.find('disambiguate_duplicate_names(')
        if i_merge < 0 or i_dedup < 0:
            continue  # 上面两条测试会报
        if i_merge > i_dedup:
            wrong.append(name)
    assert not wrong, f'这些入口的调用顺序反了（先消歧后合并）：{wrong}'


# ---- 产物写回必须沿用原文件的换行与结尾 ------------------------------------


def test_artifact_writer_preserves_crlf(tmp_path) -> None:
    """`content/**` 的产物在 Windows 上是 CRLF，写回不能翻成 LF。

    真踩过：第一版用 `newline='\n'` 写回，六个产物文件的 diff 从「11 处真改动」
    变成「两万多行换行全变」，11 处被埋进噪声里，评审与 `git blame` 都没法用。
    """
    from merge_fragments import _write_preserving_eol

    path = tmp_path / 'toc.json'
    path.write_bytes(b'{\r\n  "a": 1\r\n}\r\n')
    _write_preserving_eol(path, '{\n  "a": 2\n}')
    raw = path.read_bytes()
    assert raw == b'{\r\n  "a": 2\r\n}\r\n', 'CRLF 与结尾换行都要原样保留'
    assert raw.count(b'\n') == raw.count(b'\r\n'), '不能混进裸 LF'


def test_artifact_writer_preserves_missing_trailing_newline(tmp_path) -> None:
    r"""原文件没有结尾换行时，写回也不要凭空加一个。

    加了会多出一条 `\ No newline at end of file` 的 diff —— 不是错，但让评审
    多看一处与改动无关的地方。
    """
    from merge_fragments import _write_preserving_eol

    path = tmp_path / 'toc.json'
    path.write_bytes(b'{\n  "a": 1\n}')
    _write_preserving_eol(path, '{\n  "a": 2\n}')
    assert path.read_bytes() == b'{\n  "a": 2\n}'


def test_lf_files_stay_lf(tmp_path) -> None:
    """本来就是 LF 的文件不要被改成 CRLF。"""
    from merge_fragments import _write_preserving_eol

    path = tmp_path / 'chunks.jsonl'
    path.write_bytes(b'{"a":1}\n{"a":2}\n')
    _write_preserving_eol(path, '{"a":9}\n{"a":2}\n')
    assert path.read_bytes() == b'{"a":9}\n{"a":2}\n'


# ---- AC③：被排除的候选必须逐条可核对 ----------------------------------------


def test_near_misses_lists_the_three_ticket_pairs_with_reason() -> None:
    """票面点名的三对 C 类必须出现在排除清单里，且理由是同一条判据。

    只报「改了几处」不够：读报告的人无法区分「判据排除了它」和「脚本没看到它」。
    """
    from merge_fragments import find_near_misses

    nodes = [
        # 附录A / 附录B：同级真附录，前一条不以悬空连接词结尾
        node('kp-app-a', '附录ACMOS和TTL逻辑门电路的技术参数', page=504, leaf=False),
        node('kp-app-b', '附录BQuartusⅡ 5.0开发软件简介', page=505, leaf=False),
        # 二、同轴型HPGe / 三、HPGe探测器的主要性能
        node('kp-hpge-2', '二、同轴型HPGe探测器的电场和电容', page=148),
        node('kp-hpge-3', '三、HPGe探测器的主要性能', page=149),
        # 二、探测器望远镜 / 三、超灵敏加速器质谱仪
        node('kp-tel-2', '二、探测器望远镜与飞行时间方法的组合', page=415),
        node('kp-tel-3', '三、超灵敏加速器质谱仪', page=416),
    ]
    misses = find_near_misses(nodes)
    excluded_ids = {m['curId'] for m in misses}
    assert excluded_ids == {'kp-app-b', 'kp-hpge-3', 'kp-tel-3'}, excluded_ids
    assert all(m['reason'] == '前一条不以悬空连接词结尾' for m in misses), misses


def test_near_misses_explains_cross_page_dangling() -> None:
    """前一条以悬空连接词结尾但跨页时，理由要说清是「跨页不猜」。"""
    from merge_fragments import find_near_misses

    nodes = [
        node('kp-x-1', '核探测技术在核科学研究、核试验测试、核技术应用中的', page=1),
        node('kp-x-2', '作用与地位', page=2),
    ]
    misses = find_near_misses(nodes)
    assert len(misses) == 1, misses
    assert '不同页' in misses[0]['reason'], misses[0]['reason']


def test_near_misses_skips_the_one_that_really_gets_merged() -> None:
    """真被合并的那一对不该出现在排除清单里（否则清单自相矛盾）。"""
    from merge_fragments import find_near_misses

    nodes = [
        node('kp-x-1', '核探测技术在核科学研究、核试验测试、核技术应用中的', page=1),
        node('kp-x-2', '作用与地位', page=1),
    ]
    assert find_near_misses(nodes) == []


def test_near_misses_skips_leading_punct_and_numbered() -> None:
    """A 类（去标点）与有编号的节点都不是「续行候选」，不进清单。"""
    from merge_fragments import find_near_misses

    nodes = [
        node('kp-a-1', '二极管模型及其参数', page=596),
        node('kp-a-2', '、晶体三极管模型及其参数', page=598),
        node('kp-a-3', '13.4 中子探测方法', num='13.4', page=598),
    ]
    assert find_near_misses(nodes) == []


def test_exclusion_summary_groups_by_reason() -> None:
    """默认模式只打一行分组计数；0 处时说「0 处」而不是空串。"""
    from merge_fragments import summarize_exclusions

    assert summarize_exclusions([]) == '被排除的续行候选 0 处'
    text = summarize_exclusions(
        [
            {'curId': 'a', 'curName': 'x', 'prevId': 'p', 'prevName': 'y', 'pageDelta': 0,
             'reason': '前一条不以悬空连接词结尾'},
            {'curId': 'b', 'curName': 'x', 'prevId': 'p', 'prevName': 'y', 'pageDelta': 1,
             'reason': '前一条不以悬空连接词结尾'},
        ]
    )
    assert '2 处' in text and '前一条不以悬空连接词结尾 2 处' in text, text


def test_format_exclusions_one_line_each_with_both_names() -> None:
    """逐条明细要同时给出碎片名、理由、前一条 id 与名、页码差 —— 少了任一项都没法复核。"""
    from merge_fragments import format_exclusions

    lines = format_exclusions(
        [
            {'curId': 'kp-c', 'curName': '三、HPGe探测器的主要性能', 'prevId': 'kp-p',
             'prevName': '二、同轴型HPGe探测器的电场和电容', 'pageDelta': 1,
             'reason': '前一条不以悬空连接词结尾'}
        ]
    )
    assert len(lines) == 1
    for fragment in ('kp-c', '三、HPGe探测器的主要性能', '前一条不以悬空连接词结尾',
                     'kp-p', '二、同轴型HPGe探测器的电场和电容', '页码差 1'):
        assert fragment in lines[0], (fragment, lines[0])
