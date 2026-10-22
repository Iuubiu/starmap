"""纯讲解区间判定：把一条转写切成 ≤6 分钟的「上课区间」。

## 为什么不能等分切片

票面第七条要求「每一片都有为什么从这里开始/结束的可读理由」。等分切片的
理由是「到了 6 分钟」，那不是教学理由 —— 它会把一句话劈成两半，也会把
「好，这节课就到这里，谢谢大家」留在片子中间。

## 判据分三层

1. **寒暄 / 题外话识别**（`classify`）：把每条转写分类成 `lecture`（讲解）、
   `greeting`（开场寒暄）、`outro`（结束语）、`tangent`（题外话：点赞投币、
   休息、闲聊）。这些类之间不是平权的：
   - `greeting` 只在该片段的**开头**附近才算「可丢弃的寒暄」——讲到一半突然
     说「大家好」是在引用别人的话，不该被切掉；
   - `tangent` 任何位置都可丢弃，但丢弃后必须重新校验时长；
   - `outro` 之后的内容整体算片外（课程结束了）。
2. **讲解段落切分**（`segment`）：在讲解段落里找**话题边界**（长停顿 +
   转写里的转折词），在那里切；切点必须落在 ASR segment 边界上，且切完每片
   ≤ `max_clip_sec`。
3. **可读理由**（`Clip.reason`）：每片都写一句中文，说明起点为什么在这里
   （「接在上一条片段的结尾之后」/「跳过 3 条开场寒暄」）与终点为什么在这里
   （「命中结束语『这节课就到这里』」/「话题转折 + 距上一片 4 分 12 秒」）。

## 为什么这些函数是纯函数

切片是「同一份转写应该永远得到同一组片段」的事。把它写成不依赖文件系统、
不依赖 ffmpeg、不依赖时间的纯函数，才可能为它写单元测试并在改动时立刻
知道行为变了。ffmpeg 只负责**执行**切点（`cut_clip`），判定完全在这里。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from asr import Segment

# ---------------------------------------------------------------------------
# 票面红线
# ---------------------------------------------------------------------------

MAX_CLIP_SEC = 6 * 60  # 每片最长 6 分钟，硬约束

# 片段的绝对下限：短于这个长度的片段没有教学价值（一句话、半句残留）
MIN_CLIP_SEC = 45

# ---------------------------------------------------------------------------
# 寒暄 / 题外话 / 结束语的模式表
# ---------------------------------------------------------------------------

# 开场寒暄。只在片段开头 `GREETING_WINDOW_SEC` 秒内生效。
#
# 每一条都来自真实课堂转写里的实际说法（B 站 31 分钟核电子学课）：
# 「好的 我们现在开始上课」「那么由我给大家上」「我是张雪梅」「这是我的email地址」。
# 后两句不是「寒暄」而是**自我介绍**，但它们同样是开场附属信息 ——
# 对「这一段讲什么」没有贡献，留在片头会让学习者在“老师叫啥”上花 30 秒。
GREETING_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r'大家好'),
    re.compile(r'各位(同学|老师|观众|朋友)'),
    re.compile(r'欢迎(大家)?(来到|收看|观看|回到)'),
    re.compile(r'^(我们)?(今天|这节课|这一节|本次课)(开始|讲|来学|学习)'),
    re.compile(r'^好(吧|了|的)?[，,、。\s]*(我们)?(现在|那就)?[，,、\s]*(开始|上课)'),
    # “那么由我给大家上” / “这门课由我来讲” —— 开场的自我介绍引导
    re.compile(r'^(那么)?由我(给|来)?(大家|你们)?(上|讲|介绍)'),
    # “我是张雪梅” / “我叫张雪梅”
    re.compile(r'^(那么)?我(是|叫)[\u4e00-\u9fff]{2,4}(老师|教授)?$'),
    # “这是我的email地址” / “我的邮箱是…”
    re.compile(r'(我的)?(email|邮箱|邮件|联系方式)'),
    re.compile(r'(能|可以)(听到|看见)(我|声音)吗'),
    re.compile(r'^(大家)?(早上|下午|晚上)好'),
    re.compile(r'^(同学们|各位)?好[，,。！!]'),
    # “这门课是核电子学” / “我们这门课是一门什么课” —— 课程说明段
    re.compile(r'^(我们)?这(门|个)(课|课程)(是|叫|讲)'),
)

# 结束语。命中后，这一条之后的内容默认算片外（除非后面又有大段讲解）。
OUTRO_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r'(这节课|这一节|本次课|今天就)(就)?(讲|上|说)到这里'),
    re.compile(r'(就)?到这里[，,]?\s*(谢谢|再见|下课)'),
    re.compile(r'谢谢(大家|各位|同学们)?(的)?(观看|收看|聆听|时间)'),
    re.compile(r'我们下次(课)?再见'),
    re.compile(r'(下节课|下次课|下一讲)(再|见)'),
    re.compile(r'^再见[。！!]?$'),
)

# 题外话：任何位置都可丢。这些是「不影响知识传递」的内容。
TANGENT_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r'(点赞|投币|收藏|转发|关注)(一下|一波)?'),
    re.compile(r'(一键三连|素质三连)'),
    re.compile(r'(休息|歇)(一下|一会|一会儿|十分钟|5 ?分钟|五分钟)'),
    re.compile(r'(我们)?(先)?(喝口水|喝点水|下课休息)'),
    re.compile(r'(弹幕|评论区)(里)?(有人|有同学)'),
    re.compile(r'(声音|画面)(有点|有些|不清楚|卡)'),
    re.compile(r'(广告|赞助商)'),
    re.compile(r'(这个视频|本视频)(是|由).{0,12}(赞助|支持|提供)'),
    re.compile(r'^(嗯|啊|呃|那个|这个)[，,、]?$'),
)

# 话题转折词：用于在没有长停顿时也能找到切点
#
# 容忍标点与插入语：真实转写里是「好，接下来我们来看…」，而不是「好我们来看…」。
# 早期版本把 `好` 与 `我们` 紧邻写进正则，实际语料一条都匹配不上，切点全都
# 退化到「到了 6 分钟」—— 那是位置驱动的切法，不是内容驱动的。
#
# ## 为什么转折词不能当「硬边界」
#
# 用真实课堂转写（B 站 31 分钟核电子学课）跑第一版时，11 片里有 3 片只有
# 10s / 46s / 80s：那位老师满口「那么…我们来看一下」，每一句都命中转折词。
# 转折词只表示「这句话在推进」，不表示「上一个话题讲完了」——
# 真正的硬边界是**长停顿**。所以转折词只在「已经接近单片上限」时作为
# 优先下刀点（见 `_split_long_run`），不让它单独切开一段连续的讲解。
TOPIC_SHIFT_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r'^(好|那|那么|接下来|下面|然后|再|现在)[，,、。！!\s]*'
        r'(?:(?:接下来|下面|我们|咱们|大家|现在|再|就)[，,、\s]*){0,3}'
        r'(来看|看|讲|说|讨论|介绍|学习|开始|进入)'
    ),
    re.compile(r'^(接下去|继续|下一步|第二个|第三个|第[一二三四五六七八九十]+(个)?(问题|部分|点|章|节))'),
    re.compile(r'^(首先|其次|最后|总之|总结一下|综上)'),
)

# 长停顿判据：两条转写之间超过这个秒数，认为说话人换了话题/节奏。
# 这是**唯一**能把一段连续讲解断开成两个 run 的判据。
TOPIC_PAUSE_SEC = 1.6

# 寒暄窗口：片段起点后这么多秒内的 greeting 才算可丢寒暄
GREETING_WINDOW_SEC = 20.0

Label = str  # 'lecture' | 'greeting' | 'outro' | 'tangent'


def _any(patterns: Sequence[re.Pattern[str]], text: str) -> re.Pattern[str] | None:
    for pattern in patterns:
        if pattern.search(text):
            return pattern
    return None


def classify(text: str, *, offset_in_clip: float) -> tuple[Label, str]:
    """给一条转写分类，并给出「为什么」的短说明。

    `offset_in_clip` 是这条转写相对**当前片段起点**的秒数。寒暄只在窗口内
    才算寒暄 —— 讲到一半突然说「大家好」是在引用别人的话（例如举例讲广播
    电台开场），把它切掉会破坏上下文。
    """
    stripped = text.strip()
    if not stripped:
        return 'tangent', '空文本'

    if _any(OUTRO_PATTERNS, stripped):
        return 'outro', '命中结束语'

    if offset_in_clip <= GREETING_WINDOW_SEC:
        hit = _any(GREETING_PATTERNS, stripped)
        if hit:
            return 'greeting', f'片段开头 {offset_in_clip:.0f}s 内命中开场寒暄'

    hit = _any(TANGENT_PATTERNS, stripped)
    if hit:
        return 'tangent', '命中题外话'

    return 'lecture', ''


# ---------------------------------------------------------------------------
# 切片结果
# ---------------------------------------------------------------------------


@dataclass
class Clip:
    """一段待导出的片段。`start`/`end` 永远落在 ASR segment 边界上。"""

    index: int
    start: float
    end: float
    segments: list[Segment]
    reason: str
    dropped_before: list[Segment] = field(default_factory=list)
    dropped_inside: list[Segment] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def text(self) -> str:
        return ''.join(seg.text for seg in self.segments).strip()

    def transcript_excerpt(self, limit: int = 240) -> str:
        text = self.text
        return text if len(text) <= limit else text[:limit] + '…'


def _joined(segments: Iterable[Segment]) -> str:
    return ''.join(seg.text for seg in segments)


def _fmt_sec(value: float) -> str:
    """秒 → `m:ss`，给可读理由用。"""
    total = int(round(value))
    return f'{total // 60}:{total % 60:02d}'


def _is_topic_shift(prev: Segment, cur: Segment) -> tuple[bool, str]:
    """两条转写之间是否是一个话题边界。返回 (是否, 理由)。"""
    gap = cur.start - prev.end
    if gap >= TOPIC_PAUSE_SEC:
        return True, f'停顿 {gap:.1f}s'
    hit = _any(TOPIC_SHIFT_PATTERNS, cur.text.strip())
    if hit:
        return True, f'转折词「{hit.pattern[:8]}…」'
    return False, ''


def _split_long_run(
    run: list[Segment],
    *,
    max_clip_sec: float,
    start_reason: str,
) -> list[tuple[list[Segment], str]]:
    """把一段「连续讲解」按 ≤max_clip_sec 切分，优先在话题边界处下刀。

    返回 [(segments, reason), …]。
    """
    if not run:
        return []

    out: list[tuple[list[Segment], str]] = []
    current: list[Segment] = []
    current_start_reason = start_reason

    for seg in run:
        if not current:
            current = [seg]
            continue

        span = seg.end - current[0].start
        prev = current[-1]
        shift, shift_reason = _is_topic_shift(prev, seg)

        # 超长：必须在**当前条之前**下刀，否则会超过上限
        overflow = seg.end - current[0].start > max_clip_sec
        if overflow:
            out.append((current, current_start_reason))
            current = [seg]
            current_start_reason = f'上一片已达 {_fmt_sec(current[0].start if current else 0)}，从这里续讲'
            continue

        # 未超长但已过 80% 且遇到话题边界 → 提前下刀，让片段落在话题之间
        near_limit = span > max_clip_sec * 0.8
        if near_limit and shift and len(current) >= 4:
            out.append((current, current_start_reason))
            current = [seg]
            current_start_reason = f'话题边界（{shift_reason}），距上一片起点 {_fmt_sec(span)}'
            continue

        current.append(seg)

    if current:
        out.append((current, current_start_reason))
    return out


def segment_transcript(
    segments: Sequence[Segment],
    *,
    max_clip_sec: float = MAX_CLIP_SEC,
    min_clip_sec: float = MIN_CLIP_SEC,
    total_duration: float | None = None,
) -> list[Clip]:
    """把转写切成纯讲解片段。

    ## 算法

    1. 从头扫描，丢掉开头的 `greeting` 与全片 `tangent`、`outro` 之后的内容；
    2. 把剩下的转写按「话题边界」聚成若干 run；
    3. 每个 run 再按 `max_clip_sec` 细分；
    4. 过短的尾片并入前一片（若合并后不超上限），否则单独保留并给出理由。

    `total_duration` 给定时，最后一片的 end 会被夹到媒体时长上 —— 转写最后
    一条的 end 偶尔会比实际媒体长几十毫秒，不夹会让 ffmpeg 报错。

    ## 返回值的可复核性

    每个 `Clip.reason` 都是一句话，能被直接列给人看；`dropped_before` /
    `dropped_inside` 保留了被丢掉的转写，让「丢了什么」也是可查的。
    """
    if not segments:
        return []

    # --- 1. 去掉片头寒暄与全片题外话 ---
    first_start = segments[0].start
    kept: list[Segment] = []
    dropped_leading: list[Segment] = []
    leading_reasons: list[str] = []
    outro_at: float | None = None

    for seg in segments:
        offset = seg.start - first_start
        label, why = classify(seg.text, offset_in_clip=offset)
        if label == 'outro' and outro_at is None:
            outro_at = seg.start
            dropped_leading.append(seg)
            leading_reasons.append(f'{_fmt_sec(seg.start)} {why}「{seg.text[:18]}」')
            break
        if label == 'tangent':
            dropped_leading.append(seg)
            leading_reasons.append(f'{_fmt_sec(seg.start)} {why}')
            continue
        if label == 'greeting':
            # 只有在还没开始讲（kept 为空）时丢掉
            if not kept:
                dropped_leading.append(seg)
                leading_reasons.append(f'{_fmt_sec(seg.start)} {why}')
                continue
        kept.append(seg)

    if not kept:
        return []

    # --- 2. 按长停顿聚成 run ---
    #
    # **只有长停顿能断开 run**。转折词（「那么…我们来看」）在真实课堂里是口头禅，
    # 每 20–40 秒就出现一次，用它做硬边界会把 31 分钟的课切成 11 片里 3 片不到
    # 90 秒的碎片（实测）。转折词的价值在「已接近上限时优先在那里下刀」。
    runs: list[list[Segment]] = [[kept[0]]]
    for prev, cur in zip(kept, kept[1:]):
        gap = cur.start - prev.end
        if gap >= TOPIC_PAUSE_SEC:
            runs.append([cur])
        else:
            runs[-1].append(cur)

    # --- 3. 每个 run 细分 ---
    pieces: list[tuple[list[Segment], str]] = []
    for run in runs:
        pieces.extend(_split_long_run(run, max_clip_sec=max_clip_sec, start_reason='上一段讲解结束'))

    # 过滤掉空 piece
    pieces = [(p, r) for p, r in pieces if p]

    # --- 4. 过短的片合并 ---
    #
    # 两条规则：
    # - 片尾过短且有**前一片** → 并回前一片（前提是合并不超上限）；
    # - **首个片本身过短** → 向后并（没有前一片可并）。
    #
    # 早期只写了第一条，真实转写跑出过一片 10 秒的开头片（剩下都是被丢弃的
    # 寒暄之后的零头）—— 那正是「首片无前可并」的盲区。
    merged: list[tuple[list[Segment], str]] = []
    for piece, reason in pieces:
        if merged:
            prev_piece, prev_reason = merged[-1]
            span = piece[-1].end - prev_piece[0].start
            if (piece[-1].end - piece[0].start) < min_clip_sec and span <= max_clip_sec:
                merged[-1] = (prev_piece + piece, prev_reason)
                continue
        merged.append((piece, reason))

    # 首片过短时向后并（而不是向前 启动，因为不存在「向前」）
    while len(merged) >= 2:
        head, head_reason = merged[0]
        if (head[-1].end - head[0].start) >= min_clip_sec:
            break
        nxt, _ = merged[1]
        if (nxt[-1].end - head[0].start) > max_clip_sec:
            break
        merged[0] = (head + nxt, head_reason + f'；首片不足 {int(min_clip_sec)}s，与下一段合并')
        del merged[1]

    # --- 5. 组装 Clip，写可读理由 ---
    clips: list[Clip] = []
    for index, (piece, reason) in enumerate(merged):
        start = piece[0].start
        end = piece[-1].end
        if total_duration is not None:
            end = min(end, total_duration)
        if end <= start:
            continue

        # 起点理由
        if index == 0:
            if dropped_leading:
                head = f'跳过片头 {len(dropped_leading)} 条（' + '；'.join(leading_reasons[:2]) + '）'
            else:
                head = '视频一开头就是讲解内容，无需裁剪片头'
        else:
            head = f'从 {_fmt_sec(start)} 续切：' + reason

        # 终点理由
        if index == len(merged) - 1:
            if outro_at is not None:
                tail = f'在 {_fmt_sec(outro_at)} 的结束语之前收尾'
            else:
                tail = '转写结束，到这里收尾'
        else:
            nxt = merged[index + 1][0]
            gap = nxt[0].start - end
            if gap >= TOPIC_PAUSE_SEC:
                tail = f'停在 {_fmt_sec(end)}：之后有 {gap:.1f}s 停顿，是话题边界'
            else:
                tail = f'停在 {_fmt_sec(end)}：为控制单片时长（≤{int(max_clip_sec // 60)} 分钟）'

        clips.append(
            Clip(
                index=index,
                start=start,
                end=end,
                segments=piece,
                reason=f'{head}；{tail}',
                dropped_before=dropped_leading if index == 0 else [],
            )
        )

    # 整体兜底：任何一片超过硬上限都要被切断（理论上不会走到，但不允许静默超限）
    out: list[Clip] = []
    for clip in clips:
        if clip.duration <= max_clip_sec:
            out.append(clip)
            continue
        # 二分：在 segments 里找一个不超过上限的最长前缀
        acc: list[Segment] = []
        for seg in clip.segments:
            if seg.end - clip.start > max_clip_sec:
                break
            acc.append(seg)
        if not acc:
            continue
        clipped = Clip(
            index=clip.index,
            start=clip.start,
            end=acc[-1].end,
            segments=acc,
            reason=clip.reason + f'；为避免超过 {int(max_clip_sec // 60)} 分钟在上限处截断',
            dropped_before=clip.dropped_before,
        )
        out.append(clipped)
        rest = clip.segments[len(acc):]
        if rest:
            out.append(
                Clip(
                    index=clip.index,
                    start=rest[0].start,
                    end=rest[-1].end,
                    segments=rest,
                    reason=f'从 {_fmt_sec(rest[0].start)} 接上一片的截断处继续',
                    dropped_before=[],
                )
            )

    for i, clip in enumerate(out):
        clip.index = i
    return out


def summarize_clips(clips: Sequence[Clip]) -> str:
    """一行摘要，写进日志/产物便于人工核对。"""
    if not clips:
        return '没有可导出的讲解片段'
    total = sum(clip.duration for clip in clips)
    longest = max(clip.duration for clip in clips)
    return (
        f'{len(clips)} 片，合计 {_fmt_sec(total)}，最长 {_fmt_sec(longest)}'
        f'（上限 {_fmt_sec(MAX_CLIP_SEC)}）'
    )


__all__ = [
    'Clip',
    'classify',
    'segment_transcript',
    'summarize_clips',
    'MAX_CLIP_SEC',
    'MIN_CLIP_SEC',
    'GREETING_PATTERNS',
    'OUTRO_PATTERNS',
    'TANGENT_PATTERNS',
    'TOPIC_SHIFT_PATTERNS',
]
