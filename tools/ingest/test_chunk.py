# -*- coding: utf-8 -*-
"""chunk.py 的切分规则测试。

这一套守的是**两条互相拉扯的性质**：

1. **英文段落必须能切开**。`_SENTENCE_END` 只认中文句末标点（。！？；），
   英文整页正文会变成一个 2000~6900 字符的巨型 chunk —— 实测 15 本英文书
   有 6219 个 chunk 超过 `MAX_CHARS`，最长 6866 字符。检索粒度直接失效
   （BM25 命中一个 6900 字符的 chunk 等于命中整页），而且一页上并列两个
   叶节点时必然有一个分到 0 个 chunk（全库 358 个零 chunk 叶节点）。

2. **中文书的行为一个字都不能变**。12 本中文书已经入库，chunk 文本进
   `_stable_id` 的哈希、chunkCount 是幂等导入的基线（73248）。所以英文规则
   是 `english_sentences=True` 的显式开关，默认路径**逐字节保持旧实现**
   （`test_default_path_matches_old_implementation` 是这条的回归网）。
"""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from chunk import (  # noqa: E402
    MAX_CHARS,
    _SENTENCE_END,
    _english_cuts,
    _split_long,
)


def _old_split_long(text: str) -> list[str]:
    """改前的实现，逐字照抄。默认路径必须与它完全一致。"""
    if len(text) <= MAX_CHARS:
        return [text]
    parts: list[str] = []
    buf = ''
    for sent in _SENTENCE_END.split(text):
        if len(buf) + len(sent) > MAX_CHARS and buf:
            parts.append(buf)
            buf = sent
        else:
            buf += sent
    if buf:
        parts.append(buf)
    return parts


class TestEnglishSplitting:
    def test_plain_english_paragraph_is_split_into_short_pieces(self):
        # 3000 字符、每句 60 字符左右：要求至少 3 段，且每段不超上限
        text = 'This is a complete sentence about detectors. ' * 60
        pieces = _split_long(text, english_sentences=True)
        assert len(pieces) >= 3
        assert all(len(p) <= MAX_CHARS for p in pieces)
        # 拼回去必须还是原文（切分不能丢字）
        assert ''.join(pieces) == text

    def test_abbreviations_are_not_treated_as_sentence_ends(self):
        # `Fig. 3.2` / `et al.` / `1.5 V` / `M. Moszynski` 里的句点不是句末
        cases = [
            'See Fig. 3.2 shows the setup. Done.',
            'Smith et al. 1997. The method works.',
            'The bias is 1.5 V. The current is small.',
            'M. Moszynski reported this.',
            'See Eq. (2.1). Then we compute.',
            '10.1109/TNS.2018.2840160 is a DOI.',
        ]
        for text in cases:
            cuts = _english_cuts(text)
            # 每个切点都必须落在「句末标点 + 空白」之后，且切点后的首字符是
            # 大写字母/数字/引号/括号
            for cut in cuts:
                assert text[cut - 1].isspace(), (text, cut)
                assert text[cut].isupper() or text[cut].isdigit() or text[cut] in '"\'([', (text, cut)

        # 具体到这几条：不能切在缩写处
        assert _english_cuts('See Fig. 3.2 shows the setup. Done.') == [30]
        assert _english_cuts('Smith et al. 1997. The method works.') == [19]
        assert _english_cuts('The bias is 1.5 V. The current is small.') == []
        assert _english_cuts('M. Moszynski reported this.') == []

    def test_lowercase_after_period_is_not_a_sentence_end(self):
        # 参考文献里 `J. Phys. 12 (1997) 123. and then` 这种小写续行不切
        assert _english_cuts('Voltage is 1.5 V. the next line continues.') == []

    def test_word_level_fallback_when_single_sentence_exceeds_limit(self):
        # 一句 2600 字符、没有句号：必须退到词边界切
        text = ' '.join(['detector'] * 300)
        pieces = _split_long(text, english_sentences=True)
        assert len(pieces) >= 2
        assert all(len(p) <= MAX_CHARS for p in pieces)
        assert ''.join(pieces) == text

    def test_hard_cut_terminates_on_unbreakable_string(self):
        # 参考文献 DOI 这种没有空格的串：三级退化到硬切，且不能死循环
        text = '10.1109/TNS.2018.2840160' * 200
        pieces = _split_long(text, english_sentences=True)
        assert all(len(p) <= MAX_CHARS for p in pieces)
        assert ''.join(pieces) == text

    def test_short_text_is_returned_as_is(self):
        text = 'A short sentence.'
        assert _split_long(text, english_sentences=True) == [text]


class TestChinesePathUnchanged:
    def test_default_path_matches_old_implementation(self):
        """默认路径必须与改前逐字节一致（12 本中文书的 chunkCount 基线）。"""
        samples = [
            '知识点。' * 400,
            '图1.1 电路如图。' * 300 + '结束。',
            '这是一个很长的段落，' * 200 + '。',
            '短句。',
            '没有句末标点的一段话' * 300,
        ]
        for text in samples:
            assert _split_long(text) == _old_split_long(text), text[:40]

    def test_real_chinese_corpus_is_unchanged(self):
        """用真实中文产物做快照：默认路径一条都不能变。

        只读已入库的 `content/`（不依赖数据库）。文件不存在时跳过 —— 测试
        要能在只有 `tools/ingest/` 的环境里跑。
        """
        sample = Path(__file__).parent.parent.parent / 'content' / 'digital-kanghua-5e' / 'chunks.jsonl'
        if not sample.exists():
            return
        checked = 0
        with io.open(sample, encoding='utf-8') as handle:
            for line in handle:
                row = json.loads(line)
                if row['kind'] != 'text':
                    continue
                checked += 1
                assert _split_long(row['text']) == _old_split_long(row['text'])
                if checked >= 200:
                    break
        assert checked > 0

    def test_chinese_sentence_end_still_splits(self):
        text = '第一句话。第二句话！第三句话？第四句话；' * 200
        pieces = _split_long(text)
        assert len(pieces) >= 2
        assert all(len(p) <= MAX_CHARS for p in pieces)
