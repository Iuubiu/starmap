"""
从 `content/*/toc.json` 导出中英术语对照表（`content/glossary.json`）。

## 为什么这份表可以零成本导出

t26 把 15 本英文教材入库时，`toc_batch.py::translate_nodes()` 把每个英文目录标题
译成中文写进 `name`，**英文原名原样留在 `nameOriginal`**（D10 红线：知识点名必须
是中文，但原文不能丢）。于是每本英文书的 `toc.json` 天然就是一份「中文译名 ↔
英文原名」的对照表，不需要再调一次模型，也不需要人工维护。

## 这份表解决的是什么问题

检索链路（`apps/api/src/retrieval/bm25.ts`）是**纯字面匹配**：中文 query 与英文
正文之间没有任何共同的 token。实测 `query=锗探测器能量分辨` 对
`kp-knoll-4e-2010-1` 命中 0 条，而同义的 `germanium detector resolution` 命中
200 条。学生是全中文界面，英文书又占 60% 的叶节点 —— 没有这张表，这 60% 的
知识点在检索门控下等于不存在。

## 清洗规则（每一条都对应一类真实脏数据）

1. **`zh` 或 `en` 长度 < 2 的丢弃**：单字（「与」「或」）不是术语，展开它会把
   半个语料都拉进来。
2. **`zh` 含「未收录术语」的丢弃**：`translate.py` 在整条标题一个汉字都拼不出
   时写 `未收录术语（<原文>）`，那不是译名，是翻译失败标记。
3. **`en` 里没有 ASCII 字母的丢弃**：12 本中文书的 `nameOriginal` 就是中文原名
   （中文书没有「原文」可留），它们进表只会造出「中文→中文」的空转条目。
4. **`en` 里仍含汉字的丢弃**：OCR 把 `YAP:Ce` 这类缩写认成汉字乱码
   （`夀䄀倀㨀䌀攀`）时，`nameOriginal` 会同时含英文与乱码，那种串在正文里
   永远搜不到。
5. **`en` 开头的章节编号剥掉**：`1.3 Radioactivity and radioactive decay` 的
   正文里通常只有 `Radioactivity and radioactive decay`（编号在标题行，切分时
   与正文分开了）。留着编号会让「`en` 是否出现在正文里」这个判据失效。
   只剥**编号 + 空白**，不剥单词 —— `3He Detectors` 的 `3` 是氦-3，剥了就错。
   **`zh` 也剥同一套编号**：`naming.py::disambiguate_duplicate_names()` 会把
   编号拼回重名叶节点的 `name`（`10.1.1 ADC性能` / `10.1.2 ADC性能`），而学习者
   提问时不会带上目录编号。不剥的话这两条永远是死条目，而 `ADC性能` 这个真术语
   反而不在词表里。
6. **同一 `zh` 对应 > 8 个不同 `en` 的整条丢弃**：那是 OCR 把编号吃掉之后，
   同一章里一堆小节都只剩「概述」「类型」「方法」这类通用词。它们不是术语，
   展开它们只会把检索变成「命中一切」。
   **这条要在规则 9–10 缩减之后才算**：`探测器` 原本 30 个写法，但缩减后只剩
   `Detector` —— 那是个好术语，不该因为 OCR 把 30 个「XX 探测器」小节都译成
   「探测器」而被丢掉。缩减后仍 >8 的（实测 `能量` / `类型` / `方法`）才是真通用词。
7. **`en` 开头那段短小写碎片丢掉**：OCR 常把章节号连同第一个词认成一串碎片，
   于是 `1.5 Pulse Shaping` 变成 `is Pulse Shaping`、`The field effect` 变成
   `oe The field effect`。这些碎片会作为独立 token 进 BM25（`is`、`oe`、`eee`
   在英文正文里到处都是），把召回放大到没有意义。判据是「首个空白分隔 token
   是全小写且长度 ≤ 3」，剥掉它再继续（可能连续两段，循环到不满足为止）。
   `dE/dx`（5 字符）、`1/f`（含斜杠）不受影响。
8. **同一条目里大小写不同的 `en` 合并**（`Pulse shaping` / `Pulse Shaping` 留
   出现次数多的那个写法；并列时取字典序小的，保证产物逐字节稳定）。
9. **同一条目里被别的 `en` 包含的写法丢掉**（`Pulse shaping` ⊂
   `Semi-triangular pulse shaping` ⇒ 只留 `Pulse shaping`）。展开时把这些长串
   一起加进 BM25，等于把「句子级标题」当成了词 —— 命中的段落与术语本身无关。
10. **有单词写法就只留单词写法**（`Detectors` / `Diamond detectors` /
    `Thermoluminescent detectors` ⇒ 只留 `Detectors`）。展开的目标是「让英文
    正文里出现这个术语」，带修饰词的长串只在个别小节标题里出现，召回比单词
    写法窄得多。例外：整组没有单词写法时全留（`Germanium Detectors`）。

## 为什么按 `zh` 聚合而不是按 `en`

展开的方向是「中文 query → 英文词」，所以索引键必须是中文。同一个中文术语在不同
书里可能译自不同的英文（「探测器」→ `Detectors` / `detectors`），它们都该被展开 ——
但要先过第 6 条的上限，否则通用词会污染召回。

用法：

    python tools/ingest/export_glossary.py            # 写 content/glossary.json
    python tools/ingest/export_glossary.py --check    # 只校验产物是否最新（CI 用）
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CONTENT = ROOT / 'content'
OUTPUT = CONTENT / 'glossary.json'

#: 章节编号前缀。只认「数字/字母编号 + 点分 + 空白」这一种形态。
#: 反例（**不能**被剥）：`3He Detectors`（氦-3 探测器）、`1/f noise`（噪声谱密度）。
#: 所以编号后面必须跟空白，`3He` 与 `1/f` 都不满足。
#: 三种形态：`1` / `1.3` / `7.2.E`（带小节字母）、`E.1` / `A.2.3`（带章字母）、`IV.`。
_NUMBER_PREFIX = re.compile(
    r'^\s*(?:'
    r'\d+(?:\.\d+)*(?:\.[A-Z])?'  # 1 / 1.2 / 1.3.4 / 7.2.E
    r'|[A-Z](?:\.\d+)+'  # A.1 / E.1.2
    r'|[IVX]+'  # 罗马数字
    r')\.?\s+'
)

#: 通用词上限：同一中文术语对应超过这么多英文串，判定为 OCR 残缺名而不是术语。
MAX_EN_PER_ZH = 8

#: 中文/汉字判定。`\u4e00-\u9fff` 是 CJK 统一表意文字基本区，够用：
#: OCR 乱码（`夀䄀倀㨀䌀攀`）落在扩展 A 区与兼容区，刻意用正则而不是 `isalpha()`
#: —— 后者对汉字也返回 True，拦不住。
_CJK = re.compile(r'[\u4e00-\u9fff]')
_ASCII_LETTER = re.compile(r'[A-Za-z]')


def strip_number_prefix(text: str) -> str:
    """剥掉 `1.3 ` / `A.2 ` / `IV. ` 这类章节编号。"""
    return _NUMBER_PREFIX.sub('', text).strip()


#: OCR 碎片：全小写、长度 ≤ 3 的首 token。
_OCR_LEAD = re.compile(r'^[a-z]{1,3}\s+')


def strip_ocr_lead(text: str) -> str:
    """剥掉开头的 OCR 碎片（`is Pulse Shaping` → `Pulse Shaping`）。

    循环剥是因为 OCR 有时连着给出两段（`eee Appendix D …` 剥一次就够，
    `oe The field effect` 也是）；剥到剩下不足 2 个字符时原样返回上一轮结果，
    避免把整串剥空。
    """
    current = text.strip()
    while True:
        stripped = _OCR_LEAD.sub('', current).strip()
        if stripped == current or len(stripped) < 2:
            return current
        current = stripped


def is_usable_pair(zh: str, en: str) -> bool:
    """一对 (zh, en) 是否值得进词表。规则见模块 docstring 的清洗规则 1–4。"""
    zh = zh.strip()
    en = en.strip()
    if len(zh) < 2 or len(en) < 2:
        return False
    if '未收录术语' in zh:
        return False
    if not _ASCII_LETTER.search(en):
        return False
    # `en` 里还有汉字 = OCR 把缩写认成乱码，或这本书本来就是中文书
    if _CJK.search(en):
        return False
    return True


def _toc_paths() -> list[Path]:
    return sorted(CONTENT.glob('*/toc.json'))


def build_glossary(toc_paths: list[Path] | None = None) -> list[dict[str, Any]]:
    """扫全部 `toc.json`，返回按 `zh` 聚合的术语表（已排序，便于 diff）。

    返回 `[{zh, en: [...], sources: [...]}]`。`sources` 是「哪些书贡献了这条」，
    排查「这个译名从哪来」时不用重扫目录。
    """
    paths = toc_paths if toc_paths is not None else _toc_paths()

    # zh -> 英文原写法 -> 出现次数
    variants: dict[str, Counter[str]] = defaultdict(Counter)
    sources: dict[str, set[str]] = defaultdict(set)

    for path in paths:
        source_id = path.parent.name
        try:
            toc = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            continue
        for node in toc.get('nodes', []):
            zh = strip_number_prefix((node.get('name') or '').strip())
            en_raw = (node.get('nameOriginal') or '').strip()
            if not is_usable_pair(zh, en_raw):
                continue
            en = strip_number_prefix(en_raw)
            en = strip_ocr_lead(en)
            # 剥完编号可能变短（`1.2` 这种纯编号标题），再过一次长度判据
            if not is_usable_pair(zh, en):
                continue
            variants[zh][en] += 1
            sources[zh].add(source_id)

    out: list[dict[str, Any]] = []
    for zh in sorted(variants):
        counter = variants[zh]
        # 大小写合并：按 lower 归组，取出现次数最多的原写法（并列取字典序小的）
        by_lower: dict[str, list[tuple[int, str]]] = defaultdict(list)
        for en, n in counter.items():
            by_lower[en.lower()].append((n, en))
        chosen: list[str] = []
        for en_lower in sorted(by_lower):
            candidates = sorted(by_lower[en_lower], key=lambda p: (-p[0], p[1]))
            chosen.append(candidates[0][1])
        reduced = reduce_variants(chosen)
        # 通用词上限在缩减之后才判（见 docstring 第 6 条）
        if len(reduced) > MAX_EN_PER_ZH:
            continue
        out.append({'zh': zh, 'en': reduced, 'sources': sorted(sources[zh])})

    return out


def reduce_variants(ens: list[str]) -> list[str]:
    """把同一条目的英文写法缩到最小可用集（清洗规则 9–10）。

    两步：① 丢掉被别的写法包含的长串；② 只要出现单词写法，就只留单词写法。
    两步都**不动顺序**（输入已是稳定顺序），也不改大小写 —— 大小写合并在上游。
    """
    lowered = [e.lower() for e in ens]
    kept: list[str] = []
    for index, text in enumerate(ens):
        own = lowered[index]
        if any(
            other != index and lowered[other] != own and lowered[other] in own
            for other in range(len(ens))
        ):
            continue
        kept.append(text)

    singles = [e for e in kept if ' ' not in e]
    return singles if singles else kept


def render(entries: list[dict[str, Any]]) -> str:
    """稳定的 JSON 文本（2 空格缩进、键序固定、末尾换行）。"""
    return json.dumps(entries, ensure_ascii=False, indent=2) + '\n'


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='从 content/*/toc.json 导出中英术语表')
    parser.add_argument('--check', action='store_true', help='只校验产物是否最新，不写文件')
    parser.add_argument('--quiet', action='store_true', help='不打印统计')
    args = parser.parse_args(argv)

    entries = build_glossary()
    text = render(entries)
    pairs = sum(len(e['en']) for e in entries)

    if args.check:
        if not OUTPUT.exists():
            print(f'缺少产物：{OUTPUT.relative_to(ROOT)}，请跑 python tools/ingest/export_glossary.py')
            return 1
        if OUTPUT.read_text(encoding='utf-8') != text:
            print(f'产物已过期：{OUTPUT.relative_to(ROOT)} 与当前代码生成的不一致，请重跑')
            return 1
        if not args.quiet:
            print(f'词表产物已同步：{len(entries)} 个中文术语 / {pairs} 条英文对照')
        return 0

    OUTPUT.write_text(text, encoding='utf-8')
    if not args.quiet:
        print(f'写入 {OUTPUT.relative_to(ROOT)}：{len(entries)} 个中文术语 / {pairs} 条英文对照')
    return 0


if __name__ == '__main__':
    sys.exit(main())
