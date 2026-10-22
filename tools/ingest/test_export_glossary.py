"""`export_glossary.py` 的不变量测试。

守的是**产物**（`content/glossary.json`）与**规则**（`export_glossary.py`）的一致性，
以及几条容易被「顺手改一下」破坏的清洗规则。每条测试都对应一个真实的脏数据形态，
不是假想的边界。

## 为什么这些规则需要测试

词表是检索的扩展开关：一条脏条目会让「命中一切」（`en` 是 `is` 或 `ee`），
一条被误删的好条目会让整片英文语料继续不可达（`探测器 → Detector` 就是这样
从 30 个 OCR 残缺写法里救回来的）。两种错误都不会报错，只会表现为「检索怪怪的」。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from export_glossary import (  # noqa: E402
    MAX_EN_PER_ZH,
    OUTPUT,
    build_glossary,
    is_usable_pair,
    reduce_variants,
    render,
    strip_number_prefix,
    strip_ocr_lead,
)

ROOT = Path(__file__).resolve().parents[2]
CONTENT = ROOT / 'content'


def _entries() -> list[dict]:
    return json.loads(OUTPUT.read_text(encoding='utf-8'))


# ---------------------------------------------------------------------------
# 产物
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not OUTPUT.exists(), reason='还没有生成 content/glossary.json')
def test_artifact_is_up_to_date_with_the_current_rule() -> None:
    """产物必须由当前代码生成 —— 改了规则忘记重出，这条立刻红。

    与 `test_content_artifacts.py` 守 `toc.json` 是同一个思路：产物是入库的，
    它不会因为代码变了而自己更新。
    """
    assert OUTPUT.read_text(encoding='utf-8') == render(build_glossary())


@pytest.mark.skipif(not OUTPUT.exists(), reason='还没有生成 content/glossary.json')
def test_artifact_shape_and_ordering() -> None:
    """字段齐全、按 zh 排序、无空条目 —— 产物稳定才能做 diff 审查。"""
    entries = _entries()
    assert len(entries) > 1000, f'词表只有 {len(entries)} 条，英文书有 3600+ 个带原文的节点'
    zh_list = [e['zh'] for e in entries]
    assert zh_list == sorted(zh_list), '条目必须按 zh 排序'
    assert len(set(zh_list)) == len(zh_list), 'zh 必须唯一（同义写法在 en 里合并）'
    for entry in entries:
        assert set(entry) == {'zh', 'en', 'sources'}, entry
        assert len(entry['zh']) >= 2, entry
        assert entry['en'], f'空 en：{entry["zh"]}'
        assert len(entry['en']) <= MAX_EN_PER_ZH, entry
        assert entry['sources'], f'没有来源：{entry["zh"]}'


# ---------------------------------------------------------------------------
# 清洗规则（每条对应一类真实脏数据）
# ---------------------------------------------------------------------------


def test_number_prefix_is_stripped_but_not_helium_three() -> None:
    """编号要剥，`3He` 与 `1/f` 不能剥。"""
    assert strip_number_prefix('1.3 Radioactivity and radioactive decay') == (
        'Radioactivity and radioactive decay'
    )
    assert strip_number_prefix('7.2.E Semiconductor microstrip detector') == (
        'Semiconductor microstrip detector'
    )
    assert strip_number_prefix('A.2 Introduction of dopants') == 'Introduction of dopants'
    # 反例：这两条的 `3` / `1` 是物理量的一部分，剥了就不是同一个词
    assert strip_number_prefix('3He Detectors') == '3He Detectors'
    assert strip_number_prefix('1/f noise') == '1/f noise'


def test_ocr_lead_fragment_is_stripped() -> None:
    """OCR 把章节号与首词认成一串碎片时要剥掉（`is Pulse Shaping`）。"""
    assert strip_ocr_lead('is Pulse Shaping') == 'Pulse Shaping'
    assert strip_ocr_lead('oe The field effect') == 'The field effect'
    assert strip_ocr_lead('Pulse shaping') == 'Pulse shaping'
    # 不能把正常单词当碎片剥掉：`ADC` 是大写、`dE/dx` 含斜杠
    assert strip_ocr_lead('ADC performance') == 'ADC performance'
    assert strip_ocr_lead('dE/dx for Mixtures') == 'dE/dx for Mixtures'


@pytest.mark.parametrize(
    ('zh', 'en', 'ok'),
    [
        ('锗探测器', 'Germanium Detectors', True),
        ('探测器', 'Detectors', True),
        # 长度 <2
        ('与', 'and', False),
        ('噪声', 'n', False),
        # 翻译失败标记
        ('未收录术语（Branching ratio）', 'Branching ratio', False),
        # 中文书的 nameOriginal 就是中文，进表只会造出中文→中文
        ('基尔霍夫定律', '基尔霍夫定律', False),
        # OCR 把 YAP:Ce 认成汉字乱码
        ('闪烁体', 'Cerium-doped yttrium aluminum perovskite 夀䄀倀㨀䌀攀', False),
    ],
)
def test_usable_pair_rules(zh: str, en: str, ok: bool) -> None:
    assert is_usable_pair(zh, en) is ok


def test_reduce_variants_drops_longer_titles_and_prefers_single_words() -> None:
    """`探测器` 那 30 个写法必须缩成 `Detector`，而不是整条被丢掉。

    这是这份词表最容易做错的一处：OCR 把 30 个「XX 探测器」小节都译成「探测器」，
    按原始写法数会超过上限而被整条丢弃 —— 于是「探测器」这个最常用的术语
    在词表里消失，中文 query 照样命中不了英文正文。
    """
    variants = [
        'Microstrip detectors',
        'Diamond detectors',
        'Thermoluminescent detectors',
        'Detectors',
        'Detector size',
        'PACKAGING OF DETECTORS',
    ]
    assert reduce_variants(variants) == ['Detectors']


def test_reduce_variants_keeps_multi_word_when_no_single_word_exists() -> None:
    """整组没有单词写法时全留（`Germanium Detectors` 不能被丢掉）。"""
    assert reduce_variants(['Germanium Detectors']) == ['Germanium Detectors']
    # 被包含的长串丢掉，剩下的仍按原顺序
    assert reduce_variants(['Pulse shaping', 'Semi-triangular pulse shaping']) == ['Pulse shaping']


@pytest.mark.skipif(not OUTPUT.exists(), reason='还没有生成 content/glossary.json')
def test_common_words_that_are_ocr_residue_are_dropped() -> None:
    """`能量` / `类型` / `方法` 这类通用词缩减后仍超上限，必须整条丢弃。

    它们在英文正文里是 `energy` / `type` / `method`，展开它们等于「命中一切」。
    正向对照：`噪声` 也从 11 个写法缩减到 1 个，但它是真术语，必须留下。
    """
    by_zh = {e['zh']: e for e in _entries()}
    for generic in ('能量', '类型', '方法'):
        assert generic not in by_zh, f'{generic} 是通用词，展开它会把检索变成命中一切'
    assert by_zh['噪声']['en'] == ['Noise']
    assert by_zh['探测器']['en'] == ['Detector']


@pytest.mark.skipif(not OUTPUT.exists(), reason='还没有生成 content/glossary.json')
def test_terms_the_captain_verified_are_in_the_glossary() -> None:
    """t32 派单里点名的四条术语必须在表里，且指向正确的英文。

    这四条是端到端验收用的 query 词：`锗探测器能量分辨` 要靠 `锗探测器`。
    """
    by_zh = {e['zh']: e['en'] for e in _entries()}
    assert by_zh['锗探测器'] == ['Germanium Detectors']
    assert by_zh['脉冲成形'] == ['Pulse shaping']
    assert by_zh['死时间'] == ['Dead Time']
    assert by_zh['多道分析器'] == ['Multichannel Analyzer']


@pytest.mark.skipif(not OUTPUT.exists(), reason='还没有生成 content/glossary.json')
def test_every_source_book_that_has_english_originals_contributed() -> None:
    """每本**英文书**都必须有贡献 —— 少一本就是「这本书的术语全搜不到」。

    ## 为什么不是「`nameOriginal` 非空的 15 本」

    实测 15 本书的 `nameOriginal` 非空，但 `guojiang-2014` / `guojiang-2023` 是
    中文教材 —— 它们的 `nameOriginal` 填的就是中文原名（`第1章 原子的核式结构…`），
    只有 `X射线` 这种带 ASCII 字母的标题例外。按「非空」数会把这 2 本中文书
    算进英文书，而它们一条术语也不该进表（清洗规则 3）。

    真正的英文书是 **13 本**，它们必须全部贡献。
    """
    english_books: set[str] = set()
    for path in sorted(CONTENT.glob('*/toc.json')):
        toc = json.loads(path.read_text(encoding='utf-8'))
        originals = [(n.get('nameOriginal') or '') for n in toc.get('nodes', [])]
        # 「英文书」= 有相当比例的原文是英文，而不是零星一个 `X射线`
        ascii_count = sum(1 for text in originals if re.search(r'[A-Za-z]', text))
        if ascii_count >= len(originals) * 0.5 > 0:
            english_books.add(path.parent.name)

    assert len(english_books) == 13, f'英文书应该是 13 本，实际 {len(english_books)}：{sorted(english_books)}'

    sources = {s for entry in _entries() for s in entry['sources']}
    assert english_books <= sources, f'这些书一条术语都没进表：{sorted(english_books - sources)}'
    # 中文书不得进表（否则会造出「中文→中文」的空转条目）
    assert not ({'guojiang-2014', 'guojiang-2023'} & sources), '中文书的 nameOriginal 是中文，不该进词表'
