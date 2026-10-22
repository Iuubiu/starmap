"""align.py 的单元测试。

守三件事：
1. **最长匹配优先**：「脉冲电离室」不能被更短的「电离室」抢走。
2. **章节容器不参与对齐**：「小结」「习题」这类名字不能作为对齐依据。
3. **没命中就返回空**：宁可标成未对齐，也不硬塞一个错误的知识点。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from align import (
    CONTAINER_NAMES,
    MIN_NAME_LEN,
    KnowledgePoint,
    align_clip,
    is_usable_name,
    normalize,
    score_points,
)


POINTS = [
    KnowledgePoint('kp-ion', '电离室'),
    KnowledgePoint('kp-pulse-ion', '脉冲电离室'),
    KnowledgePoint('kp-gm', '盖革-米勒计数器'),
    KnowledgePoint('kp-preamp', '前置放大器'),
    KnowledgePoint('kp-amp', '放大器'),
    KnowledgePoint('kp-summary', '小结'),
    KnowledgePoint('kp-exercise', '习题'),
    KnowledgePoint('kp-nonleaf', '核辐射探测', is_leaf=False),
    KnowledgePoint('kp-short', '电路'),
]


class TestNormalize:
    def test_strips_punctuation(self):
        assert normalize('脉冲电离室，') == '脉冲电离室'
        assert normalize('前 置 放 大 器') == '前置放大器'
        assert normalize('盖革-米勒计数器') == '盖革米勒计数器'


class TestIsUsableName:
    def test_container_names_rejected(self):
        for name in CONTAINER_NAMES:
            assert not is_usable_name(name), f'{name} 不该作为对齐依据'

    def test_short_names_rejected(self):
        assert not is_usable_name('电')
        assert not is_usable_name('电路'[: MIN_NAME_LEN - 1])
        assert is_usable_name('电离室')

    def test_symbol_only_rejected(self):
        assert not is_usable_name('123')
        assert not is_usable_name('---')


class TestScorePoints:
    def test_longest_match_wins(self):
        """「脉冲电离室」在文本里出现时，不该被更短的「电离室」抢走。"""
        text = '我们来看脉冲电离室的结构'
        results = score_points(text, POINTS)
        ids = [r.micro_kp_id for r in results]
        assert 'kp-pulse-ion' in ids, '长名应命中'
        # 「电离室」那三个字已被长名占用，不该再算一次命中
        assert 'kp-ion' not in ids, f'短名不该重复命中，实际结果 {ids}'

    def test_short_name_matches_when_long_absent(self):
        text = '电离室的工作原理是收集电荷'
        results = score_points(text, POINTS)
        assert results[0].micro_kp_id == 'kp-ion'

    def test_non_leaf_excluded(self):
        text = '核辐射探测是这门课的主题'
        results = score_points(text, POINTS)
        assert 'kp-nonleaf' not in [r.micro_kp_id for r in results]

    def test_container_excluded(self):
        text = '这一章的小结和习题我们课后看'
        results = score_points(text, POINTS)
        assert 'kp-summary' not in [r.micro_kp_id for r in results]
        assert 'kp-exercise' not in [r.micro_kp_id for r in results]

    def test_score_scales_with_hits(self):
        one = score_points('电离室', POINTS)
        many = score_points('电离室，电离室，还是电离室', POINTS)
        assert many[0].score > one[0].score
        assert many[0].hits == 3

    def test_score_scales_with_length(self):
        """长的名字比短的名字更有区分度（同样的命中次数下）。"""
        text = '放大器与前置放大器'
        results = {r.micro_kp_id: r for r in score_points(text, POINTS)}
        # 「前置放大器」5 字×1 = 5，「放大器」3 字×1 = 3（已被长名占掉一部分）
        assert results['kp-preamp'].score >= results['kp-amp'].score


class TestAlignClip:
    def test_returns_empty_when_nothing_matches(self):
        assert align_clip('今天天气不错，我们开始上课', POINTS) == []

    def test_respects_min_score(self):
        # 单次命中 3 字名 = 3 分，低于默认 MIN_SCORE=6
        assert align_clip('放大器', POINTS) == []

    def test_returns_top_matches(self):
        text = '前置放大器的输出接到脉冲电离室，前置放大器很重要'
        results = align_clip(text, POINTS)
        assert len(results) >= 1
        assert results[0].micro_kp_id in {'kp-preamp', 'kp-pulse-ion'}
        assert results[0].score >= 6

    def test_evidence_is_human_readable(self):
        text = '前置放大器的作用是把微弱信号放大，前置放大器的噪声很关键'
        results = align_clip(text, POINTS)
        assert results
        assert '命中知识点名' in results[0].evidence
        assert '前置放大器' in results[0].evidence

    def test_max_matches_caps_results(self):
        text = '前置放大器 脉冲电离室 盖革-米勒计数器 电离室 放大器 '.replace(' ', '')
        results = align_clip(text, POINTS, max_matches=2)
        assert len(results) <= 2

    def test_empty_text(self):
        assert align_clip('', POINTS) == []
