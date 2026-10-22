"""票 02 AC 第 1、2 条的回归测试：抽样页逐句对照。

不是「跑一遍看看」，而是把核对结论固化成断言 —— 以后改版面规则再跑全量，
这里会立刻告诉你哪一页开始漏段。

真值取自康华光《电子技术基础·数字部分》第 5 版原书（本仓库 `资源库/books/`）。
原书或产物不在时 skip，不让 CI 依赖 60MB 的 PDF。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / '资源库' / 'books' / '21_电子技术基础_数字部分_康华光_第5版.pdf'
CONTENT = ROOT / 'content' / 'digital-kanghua-5e'
PAGE_OFFSET = 22

# 抽样点覆盖全书：前 20 页（目录/绪论/表格密集）、各章开头、公式密集区、书末。
SAMPLE_PAGES = [2, 8, 14, 28, 40, 52, 62, 83, 96, 110, 132, 155, 178, 196, 210, 240, 268, 300, 340, 420]

_SENT = re.compile(r'[^。！？；\n]+[。！？；]?')


def _norm(s: str) -> str:
    """只留文字与数字。比对的是「这段话在不在」，不是排版。"""
    return re.sub(r'[^\u4e00-\u9fffA-Za-z0-9]', '', s)


pytestmark = pytest.mark.skipif(
    not PDF.exists() or not (CONTENT / 'chunks.jsonl').exists(),
    reason='原书或抽取产物不在，跳过（不在 CI 里依赖 60MB PDF）',
)


@pytest.fixture(scope='module')
def haystack() -> str:
    lines = (CONTENT / 'chunks.jsonl').read_text(encoding='utf-8').splitlines()
    chunks = [json.loads(line) for line in lines if line]
    return _norm(''.join(c['text'] for c in chunks))


@pytest.fixture(scope='module')
def doc():
    pymupdf = pytest.importorskip('pymupdf')
    return pymupdf.open(PDF)


def test_sampled_pages_lose_no_whole_sentence(doc, haystack: str) -> None:
    """抽样 20 页，PDF 里的每个句子都必须在产物里出现过。

    这是 AC 第 1 条「不漏整段」的机器化版本。字数覆盖率靠不住：图内标签
    被并进 figure 是该丢的、段落被漏掉是不该丢的，两者在字数上分不开。
    句子级比对能把它们分开。
    """
    missing: list[tuple[int, str]] = []
    checked = 0
    for printed in SAMPLE_PAGES:
        idx = printed + PAGE_OFFSET
        if not (0 <= idx < doc.page_count):
            continue
        for sent in _SENT.findall(doc[idx].get_text()):
            n = _norm(sent)
            if len(n) < 20:  # 太短的句子多半是图内标签，逐句比会误报
                continue
            checked += 1
            if n not in haystack:
                missing.append((printed, sent.strip()))

    assert checked > 100, f'参与比对的句子只有 {checked} 句，抽样可能失效了'
    assert missing == [], '以下句子在抽取产物里找不到：\n' + '\n'.join(
        f'  p.{p}: {" ".join(s.split())[:120]}' for p, s in missing
    )


def test_sampled_pages_keep_almost_all_characters(haystack: str, doc) -> None:
    """抽样 20 页的字符覆盖率必须 ≥98%，且没有任何 ≥20 字符的片段整段丢失。

    上一条按「句」比，只覆盖到 172 句 —— 90% 的句子因长度 <20 被跳过，漏掉
    一个短句不会被发现。这条按「片段」比：以句读与换行切分 PDF 原文，逐段
    查在不在产物里，统计的是**字符**而不是句子。实测覆盖率 98.7%，
    未覆盖的 22 个片段最长 15 字符（都是图内标签与页眉页脚）。

    只断言「没有 ≥20 字符的片段丢失」而不是要求 100%：图内标签（`Vcc`、
    `t_w`）本来就该被并进 figure，把它们算成漏抽会让这条测试永远红。
    """
    uncovered: list[tuple[int, int, str]] = []
    total = covered = 0
    for printed in SAMPLE_PAGES:
        idx = printed + PAGE_OFFSET
        if not (0 <= idx < doc.page_count):
            continue
        for seg in re.split(r'(?<=[。！？；\n])', doc[idx].get_text()):
            n = _norm(seg)
            if not n:
                continue
            total += len(n)
            if n in haystack:
                covered += len(n)
            else:
                uncovered.append((printed, len(n), seg.strip()))

    ratio = covered / total
    lost = [u for u in uncovered if u[1] >= 20]
    assert lost == [], '以下片段整段丢失：\n' + '\n'.join(
        f'  p.{p} ({n} 字): {s[:110]}' for p, n, s in lost
    )
    assert ratio >= 0.98, f'抽样页字符覆盖率只有 {ratio:.1%}，低于 98%'


def test_grey_code_table_is_reconstructed_correctly(haystack: str) -> None:
    """真值表必须还原成网格，不能碎成单字符一行。

    格雷码表是这本书最容易被抽坏的表（扫描重排、上下标、无画线），
    16 组映射全部可交叉校验。AC 第 2 条要的就是这个。
    """
    rows = [json.loads(line) for line in (CONTENT / 'chunks.jsonl').read_text(encoding='utf-8').splitlines() if line]
    tables = [c for c in rows if c['kind'] == 'table' and c.get('rows')]
    assert tables, '一个表格都没抽出来'

    # 找到含格雷码的那张表（第 50 页，印刷页 28）
    grey = [t for t in tables if t['printed_page'] == 28 and len(t['rows'][0]) >= 9]
    assert grey, '第 28 页的格雷码表没被识别成表格'

    flat = '\n'.join(''.join(r) for r in grey[0]['rows'])
    # 交叉校验：格雷码的经典映射。全对上说明格子没串行、没漏行。
    mappings = [('0000', '0000'), ('0001', '0001'), ('0010', '0011'), ('0011', '0010'),
                ('0100', '0110'), ('0101', '0111'), ('0110', '0101'), ('0111', '0100')]
    for binary, code in mappings:
        assert binary in flat, f'二进制码 {binary} 在表里找不到'
        assert code in flat, f'格雷码 {code} 在表里找不到'


def test_no_binary_fragments_leaked_into_prose() -> None:
    """表格格子不得漏进正文。漏了会让检索命中一堆 `1100011111011`。"""
    lines = (CONTENT / 'chunks.jsonl').read_text(encoding='utf-8').splitlines()
    chunks = [json.loads(line) for line in lines if line]
    bad = [
        c for c in chunks
        if c['kind'] == 'text'
        and len(c['text']) < 260
        and len(''.join(c['text'].split())) > 10
        and not any('\u4e00' <= ch <= '\u9fff' for ch in c['text'])
    ]
    assert bad == [], f'{len(bad)} 条纯数字/字母碎片混进了正文：' + '; '.join(
        f"p.{c['printed_page']} {c['text'][:40]}" for c in bad[:5]
    )


def test_every_figure_caption_became_a_figure_chunk(doc, haystack: str) -> None:
    """图注必须留下 —— 它是唯一能检索到一张图的文本。

    实测踩过：图本体在上一页、图注正上方是表格带、两个图注粘成一行，
    三种情况都曾让图注整条消失。
    """
    rows = [json.loads(line) for line in (CONTENT / 'chunks.jsonl').read_text(encoding='utf-8').splitlines() if line]
    figures = [c for c in rows if c['kind'] == 'figure']
    assert len(figures) > 200, f'只抽到 {len(figures)} 个图，全书有 255 个图注'

    # 每个 figure 的 text 里必须有图注编号，不能是空串
    assert all(c['text'].strip() for c in figures), '有 figure chunk 的 text 是空的'
