# -*- coding: utf-8 -*-
"""15 本英文/中文教材的目录解析测试（票 26）。

## 这一套守什么

`toc.py` 的 `parse_toc_text` 只认**中文点线版式**（`编号 + 标题 + ⋯填充 + 页码`
同一行）。15 本新书里只有 4 本有这个运气（10/11 有书签、26/27 有中文书签），
其余 11 本是另外三种英文版式。`toc_books.parse_book` 就是为它们写的。

如果这个模块退化成「静默返回空树」，`import-content.ts` 会在
`chapters.length === 0` 时抛错 —— 但如果只是**部分**条目解析丢了，导入会
成功、库里那本书少几十个知识点，**没有任何人会发现**。所以测试要钉住的是
「三种版式各自解析出多少条、结构对不对」，而不是「没抛异常」。

## 输入从哪来

- 版式 A/B/C 的行**逐字照抄真实 PDF 的 `_collect_rows` 输出**（坐标聚行之后
  的单元格列表），注释里标了是哪本书哪一页。用真实行而不是手写字符串，是因为
  手写会把「OCR 把 `1 04` 拆成两格」这类真实脏数据抹掉，测试就变成了自说自话。
- 中文书签的 `(level, title, page)` 三元组照抄 `doc.get_toc()` 的输出。
- 两条端到端用例走真 PDF，文件不在时 `skipif`（CI 上不一定有资源库）。

## 一条必须守住的失败行为

`parse_book` 解析不出来时**必须抛 `TocParseError` 并带未解析行**，不许返回
空树。票 02 的教训：静默丢页/丢节点比报错危害大得多 —— 报错会有人修，静默
丢数据只会变成「这本书怎么只有 40 个知识点」的疑问。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from toc_books import (  # noqa: E402
    BookTocEntry,
    TocParseError,
    _assign_numbers_from_levels,
    _build_tree,
    _parse_numeric,
    _parse_outline_levels,
    _repair_pages,
    _Raw,
    is_answer_appendix_title,
    is_answer_key,
    is_appendix,
    parse_book,
)

ROOT = Path(__file__).resolve().parents[2]
BOOKS = ROOT / '资源库' / 'books'


# ---------------------------------------------------------------------------
# 版式 A：点线引导单行（08 Tsoulfanidis / 14 Rivetti / 15 Lutz 的一部分）
# ---------------------------------------------------------------------------
# 行逐字取自 08 Tsoulfanidis 4e 的目录页（`_collect_rows` 输出，已聚行）。
_ROWS_DOT_LEADER = [
    ['Contents'],
    ['Preface to the First Edition. . . . . . . . . . . . . . . . . . . . . . xix'],
    ['Chapter 1.', 'Introduction to Radiation Measurements. . . . . . . . . . 1'],
    ['1.1', 'What Is Meant by Radiation?. . . . . . . . . . . . . . . . . . 1'],
    ['1.2', 'Statistical Nature of Radiation Emission. . . . . . . . . 2'],
    ['1.3', 'Errors and Accuracy and Precision of Measurements . . . 2'],
    ['1.4', 'Types of Errors . . . . . . . . . . . . . . . . . . . . . . . . . . . . 4'],
    ['Chapter 2.', 'Errors of Radiation Counting. . . . . . . . . . . . . . . . . 15'],
    ['2.1', 'Probability Distributions. . . . . . . . . . . . . . . . . . . . . 20'],
]


class TestLayoutDotLeader:
    """版式 A：`编号 标题. . . . 页码` 同一行，章标记可能是独立一格。"""

    def test_parses_numbered_entries_and_drops_front_matter(self):
        entries, report = _parse_numeric(_ROWS_DOT_LEADER)
        assert report.layout == 'numeric'
        # `Contents` 与 `Preface ... xix` 是前置内容，不该进知识点树
        assert report.skipped_front == 2
        assert [(e.num, e.title, e.page) for e in entries] == [
            ('1', 'Introduction to Radiation Measurements', 1),
            ('1.1', 'What Is Meant by Radiation?', 1),
            ('1.2', 'Statistical Nature of Radiation Emission', 2),
            ('1.3', 'Errors and Accuracy and Precision of Measurements', 2),
            ('1.4', 'Types of Errors', 4),
            ('2', 'Errors of Radiation Counting', 15),
            ('2.1', 'Probability Distributions', 20),
        ]

    def test_tree_puts_sections_under_their_chapter(self):
        entries, _ = _parse_numeric(_ROWS_DOT_LEADER)
        tree = _build_tree([(e.num, e.title, e.page) for e in entries])
        assert [n.num for n in tree] == ['1', '2']
        assert [c.num for c in tree[0].children] == ['1.1', '1.2', '1.3', '1.4']
        assert [c.num for c in tree[1].children] == ['2.1']


# ---------------------------------------------------------------------------
# 版式 B：编号独占一行（09 Grupen / 13 Nakhostin / 16 Nicholson）
# ---------------------------------------------------------------------------
# 行逐字取自 09 Grupen 2e 的目录页。这一版式里编号、标题、页码各占一格。
_ROWS_NUMBER_ALONE = [
    ['Contents'],
    ['Preface to the second edition', 'page xiii'],
    ['1', 'Interactions of particles and radiation with matter', '1'],
    ['1.1', 'Interactions of charged particles', '2'],
    ['1.1.1', 'Energy loss by ionisation and excitation', '3'],
    ['1.1.2', 'Channelling', '12'],
    ['1.2', 'Interactions of photons', '25'],
    ['2', 'Passage of particles through matter', '40'],
    ['2.1', 'Scattering', '41'],
]


class TestLayoutNumberAlone:
    """版式 B：三行一组 `编号` / `标题` / `页码`，聚行之后就是三个格。"""

    def test_parses_all_three_levels(self):
        entries, report = _parse_numeric(_ROWS_NUMBER_ALONE)
        assert report.layout == 'numeric'
        assert [(e.num, e.title, e.page) for e in entries] == [
            ('1', 'Interactions of particles and radiation with matter', 1),
            ('1.1', 'Interactions of charged particles', 2),
            ('1.1.1', 'Energy loss by ionisation and excitation', 3),
            ('1.1.2', 'Channelling', 12),
            ('1.2', 'Interactions of photons', 25),
            ('2', 'Passage of particles through matter', 40),
            ('2.1', 'Scattering', 41),
        ]

    def test_deep_tree_keeps_three_levels(self):
        entries, _ = _parse_numeric(_ROWS_NUMBER_ALONE)
        tree = _build_tree([(e.num, e.title, e.page) for e in entries])
        assert [n.num for n in tree] == ['1', '2']
        assert [c.num for c in tree[0].children] == ['1.1', '1.2']
        assert [g.num for g in tree[0].children[0].children] == ['1.1.1', '1.1.2']


# ---------------------------------------------------------------------------
# 版式 C：`CHAPTER n` + 全大写标题 + 罗马小节（03 Knoll 3e / 04 Knoll 4e）
# ---------------------------------------------------------------------------
# 行逐字取自 03 Knoll 3rd 的目录页。注意三处真实 OCR 损伤：
#   - `'1 04'` / `'1 05'` / `'1 1'`：页码被拆成两格（`_CELL_PAGE_SPLIT`）；
#   - `'III'` 那条的页码是 `'1'`（真值 19），OCR 只留下首位；
#   - 章标题跨行：`INTERACTION OF HEAVY CHARGED` / `PARTICLES` 两行。
_ROWS_CHAPTER_ROMAN = [
    ['CONTENTS'],
    ['SECTION A', 'INTRODUCTION'],
    ['CHAPTER 1', 'RADIATION SOURCES', '3'],
    ['I', 'UNITS AND DEFINITIONS', '4'],
    ['II', 'FAST ELECTRON SOURCES', '6'],
    ['III', 'HEAVY CHARGED PARTICLE SOURCES', '1'],
    ['IV', 'SOURCES OF ELECTROMAGNETIC RADIATION', '1'],
    ['V', 'NEUTRON SOURCES', '26'],
    ['CHAPTER 2', 'RADIATION INTERACTIONS', '39'],
    ['I', 'INTERACTION OF HEAVY CHARGED'],
    ['PARTICLES', '40'],
    ['II', 'INTERACTION OF FAST ELECTRONS', '56'],
    ['III', 'INTERACTION OF GAMMA RAYS', '62'],
    ['CHAPTER 3', 'GENERAL PROPERTIES OF RADIATION DETECTORS', '79'],
    ['I', 'SIMPLIFIED DETECTOR MODEL', '79'],
    ['II', 'CURRENT AND PULSE MODES OF OPERATION', '80'],
    ['CHAPTER 4', 'COUNTING STATISTICS AND ERROR PREDICTION', '1 04'],
    ['I', 'CHARACTERIZATION OF DATA', '1 05'],
]


class TestLayoutChapterRoman:
    """版式 C：章号靠 `CHAPTER n` 递增，小节号靠罗马标记的出现次序。"""

    def test_chapters_are_numbered_by_increment_not_literal(self):
        entries, _ = _parse_numeric(_ROWS_CHAPTER_ROMAN)
        chapters = [e for e in entries if e.num and '.' not in e.num]
        assert [e.num for e in chapters] == ['1', '2', '3', '4']
        # 章标题跨行时被拼回一条，而不是拆成两个节点
        assert chapters[1].title == 'RADIATION INTERACTIONS'

    def test_roman_sections_are_numbered_by_order(self):
        entries, _ = _parse_numeric(_ROWS_CHAPTER_ROMAN)
        under_1 = [e.num for e in entries if e.num.startswith('1.')]
        assert under_1 == ['1.1', '1.2', '1.3', '1.4', '1.5']
        under_2 = [e.num for e in entries if e.num.startswith('2.')]
        assert under_2 == ['2.1', '2.2', '2.3']

    def test_split_page_number_is_rejoined(self):
        """`1 04` 是 104 页被 OCR 拆成两格，不是第 1 页。"""
        entries, _ = _parse_numeric(_ROWS_CHAPTER_ROMAN)
        chapter_4 = next(e for e in entries if e.num == '4')
        assert chapter_4.page == 104
        first_section = next(e for e in entries if e.num == '4.1')
        assert first_section.page == 105

    def test_section_marker_is_stripped_from_titles(self):
        entries, _ = _parse_numeric(_ROWS_CHAPTER_ROMAN)
        assert all(not e.title.startswith(('I ', 'II ', 'III ', 'IV ', 'V ')) for e in entries)

    def test_tree_has_exactly_the_chapters_as_roots(self):
        entries, _ = _parse_numeric(_ROWS_CHAPTER_ROMAN)
        tree = _build_tree([(e.num, e.title, e.page) for e in entries])
        assert [n.num for n in tree] == ['1', '2', '3', '4']
        assert all(n.depth == 1 for n in tree)
        assert sum(len(n.children) for n in tree) == 5 + 3 + 2 + 1


class TestPageRepair:
    """目录页码的两类 OCR 损伤：离群点与递减。"""

    def test_outlier_is_replaced_by_neighbour_median(self):
        """04 Knoll 4th 的 `829)` 真值 329：**只换那一条**，不动它的邻居。

        邻居取前后各 `window` 条的中位数，所以夹具必须让离群点两侧都有足够
        的近邻 —— 只有 3 条样本时中位数会被离群点自己带偏，那是夹具的问题
        不是算法的。这里用 8 条、页距 2，离群点放中间。
        """
        entries = [
            _Raw('1', 'A', 10),
            _Raw('2', 'B', 12),
            _Raw('3', 'C', 14),
            _Raw('4', 'D', 829),  # 真值 329，OCR 认错首位
            _Raw('5', 'E', 18),
            _Raw('6', 'F', 20),
            _Raw('7', 'G', 22),
            _Raw('8', 'H', 24),
        ]
        repaired = _repair_pages(entries)
        assert repaired == 1
        assert [e.page for e in entries] == [10, 12, 14, 18, 18, 20, 22, 24]

    def test_decreasing_page_is_levelled_not_dropped(self):
        """递减条目拉平到前一条，**不丢** —— 丢了这节的正文会挂到上一节。"""
        entries = [_Raw('1', 'A', 10), _Raw('2', 'B', 20), _Raw('3', 'C', 12)]
        _repair_pages(entries)
        assert [e.page for e in entries] == [10, 20, 20]
        assert len(entries) == 3


# ---------------------------------------------------------------------------
# 中文书签（26 郭江 2023 / 27 郭江 2014）
# ---------------------------------------------------------------------------
# 三元组逐字取自 `doc.get_toc()`。level 1 是 `目录` 本身，level 2 里混着
# `封面` / `内容简介` / `前言`，level 2 的 `第1篇` 是比章高一层的容器。
_ZH_OUTLINE = [
    (1, '目录', 6),
    (2, '前言', 4),
    (2, '绪论', 10),
    (2, '第1篇原子物理', 12),
    (3, '第1章原子的核式结构及氢原子的玻尔理论', 13),
    (4, '1.1原子的基本状况', 13),
    (4, '*1.2原子的核式结构', 15),
    (4, '1.5氢原子的玻尔理论', 29),
    (3, '第2章量子力学初步', 41),
    (4, '*2.1波粒二象性德布罗意物质波', 41),
    (4, '2.4量子力学对氢原子的处理', 53),
]


class _FakeDoc:
    """只提供 `get_toc`，够 `_parse_outline_levels` 用。"""

    def __init__(self, toc):
        self._toc = toc

    def get_toc(self, simple=True):  # noqa: ARG002 —— 照 pymupdf 的签名
        return self._toc


class TestChineseOutline:
    """中文书签：滤前置内容、压平「篇」、层级归一化。"""

    def test_front_matter_and_part_layer_are_removed(self):
        levels = _parse_outline_levels(_FakeDoc(_ZH_OUTLINE))
        titles = [t for _lvl, t, _p in levels]
        assert '目录' not in titles
        assert '前言' not in titles
        assert '第1篇原子物理' not in titles
        assert titles[:2] == [
            '第1章原子的核式结构及氢原子的玻尔理论',
            '1.1原子的基本状况',
        ]

    def test_levels_become_contiguous_from_one(self):
        """篇压平后剩下的层级是 `3,4`，必须映射成 `1,2` 才不会摊出 `1.0.1`。"""
        levels = _parse_outline_levels(_FakeDoc(_ZH_OUTLINE))
        assert {lvl for lvl, _t, _p in levels} == {1, 2}

    def test_numbers_are_assigned_by_level_counter(self):
        levels = _parse_outline_levels(_FakeDoc(_ZH_OUTLINE))
        entries = _assign_numbers_from_levels(levels)
        assert [(e.num, e.page) for e in entries] == [
            ('1', 12),
            ('1.1', 12),
            ('1.2', 14),
            ('1.3', 28),
            ('2', 40),
            ('2.1', 40),
            ('2.2', 52),
        ]

    def test_tree_has_chapters_as_roots(self):
        levels = _parse_outline_levels(_FakeDoc(_ZH_OUTLINE))
        entries = _assign_numbers_from_levels(levels)
        tree = _build_tree([(e.num, e.title, e.page) for e in entries])
        assert [n.num for n in tree] == ['1', '2']
        assert all(n.depth == 1 for n in tree)
        assert [c.num for c in tree[0].children] == ['1.1', '1.2', '1.3']

    def test_page_is_zero_based_pdf_index(self):
        """书签给的是 1 起 PDF 页，统一换成 0 起，与 `printed = pdf - offset` 同口径。"""
        levels = _parse_outline_levels(_FakeDoc(_ZH_OUTLINE))
        first = next(t for t in levels if t[0] == 1)
        assert first[2] == 12  # 书签 13 → 0 起 12


# ---------------------------------------------------------------------------
# 附件 / 答案块口径
# ---------------------------------------------------------------------------
class TestAppendixRules:
    """中英两套口径必须都能认：英文正则 + `toc.py` 的中文词表。"""

    @pytest.mark.parametrize(
        'title',
        ['Index', 'References', 'Bibliography', 'Appendix A', 'Problems', 'Further Reading'],
    )
    def test_english_appendix_titles(self, title):
        assert is_appendix(title)

    @pytest.mark.parametrize('title', ['习题', '思考题', '参考文献', '索引', '附录', '小结'])
    def test_chinese_appendix_titles(self, title):
        assert is_appendix(title)

    @pytest.mark.parametrize('title', ['Solutions to Problems', 'Answers to Exercises'])
    def test_english_answer_keys(self, title):
        assert is_answer_key(title)

    @pytest.mark.parametrize('title', ['部分习题答案', '习题解答', '思考题解答'])
    def test_chinese_answer_keys(self, title):
        assert is_answer_key(title)

    def test_a_normal_chapter_is_not_an_appendix(self):
        assert not is_appendix('RADIATION SOURCES')
        assert not is_appendix('第1章原子的核式结构')
        assert not is_answer_key('RADIATION SOURCES')


# ---------------------------------------------------------------------------
# 答案附录的整名判据（t38）
# ---------------------------------------------------------------------------
class TestAnswerAppendixTitle:
    """`is_answer_appendix_title(name, nameOriginal)` —— 15 本英文书的答案附录识别。

    背景：`is_answer_key_title()` 只认中文（而且要求标题先被判成附件），
    `is_en_answer_key()` 只认 `answers to problems` 这种完整写法 —— 两个都
    认不出 09 Grupen 的 `Solutions`（章 18，p533，正文是第 1–16 章习题解答），
    也认不出 27 郭江 2014 的「习题参考答案」（不在 `toc._APPENDIX_EXACT` 词表里，
    所以一直是个 `isLeaf=true` 的可学知识点，正文就是整本答案）。

    最容易做假的地方是「用包含判据」：15 本英文书里有大量正文小节的名字带
    `problems`/`exercises`，`'problems' in title` 会把 17 Gilmore 的
    `Electronic timing problems`（p160，可学知识点）一起降级。所以下面第
    二组反例和第一组正例一样重要。
    """

    @pytest.mark.parametrize(
        'title',
        [
            'Answers to Problems',
            'Solutions to Exercises',
            'Appendix A: Answers',
            'Answer Key',
            'Selected Solutions',
            'Appendix: Answers',
            'Solutions',
        ],
    )
    def test_english_answer_appendix_titles(self, title):
        assert is_answer_appendix_title(title, title)

    @pytest.mark.parametrize(
        'title',
        [
            # 17 Gilmore：名字带 problems/exercises 但是正文小节
            'Electronic timing problems',
            'Assessment of intercomparison exercises',
            'Intercomparison exercises',
            # 15 Lutz：`Solution` 出现在正文标题里，但不是答案附录
            'Numerical Solution of Stationary Situations',
            # 普通小节
            'Problems in Detector Design',
            '习题的评估',
            '电子学定时习题',
            # 正文小节而非整本答案
            '答案要点',
            # 附件但不是答案
            'Index',
            'References',
            '习题',
        ],
    )
    def test_body_sections_are_not_answer_appendices(self, title):
        assert not is_answer_appendix_title(title, title)

    @pytest.mark.parametrize(
        'title',
        ['部分习题答案', '部分自测题和习题答案', '部分习题答案（上册）', '习题参考答案'],
    )
    def test_chinese_answer_appendix_titles(self, title):
        """中文判据：复用 `toc.is_answer_key_title`，再补「学科词 + 答案收尾」一条。

        **刻意不列光杆的「解答」「答案」「题解」**：`toc._APPENDIX_EXACT`
        里没有它们（只有 `题解`/`习题解答`/`思考题解答` 这些带学科词的写法），
        中文书里一个孤零零的「解答」不被当成附件。09 Grupen 那个节点的**译名**
        是「解答」、**原名**是 `Solutions` —— 那是英文支命中的，不是中文支。
        把光杆词加进来会让任何叫「解答」的正文小节被误降级。
        """
        assert is_answer_appendix_title(title, title)

    def test_original_english_title_is_what_english_rule_reads(self):
        """英文判据必须看 `nameOriginal`，不能只看译名。

        `Solutions` 译成「解答」之后，光看译名认不出原文是答案附录；反过来，
        译名「解答」单独拿出来也认不出它是哪门课的答案 —— 两个入参各归各位。
        """
        assert is_answer_appendix_title('解答', 'Solutions')
        # 反例：译名是正文小节，原名也是正文小节
        assert not is_answer_appendix_title('习题的评估', 'Assessment of intercomparison exercises')
        # 反例：只有译名像答案、原名是正文 —— 不许靠译名蒙
        assert not is_answer_appendix_title('解答', 'Numerical Solution of Stationary Situations')

    def test_answer_appendix_is_also_an_appendix(self):
        """答案附录必须同时是章节附件。

        这一条不是冗余：`assign.leaf_page_ranges()` 的所有者是
        `n['isLeaf'] or n.get('appendix')` —— 只标 `answerKey` 不标 `appendix`
        的话，答案附录的页会被上一个叶子按页区间吞成正文（09 Grupen 的
        p533–576 现在全挂在「术语表」名下）。
        """
        for title in ('Solutions', '习题参考答案', 'Answers to Problems'):
            assert is_appendix(title) or is_answer_appendix_title(title, title)


# ---------------------------------------------------------------------------
# 失败必须抛错（票 02 的教训）
# ---------------------------------------------------------------------------
class TestFailureIsLoud:
    """解析不出来时抛 `TocParseError` 并带未解析行 —— 不许返回空树。"""

    def test_prose_pages_raise_instead_of_returning_empty_tree(self, tmp_path):
        pymupdf = pytest.importorskip('pymupdf')
        doc = pymupdf.open()
        for _ in range(3):
            page = doc.new_page()
            page.insert_text(
                (72, 100),
                'This is an ordinary body paragraph with no table of contents '
                'whatsoever, and it keeps going for a while so the parser has '
                'plenty of lines to look at and reject.',
            )
        pdf = tmp_path / 'prose.pdf'
        doc.save(str(pdf))
        doc.close()

        with pytest.raises(TocParseError) as info:
            parse_book(str(pdf), source_id='prose-book', toc_pages=(0, 3))
        message = str(info.value)
        assert 'prose-book' in message
        assert '目录' in message
        # 必须把看到的行打出来，否则修规则的人不知道错在哪
        assert 'ordinary body paragraph' in message

    def test_missing_source_id_is_rejected(self, tmp_path):
        """`source_id` 是知识点 id 的命名空间，缺了会跨书撞号（历史事故 49% 覆盖）。"""
        pymupdf = pytest.importorskip('pymupdf')
        doc = pymupdf.open()
        doc.new_page().insert_text((72, 100), 'x')
        pdf = tmp_path / 'empty.pdf'
        doc.save(str(pdf))
        doc.close()
        with pytest.raises(ValueError, match='source_id'):
            parse_book(str(pdf), source_id='', toc_pages=(0, 1))


# ---------------------------------------------------------------------------
# 端到端：真 PDF（资源库不在时跳过）
# ---------------------------------------------------------------------------
def _book(prefix: str) -> str:
    """按 `NN_` 前缀找 PDF（文件名里中英文混排，书名不可靠）。"""
    matches = sorted(BOOKS.glob(prefix + '_*.pdf'))
    return str(matches[0]) if matches else ''


@pytest.mark.skipif(not _book('13'), reason='资源库里没有 13 Nakhostin')
def test_nakhostin_parses_number_alone_layout():
    """13 Nakhostin 是版式 B 的代表：10 章、50+ 叶节点、页码连续。"""
    tree = parse_book(_book('13'), source_id='nakhostin-2018', toc_pages=(5, 8))
    chapters = [n for n in tree if n.depth == 1]
    assert 8 <= len(chapters) <= 12
    assert chapters[0].title == 'Signal Generation in Radiation Detectors'
    assert chapters[0].name_original == 'Signal Generation in Radiation Detectors'
    # 每章都该有子节，不能是「章节点 0 个」那种空壳
    assert all(n.children for n in chapters)


@pytest.mark.skipif(not _book('26'), reason='资源库里没有 26 郭江')
def test_guojiang_2023_outline_becomes_chapters():
    """26 郭江走中文书签：`目录` 不能当根，模块名必须是章。"""
    tree = parse_book(_book('26'), source_id='guojiang-2023', toc_pages=(5, 8))
    assert tree, '解析结果不能为空'
    assert all(n.depth == 1 for n in tree)
    assert all('目录' not in n.title for n in tree)
    assert all('篇' not in n.title for n in tree)
    assert any(n.title.startswith('第1章') for n in tree)


@pytest.mark.skipif(not _book('09'), reason='资源库里没有 09 Grupen')
def test_grupen_parses_without_duplicate_numbers():
    """同一本书里编号唯一 —— 重复编号会让 `flatten` 追加 `-2` 后缀，id 变脏。"""
    tree = parse_book(_book('09'), source_id='grupen-2e-2008', toc_pages=(8, 14))
    numbers = []

    def walk(nodes):
        for node in nodes:
            if node.num:
                numbers.append(node.num)
            walk(node.children)

    walk(tree)
    assert len(numbers) == len(set(numbers)), '目录编号重复'
    assert all(isinstance(n, BookTocEntry) for n in tree)
