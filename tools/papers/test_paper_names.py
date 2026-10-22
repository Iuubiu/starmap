"""论文入图的命名不变量（票 18 前半 / D10 红线）。

## 为什么这些测试在 `tools/papers/` 下单独一个文件

`tools/ingest/test_content_artifacts.py` 守的是**产物**（`content/*/toc.json`），
而这里守的是**论文这一批入库结果**。两者的失败方式不同：那边是「产物没重出」，
这边是「节点名退化成英文/残句」—— 后者在图上表现为一串读不懂的拉丁字母，
在 UI 上是 D10 红线（「知识点名均中文」）的直接违反。

## 两类测试

1. **纯函数**（不需要数据库）：`_strip_dangling_tail` / `_is_running_text_fragment`
   / `_is_measurement_fragment` 的判据边界。这些是拦在入口的规则，改错一个
   字符就会放行一批正文碎片，所以用具体反例钉住。
2. **库内不变量**（需要数据库）：`source_id LIKE 'paper-%'` 的节点名不得是
   纯 ASCII，模块名同理，奠基性论文必须 14 篇。没有数据库时 skip —— 不让
   「本机没起 PG」把整包测试弄红，但一旦连得上就必须成立。

## 反向验证（captain 要求）

`test_paper_kp_names_are_not_ascii` 必须能反向验证：把任一节点名改回英文后
它要变红。验证方式见文件末尾 `if __name__ == "__main__"` 的手工步骤说明。
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "ingest"))

import ingest_papers as ip  # noqa: E402

ASCII_ONLY = re.compile(r"^[\x00-\x7f]+$")
HANZI = re.compile(r"[\u4e00-\u9fff]")

DEFAULT_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:5432/starmap"
FOUNDATIONAL_EXPECTED = 14


# --------------------------------------------------------------------------
# 1. 纯函数：译名残渣与正文碎片
# --------------------------------------------------------------------------


class TestMergeSmallCaps:
    """`merge_small_caps` —— PDF 小型大写字母排版伪影。

    这个函数的风险不对称：漏合并只是浪费一条可读的章节名，误合并会把真标题
    改成不存在的词。所以两条判据都按「宁可漏合并」设计，测试也围绕这条。
    """

    KNOWN = {"introduction", "architecture", "results", "conclusion", "test", "enhancement"}

    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("I. I NTRODUCTION", "I. INTRODUCTION"),
            ("II. A RCHITECTURE", "II. ARCHITECTURE"),
            # 两处以上伪影：无条件合并，不需要词表命中
            ("V. E NHANCEMENT OF G EANT 4 I NTERACTIVE C APABILITIES", "V. ENHANCEMENT OF GEANT 4 INTERACTIVE CAPABILITIES"),
        ],
    )
    def test_merges_artifacts(self, raw: str, expected: str) -> None:
        assert ip.merge_small_caps(raw, known=lambda w: w in self.KNOWN) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            # 单个 `A` 开头的真标题：只有一处伪影形状，词表里也没有 `ahopping`
            "A HOPPING DISTANCE",
            "OPERATION IN A MAGNETIC FIELD",
            # 被版面切断的真标题，`INH` 不在词表里
            "IN(H COUNTER",
        ],
    )
    def test_keeps_real_titles(self, raw: str) -> None:
        assert ip.merge_small_caps(raw, known=lambda w: w in self.KNOWN) == raw

    def test_single_artifact_needs_glossary_hit(self) -> None:
        # 只有一处伪影，但 `ntroduction` 在词表里 → 合
        assert ip.merge_small_caps("I. I NTRODUCTION", known=lambda w: w in {"introduction"}) == (
            "I. INTRODUCTION"
        )
        # 同一串，词表里没有 → 不合
        assert ip.merge_small_caps("I. I NTRODUCTION", known=lambda w: False) == "I. I NTRODUCTION"

    def test_empty_and_plain(self) -> None:
        assert ip.merge_small_caps("") == ""
        assert ip.merge_small_caps("Introduction") == "Introduction"


class TestStripDanglingTail:
    """`_strip_dangling_tail` —— 去掉中文译名末尾的连词/介词。"""

    def test_removes_and_at_tail(self) -> None:
        assert ip._strip_dangling_tail("高亮度插入件与") == "高亮度插入件"

    def test_removes_multiple_tails(self) -> None:
        assert ip._strip_dangling_tail("径迹测量与的") == "径迹测量"

    def test_keeps_legit_name(self) -> None:
        assert ip._strip_dangling_tail("气体探测器") == "气体探测器"

    def test_keeps_inner_conjunction(self) -> None:
        # 只截尾部，中间的「与」是合法连接词
        assert ip._strip_dangling_tail("硅径迹探测器与 MAPS") == "硅径迹探测器与 MAPS"

    def test_empty_input(self) -> None:
        assert ip._strip_dangling_tail("") == ""

    def test_all_tail_returns_empty(self) -> None:
        # 全是虚词说明整条是残渣，返回空串让调用方走降级命名
        assert ip._strip_dangling_tail("与和") == ""


class TestIsRunningTextFragment:
    """`_is_running_text_fragment` —— 句中句号 / 参考文献条目。"""

    @pytest.mark.parametrize(
        "name",
        [
            # 实测被抽出来的正文碎片（BABAR / Abazov / Bramblett）
            "October 1989 event. This “worst-week” model formally",
            "Attention must be given to the last wires. Suc-",
            "TeV/nucleon. However, validation of this application is still",
            # 注意：`MeV. At sea level` 不在这里 —— 它由「以能量单位开头」那条判据
            # （`_is_measurement_fragment`）拦下，见 TestIsMeasurementFragment。
            # 两个类的反例要各归各家，否则某天后者被改坏，会显得像前者坏了。
            # 参考文献条目
            "J. Seeman et al., Status Report on PEP-II",
            "S. Agostinelli et al., Geant4: A simulation toolkit, Nucl. Instr",
            "M. Sullivan, B-Factory Interaction Region",
        ],
    )
    def test_rejects_fragments(self, name: str) -> None:
        assert ip._is_running_text_fragment(name) is True

    @pytest.mark.parametrize(
        "name",
        [
            # 罗马数字 + 句号不是句中断句
            "I. Microgrid",
            # 真标题：有逗号但不是参考文献形态
            "Requirements, performance and production",
            "Performance requirements and design choices",
            "Module Control Chip (MCC)",
            # 单个缩写开头的真标题
            "GEM: A new concept for electron amplification in gas detectors",
        ],
    )
    def test_keeps_titles(self, name: str) -> None:
        assert ip._is_running_text_fragment(name) is False

    def test_empty(self) -> None:
        assert ip._is_running_text_fragment("") is False


class TestIsMeasurementFragment:
    """`_is_measurement_fragment` —— 数值 + 单位。"""

    @pytest.mark.parametrize(
        "name",
        ["MeV at Ed = 2.17 MeV", "MeV. At sea level", "2.3 ADC counts", "0.2 MeV"],
    )
    def test_rejects_measurements(self, name: str) -> None:
        assert ip._is_measurement_fragment(name) is True

    @pytest.mark.parametrize(
        "name",
        ["System overview", "Front-end chip history", "Data Acquisition System"],
    )
    def test_keeps_titles(self, name: str) -> None:
        assert ip._is_measurement_fragment(name) is False


class TestSectionNameQuality:
    """`translate_section_name` 的输出形状：至少 2 个汉字，或明确的降级命名。"""

    @pytest.mark.parametrize(
        "english",
        [
            "High luminosity insertions (IR1 and IR5)",
            "Tracker Inner Barrel and Disks (TIB/TID)",
            "Data Acquisition System",
            "Requirements, performance and production",
        ],
    )
    def test_translated_names_have_hanzi(self, english: str) -> None:
        from ingest_papers import SectionRecord

        sec = SectionRecord(
            id="x-1", name=english, depth=1, ordinal=1, isLeaf=True, startPage=1, parentId="x"
        )
        got = ip.translate_section_name(sec, 1)
        assert HANZI.search(got), f"{english!r} 译成 {got!r}，一个汉字都没有"
        if not got.startswith("第 "):
            # 「至少 2 个汉字」是旧规则，会误杀「GEM 室」「ROOT树」这类
            # 以拉丁缩写开头的真名字。现在的判据是 `_looks_like_name`：
            # 2 个汉字，或 1 个汉字 + 一个拉丁缩写。
            assert ip._looks_like_name(got), f"{english!r} 译成 {got!r}，不像个名字"

    @pytest.mark.parametrize(
        "english,expected",
        [
            ("GEM chambers", "GEM 室"),
            ("The ROOT Trees", "ROOT树"),
            ("The TObject class", "TObject类"),
        ],
    )
    def test_latin_abbreviation_names_are_kept(self, english: str, expected: str) -> None:
        """以拉丁缩写开头的真名字不该被推去降级命名。

        这三个词都是中文技术文献里的常见写法，术语信息全在缩写上。
        旧规则「至少 2 个汉字」会把它们全推去「第 N 节 · 原文见摘要」。
        """
        from ingest_papers import SectionRecord

        sec = SectionRecord(
            id="x-1", name=english, depth=1, ordinal=1, isLeaf=True, startPage=1, parentId="x"
        )
        assert ip.translate_section_name(sec, 1) == expected

    @pytest.mark.parametrize("name", ["点", "阈", "室", ""])
    def test_rejects_bare_hanzi_names(self, name: str) -> None:
        """单汉字/无意义的译名仍然不算名字。

        注：`MEV在`（来自 `MeV at Ed =`）**不在**这里测，因为它根本到不了
        `_looks_like_name` —— `_is_measurement_fragment` 已经把原文挡住了。
        这一层只负责「已经译出来的串像不像个名字」，不负责挡噪声。
        """
        assert ip._looks_like_name(name) is False

    def test_measurement_fragments_never_reach_name_check(self) -> None:
        """噪声靠上一道门挡，不靠 `_looks_like_name`。"""
        assert ip._is_measurement_fragment("MeV at Ed =") is True

    @pytest.mark.parametrize("name", ["GEM 室", "ROOT树", "点估计", "可编程逻辑控制器"])
    def test_accepts_meaningful_names(self, name: str) -> None:
        assert ip._looks_like_name(name) is True

    def test_no_dangling_conjunction_in_output(self) -> None:
        from ingest_papers import SectionRecord

        for english in ("Tracking and Scoring", "Data and Methods", "Signal and Noise"):
            sec = SectionRecord(
                id="x-1", name=english, depth=1, ordinal=1, isLeaf=True, startPage=1, parentId="x"
            )
            got = ip.translate_section_name(sec, 1)
            assert not got.endswith(("与", "和", "的", "在", "或", "及")), (
                f"{english!r} 译成 {got!r}，以虚词结尾"
            )


# --------------------------------------------------------------------------
# 2. 库内不变量
# --------------------------------------------------------------------------


def _connect():
    psycopg = pytest.importorskip("psycopg")
    dsn = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    try:
        return psycopg.connect(dsn, options="-c search_path=app,public", connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"连不上数据库（{exc.__class__.__name__}），跳过库内不变量")


def test_paper_kp_names_are_not_ascii() -> None:
    """**D10 红线**：`source_id LIKE 'paper-%'` 的节点名不得是纯 ASCII。

    反向验证步骤（改完必须还原）：

        psql -c "UPDATE app.knowledge_points SET name='Introduction'
                  WHERE id=(SELECT id FROM app.knowledge_points
                             WHERE source_id LIKE 'paper-%' AND is_leaf LIMIT 1)"
        python -m pytest tools/papers/test_paper_names.py::test_paper_kp_names_are_not_ascii
        # → 必须红：assert not bad, ...

    这条测试之所以必要：论文这批是**唯一**从英文 PDF 自动抽名字的入库路径。
    15 本英文书的节点名走 `translate.py` + `names.zh.json`，而论文走的是
    `paper_glossary` 的规则翻译 —— 后者一旦某个术语漏收，译名就会退回英文原词。
    """
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, name FROM knowledge_points WHERE source_id LIKE 'paper-%'"
        ).fetchall()
    finally:
        conn.close()

    assert rows, "库里一个 paper 知识点的没有，说明票 18 前半还没入库"

    bad = [(kid, name) for kid, name in rows if ASCII_ONLY.match(name or "")]
    assert not bad, (
        f"{len(bad)}/{len(rows)} 个论文节点名是纯 ASCII（D10 要求中文）：\n"
        + "\n".join(f"  {kid}: {name!r}" for kid, name in bad[:20])
    )


def test_paper_module_names_are_chinese() -> None:
    """十个主题模块名必须是中文（captain 逐条给定的译名）。"""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, name FROM modules WHERE id LIKE 'mod-paper-%' ORDER BY ordinal"
        ).fetchall()
    finally:
        conn.close()

    assert len(rows) == 10, f"应有 10 个论文主题模块，实际 {len(rows)}"
    bad = [(mid, name) for mid, name in rows if not HANZI.search(name or "")]
    assert not bad, "这些模块名没有汉字：" + repr(bad)


def test_foundational_papers_are_marked() -> None:
    """1980 年（含）以前的论文必须标成奠基性 —— 14 篇，写进 summary 与 meta。"""
    conn = _connect()
    try:
        n_summary = conn.execute(
            "SELECT count(*) FROM knowledge_points "
            "WHERE source_id LIKE 'paper-%' AND depth = 0 AND summary LIKE '奠基性论文%'"
        ).fetchone()[0]
        n_meta = conn.execute(
            "SELECT count(*) FROM sources "
            "WHERE id LIKE 'paper-%' AND (meta->>'foundational')::bool IS TRUE"
        ).fetchone()[0]
    finally:
        conn.close()

    assert n_summary == FOUNDATIONAL_EXPECTED, (
        f"summary 里标「奠基性论文」的应 {FOUNDATIONAL_EXPECTED} 篇，实际 {n_summary}"
    )
    assert n_meta == FOUNDATIONAL_EXPECTED, (
        f"meta.foundational=true 的应 {FOUNDATIONAL_EXPECTED} 篇，实际 {n_meta}"
    )


def test_every_paper_leaf_has_a_chunk() -> None:
    """没有 chunk 的叶节点在检索里永远搜不到 —— 这是「死点」，必须为 0。"""
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT kp.id, kp.name
              FROM knowledge_points kp
             WHERE kp.source_id LIKE 'paper-%'
               AND kp.is_leaf
               AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.micro_kp_id = kp.id)
            """
        ).fetchall()
    finally:
        conn.close()

    assert not rows, f"{len(rows)} 个论文叶节点一个 chunk 都没有：{rows[:10]}"


def test_no_paper_kp_name_ends_with_a_conjunction() -> None:
    """节点名不得以「与/和/的/在/或/及」结尾 —— 那是译名残渣。

    这条是 `_strip_dangling_tail` 的库内镜像：单元测试守函数，这条守**实际
    写进去的 1212 行**。两者都必要，因为写库路径可能绕开函数（比如某次手工
    UPDATE）。
    """
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, name FROM knowledge_points "
            "WHERE source_id LIKE 'paper-%' AND name ~ '[与和的在或及]$'"
        ).fetchall()
    finally:
        conn.close()

    assert not rows, f"{len(rows)} 个节点名以虚词结尾：{rows[:10]}"


# --------------------------------------------------------------------------
# 手工反向验证说明
# --------------------------------------------------------------------------

if __name__ == "__main__":
    print(__doc__)
    print(
        "\n反向验证（会改库，记得还原）：\n"
        "  1. 取一个 paper 叶节点 id：\n"
        "     psql -c \"SELECT id FROM app.knowledge_points "
        "WHERE source_id LIKE 'paper-%' AND is_leaf LIMIT 1\"\n"
        "  2. 改成英文：\n"
        "     psql -c \"UPDATE app.knowledge_points SET name='Introduction' WHERE id='<上面那个>'\"\n"
        "  3. 跑本文件 → test_paper_kp_names_are_not_ascii 必须红\n"
        "  4. 还原：python -X utf8 tools/papers/ingest_papers.py\n"
    )
