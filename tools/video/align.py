"""把讲解片段对齐到 `app.knowledge_points` 里的真实知识点。

## 为什么用知识点名做匹配，而不是让模型判

票面要求「对齐必须可复核：片段要记『依据哪个知识点的名字/关键词命中的』」。
用模型判对齐得到的是「我觉得这段在讲电离室」—— 不可复核、不可复现、换个模型
就变。用知识点名做匹配得到的是「这段转写里出现了『电离室』这三个字，它对应
`kp-chenboxian-2011-8-2`」—— 任何人拿同一份转写都能重算出同一个结果。

## 匹配算法的取舍

1. **最长匹配优先**：知识点名往往互相包含（「电离室」⊂「脉冲电离室」），
   必须先匹配长的，否则「脉冲电离室」那一段会被更短的名字抢走。
2. **去停用词与泛化词**：名叫「小结」「习题」「概述」这类章节容器不能作为
   对齐依据（它们不是教学内容，只是书的排版结构）。这一步不是可选的：
   `app.knowledge_points` 里有 20 个这样的叶节点，且它们的 chunk 往往最多。
3. **单字/双字名不参与**：名叫「绪论」还行，名叫「一」「二」这种一定误伤。
   阈值定在 3 个字符。
4. **只认叶节点**：非叶节点是目录结构，挂上去等于没对齐。

## 打分

每命中一个知识点名，按「名字长度 × 出现次数」累加。长名字更有区分度：
「脉冲电离室」7 个字命中一次，比「电路」2 个字命中三次更像这段的主题。
最后一名的分数低于 `MIN_SCORE` 时判为「没对齐上」—— 宁可不给，也不给错的：
一个错误的知识点归属会把学习者带去完全不同的一章。
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# 章节容器名：不是教学内容，不能作为对齐依据
CONTAINER_NAMES = frozenset({
    '小结', '习题', '思考题', '练习题', '复习题', '本章小结', '总结',
    '概述', '引言', '绪论', '前言', '目录', '附录', '索引', '参考文献',
    'contents', 'preface', 'index',
})

# 名字短于这个长度不参与匹配（单字/双字名误伤率太高）
MIN_NAME_LEN = 3

# 至少这个分数才算对齐上
MIN_SCORE = 6.0

# 片段最多对齐到几个知识点（多了等于没对齐）
MAX_MATCHES = 3

# 中文标点/空白归一化：转写里的逗号句号与知识点名不一定一致
_PUNCT = re.compile(r'[\s，。、；：？！「」『』（）()《》〈〉【】\[\]…—\-·,.;:?!\'"“”‘’]')


@dataclass(frozen=True)
class KnowledgePoint:
    """一个可对齐的知识点。只带对齐需要的字段。"""

    micro_kp_id: str
    name: str
    is_leaf: bool = True
    book_id: str | None = None


@dataclass
class Alignment:
    """一次对齐结果。`evidence` 是给「可复核」用的原始证据。"""

    micro_kp_id: str
    name: str
    score: float
    hits: int
    evidence: str  # 例如「命中知识点名「电离室」3 次（共 3 字）」

    def to_json(self) -> dict:
        return {
            'microKpId': self.micro_kp_id,
            'name': self.name,
            'score': round(self.score, 2),
            'hits': self.hits,
            'evidence': self.evidence,
        }


def normalize(text: str) -> str:
    """去掉标点与空白，用于跨标点匹配。

    转写里有 `脉冲电离室，` 而知识点名是 `脉冲电离室`；不比一下归一化形式
    就永远匹配不上。
    """
    return _PUNCT.sub('', text or '')


def is_usable_name(name: str) -> bool:
    """这个知识点名能不能作为对齐依据。"""
    stripped = (name or '').strip()
    if len(stripped) < MIN_NAME_LEN:
        return False
    if stripped.lower() in CONTAINER_NAMES:
        return False
    # 纯数字/纯符号的名字（「第1章」这类）不参与
    if not re.search(r'[\u4e00-\u9fffA-Za-z]', stripped):
        return False
    return True


def score_points(text: str, points: list[KnowledgePoint]) -> list[Alignment]:
    """给一段转写打分，返回按分数降序的对齐结果（只含命中过的）。"""
    haystack = normalize(text)
    if not haystack:
        return []

    # 长名字优先：先给所有可用名字排序，匹配过的位置不再匹配（避免「电离室」
    # 把「脉冲电离室」的一部分吃掉）。
    usable = [p for p in points if p.is_leaf and is_usable_name(p.name)]
    usable.sort(key=lambda p: len(normalize(p.name)), reverse=True)

    # 用掩码标记已被更长名字占用的字符位置
    taken = [False] * len(haystack)
    results: list[Alignment] = []

    for point in usable:
        needle = normalize(point.name)
        if not needle:
            continue
        hits = 0
        positions: list[int] = []
        start = 0
        while True:
            idx = haystack.find(needle, start)
            if idx < 0:
                break
            if not any(taken[idx:idx + len(needle)]):
                hits += 1
                positions.append(idx)
                for i in range(idx, idx + len(needle)):
                    taken[i] = True
            start = idx + 1
        if hits == 0:
            continue
        score = float(len(needle) * hits)
        results.append(
            Alignment(
                micro_kp_id=point.micro_kp_id,
                name=point.name,
                score=score,
                hits=hits,
                evidence=f'命中知识点名「{point.name}」{hits} 次（{len(needle)} 字）',
            )
        )

    results.sort(key=lambda a: a.score, reverse=True)
    return results


def align_clip(
    text: str,
    points: list[KnowledgePoint],
    *,
    min_score: float = MIN_SCORE,
    max_matches: int = MAX_MATCHES,
) -> list[Alignment]:
    """对齐一个片段。返回 [] 表示没对齐上（调用方应把它标成未对齐而不是硬塞）。"""
    scored = score_points(text, points)
    return [a for a in scored if a.score >= min_score][:max_matches]


def load_points_from_rows(rows: list[dict]) -> list[KnowledgePoint]:
    """从 `SELECT id, name, is_leaf, source_id FROM knowledge_points` 的行构造。

    只读知识点的行 —— 票面边界明确说「不要碰 app.knowledge_points 的行」。
    """
    out: list[KnowledgePoint] = []
    for row in rows:
        out.append(
            KnowledgePoint(
                micro_kp_id=str(row['id']),
                name=str(row.get('name') or ''),
                is_leaf=bool(row.get('is_leaf')),
                book_id=row.get('source_id'),
            )
        )
    return out


def fallback_by_book(points: list[KnowledgePoint], book_id: str, *, limit: int = 1) -> list[Alignment]:
    """找不到任何名字命中时的兜底：给该书的第一个可用叶节点。

    ## 为什么这个兜底是危险的，以及为什么仍然提供

    「随便给一个」等于给了一个错误的归属。所以这个函数**只在调用方明确要求
    兜底时**才用，且产物的 `evidence` 会写明「没有名字命中，按书级兜底」——
    让下游一眼看出这条不是真匹配。正式的 `run.py` 默认**不用**它：没对齐上
    的片段就应该被标成未对齐，而不是被硬塞一个知识点。
    """
    candidates = [p for p in points if p.is_leaf and p.book_id == book_id and is_usable_name(p.name)]
    candidates.sort(key=lambda p: len(p.name), reverse=True)
    return [
        Alignment(
            micro_kp_id=p.micro_kp_id,
            name=p.name,
            score=0.0,
            hits=0,
            evidence='没有知识点名出现在转写里，按书级兜底（不是真匹配）',
        )
        for p in candidates[:limit]
    ]


__all__ = [
    'KnowledgePoint',
    'Alignment',
    'normalize',
    'is_usable_name',
    'score_points',
    'align_clip',
    'load_points_from_rows',
    'fallback_by_book',
    'CONTAINER_NAMES',
    'MIN_NAME_LEN',
    'MIN_SCORE',
]
