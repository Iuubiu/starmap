"""导出论文标题与章节名，供 `translate_titles.mjs` 批量翻译。

用法：

    python tools/papers/export_titles.py --out .scratch/paper-titles.json

输出形状与 `tools/ingest/translate_titles.mjs` 的输入一致：

    {"<sourceId>": ["论文标题", "章节名 1", "章节名 2", ...]}

## 为什么章节名要先清洗

PDF 抽出来的章节名有大量残句。实测样例：

    `Results for Different Scintillators and`     ← 结尾悬空连词
    `INCH COUNTER`                                 ← 被版面切断的 `3-INCH COUNTER`
    `Quantitative Measurements of Proton-Electron` ← 断在连字符处

直接译会得到「用于不同闪烁体与的结果」这种垃圾。清洗规则在
`clean_section_title()` 里，每一步都写清了为什么。

## 为什么降级命名不在这里做

清洗后仍不成句的（单词数 < 2 或长度 < 4），本脚本只**标记** `degraded: true`
并给出 `sectionOrdinal`，真正的中文名由 `ingest_papers.py` 用
「第 N 节 · <首个实词的中文>」生成 —— 那里才有翻译器与译名词典。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ingest_papers import PAPERS_DIR, parse_readme, build_records  # noqa: E402

# 结尾悬空的虚词 —— PDF 版面把标题切在词中间时，最后剩的常是这些。
TRAILING_STOPWORDS = {
    "and", "or", "of", "the", "a", "an", "in", "on", "at", "to", "for", "with",
    "by", "from", "as", "is", "are", "was", "were", "be", "been", "that", "which",
    "this", "these", "those", "its", "their", "our", "we", "it",
}

LEAD_NOISE = re.compile(r"^[\s.,;:·\-—–|]+")
TRAIL_NOISE = re.compile(r"[\s.,;:·\-—–|]+$")
LEAD_NUMBER = re.compile(r"^(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.)\s+")


def clean_section_title(raw: str) -> tuple[str, bool]:
    """清洗一条章节名。返回 `(文本, 是否降级)`。

    规则（从最安全到最激进）：

    1. 压空白、去首尾标点与编号前缀。
    2. **去结尾悬空虚词**：`... Scintillators and` → `... Scintillators`。
       这是最常见的一种 —— PDF 把标题切在 `and` 后面。
    3. **全大写转 Title Case**：`INCH COUNTER` → `Inch Counter`。
       全大写是排版效果不是语义，而且翻译器的术语表是小写的，全大写匹配率更低。
       保留 ≤4 字符的缩写（GEM / CMS / TPC / LHC）。
    4. 单词数 < 2 且字母数 < 6 → 标记降级（`INCH COUNTER` 洗完是 2 词，不算；
       但 `obtainabl`、`hysic` 这种断词算）。
    """
    text = re.sub(r"\s+", " ", str(raw or "")).strip()
    text = TRAIL_NOISE.sub("", LEAD_NOISE.sub("", text))
    text = LEAD_NUMBER.sub("", text)

    degraded = False
    while True:
        words = text.split(" ")
        if len(words) <= 1:
            break
        last = re.sub(r"[^a-z]", "", words[-1].lower())
        if last not in TRAILING_STOPWORDS:
            break
        text = " ".join(words[:-1])
        degraded = True

    letters = re.sub(r"[^A-Za-z]", "", text)
    if len(letters) > 3 and letters == letters.upper():
        text = " ".join(
            w.upper() if (len(w) <= 4 and w == w.upper()) else w[:1].upper() + w[1:].lower()
            for w in text.lower().split(" ")
        )

    if len(text.split(" ")) < 2 and len(re.sub(r"[^A-Za-z]", "", text)) < 6:
        degraded = True

    return text, degraded


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="导出论文标题与章节名（供批量翻译）")
    parser.add_argument("--out", default=".scratch/paper-titles.json")
    parser.add_argument("--papers-dir", default=str(PAPERS_DIR))
    args = parser.parse_args(argv)

    records = build_records(parse_readme(Path(args.papers_dir) / "README.md"), Path(args.papers_dir))

    payload: dict[str, list[str]] = {}
    meta: dict[str, list[dict]] = {}
    total_sections = 0
    degraded_count = 0

    for rec in records:
        titles = [rec.title]
        sections = []
        for sec in rec.sections:
            cleaned, degraded = clean_section_title(sec.name)
            titles.append(cleaned)
            sections.append(
                {
                    "id": sec.id,
                    "original": sec.name,
                    "cleaned": cleaned,
                    "degraded": degraded,
                    "ordinal": sec.ordinal,
                    "isLeaf": sec.isLeaf,
                }
            )
            total_sections += 1
            if degraded:
                degraded_count += 1
        payload[rec.sourceId] = titles
        meta[rec.sourceId] = sections

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    meta_path = out.with_name(out.stem + "-meta.json")
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    unique = {t for titles in payload.values() for t in titles}
    print(f"论文 {len(records)} 篇 / 章节 {total_sections} 条 / 去重后 {len(unique)} 条待译")
    print(f"降级命名候选：{degraded_count} 条")
    print(f"写出 {out} 与 {meta_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
