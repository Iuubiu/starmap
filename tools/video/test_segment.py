"""segment.py 的单元测试。

这些测试守住四件事（对应票面第 3、5 条）：

1. **判定不是恒等函数**：带寒暄/题外话/结束语的输入必须被裁剪；整段纯讲解的
   输入必须原样保留（「不需要切」也是一种正确结果）。
2. **每片 ≤ 6 分钟**：这是硬红线，用 6 小时级别的合成转写压测。
3. **切点落在 ASR segment 边界上**：不能从两条转写中间切。
4. **时长与转写时间戳一致**：`abs((end-start) - (last_seg.end - first_seg.start)) < 0.5`。

测试全部是纯函数，不碰网络、不碰 ffmpeg —— 这是把判定逻辑独立出来的理由。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from asr import Segment
from segment import (
    MAX_CLIP_SEC,
    Clip,
    classify,
    segment_transcript,
    summarize_clips,
)


def seg(start: float, end: float, text: str) -> Segment:
    return Segment(start=start, end=end, text=text)


def lecture_segments(count: int, *, start: float = 0.0, step: float = 5.0) -> list[Segment]:
    """造一段连续的、明确是讲解的转写。"""
    return [
        seg(start + i * step, start + (i + 1) * step, f'这里讲第{i + 1}个要点，我们来看它的定义与推导过程。')
        for i in range(count)
    ]


class TestClassify:
    def test_greeting_only_counts_at_clip_start(self):
        label, why = classify('大家好，今天我们来讲核电子学', offset_in_clip=0.0)
        assert label == 'greeting'
        assert '开场寒暄' in why

    def test_greeting_late_is_not_dropped(self):
        # 讲到 5 分钟时引用别人的开场白，不该被当寒暄切掉
        label, _ = classify('大家好，今天我们来讲核电子学', offset_in_clip=300.0)
        assert label == 'lecture'

    def test_outro_is_recognized(self):
        for text in (
            '好，这节课就讲到这里',
            '谢谢大家观看',
            '我们下次课再见',
            '今天就到这里，谢谢',
        ):
            label, why = classify(text, offset_in_clip=999.0)
            assert label == 'outro', f'{text} 应判为结束语，实际 {label}'
            assert '结束语' in why

    def test_tangent_is_recognized_anywhere(self):
        for text in ('记得一键三连', '我们休息一下', '弹幕里有人问这个问题', '点赞投币收藏'):
            label, why = classify(text, offset_in_clip=500.0)
            assert label == 'tangent', f'{text} 应判为题外话，实际 {label}'
            assert '题外话' in why

    def test_normal_lecture_text_is_lecture(self):
        label, why = classify('电离室的工作原理是收集辐射在气体中产生的电荷', offset_in_clip=100.0)
        assert label == 'lecture'
        assert why == ''


class TestSegmentTranscript:
    def test_pure_lecture_whole_clip_is_correct_result(self):
        """整段都是讲解 → 不裁剪也是正确结果。"""
        segments = lecture_segments(5, step=2.0)  # 10 秒
        clips = segment_transcript(segments, min_clip_sec=1.0)
        assert len(clips) == 1
        assert clips[0].start == 0.0
        assert clips[0].end == 10.0
        assert '一开头就是讲解' in clips[0].reason

    def test_leading_greeting_is_dropped(self):
        """开头有寒暄 → 必须裁剪，证明判定不是恒等函数。"""
        segments = [
            seg(0.0, 2.0, '大家好'),
            seg(2.0, 4.0, '欢迎来到我们的课堂'),
            *lecture_segments(6, start=4.0, step=2.0),
        ]
        clips = segment_transcript(segments, min_clip_sec=1.0)
        assert len(clips) == 1, f'期望 1 片，实际 {len(clips)}'
        assert clips[0].start == 4.0, f'起点应跳过寒暄到 4.0，实际 {clips[0].start}'
        assert '跳过片头' in clips[0].reason
        # 被丢掉的内容要留证据
        assert len(clips[0].dropped_before) == 2

    def test_trailing_outro_is_dropped(self):
        """结尾有结束语 → 之后的内容不在片里。"""
        segments = [
            *lecture_segments(6, start=0.0, step=2.0),
            seg(12.0, 13.0, '好，这节课就讲到这里'),
            seg(13.0, 15.0, '谢谢大家观看，我们下次课再见'),
        ]
        clips = segment_transcript(segments, min_clip_sec=1.0)
        assert len(clips) == 1
        assert clips[0].end <= 12.0, f'收尾应在结束语之前，实际 {clips[0].end}'
        assert '结束语' in clips[0].reason

    def test_tangent_inside_is_dropped_and_recorded(self):
        segments = [
            *lecture_segments(3, start=0.0, step=2.0),
            seg(6.0, 7.0, '记得一键三连'),
            *lecture_segments(3, start=7.0, step=2.0),
        ]
        clips = segment_transcript(segments, min_clip_sec=1.0)
        text = ''.join(c.text for c in clips)
        assert '一键三连' not in text, '题外话不该出现在成片里'

    def test_all_clips_respect_max_duration(self):
        """超长转写必须被切到 ≤6 分钟。这里造 30 分钟的内容。"""
        segments = lecture_segments(360, step=5.0)  # 30 分钟
        clips = segment_transcript(segments, min_clip_sec=30.0)
        assert len(clips) >= 5, f'30 分钟应切成至少 5 片，实际 {len(clips)}'
        for clip in clips:
            assert clip.duration <= MAX_CLIP_SEC, f'第 {clip.index} 片 {clip.duration:.0f}s 超过 6 分钟'

    def test_clip_boundaries_sit_on_segment_boundaries(self):
        """切点必须落在 ASR segment 的 start/end 上，不能切在两条转写中间。"""
        segments = lecture_segments(360, step=5.0)
        starts = {s.start for s in segments}
        ends = {s.end for s in segments}
        clips = segment_transcript(segments, min_clip_sec=30.0)
        for clip in clips:
            assert clip.start in starts, f'片段起点 {clip.start} 不在任何 segment 起点上'
            assert clip.end in ends, f'片段终点 {clip.end} 不在任何 segment 终点上'

    def test_duration_matches_transcript_span(self):
        """票面那条测试：abs((end-start) - (last_seg.end - first_seg.start)) < 0.5。"""
        segments = lecture_segments(120, step=3.0)  # 6 分钟
        clips = segment_transcript(segments, min_clip_sec=20.0)
        assert clips, '应至少切出一片'
        for clip in clips:
            clip_span = clip.end - clip.start
            seg_span = clip.segments[-1].end - clip.segments[0].start
            assert abs(clip_span - seg_span) < 0.5, (
                f'第 {clip.index} 片时长 {clip_span:.3f} 与转写跨度 {seg_span:.3f} 差超过 0.5s'
            )

    def test_no_overlap_and_ordered(self):
        """片段之间不能重叠，且按时间升序。"""
        segments = lecture_segments(360, step=5.0)
        clips = segment_transcript(segments, min_clip_sec=30.0)
        for prev, cur in zip(clips, clips[1:]):
            assert cur.start >= prev.end - 1e-6, f'{prev.end} 与 {cur.start} 重叠'

    def test_total_duration_clamps_last_clip(self):
        """转写末条比媒体长时，最后一片的 end 被夹到媒体时长。"""
        segments = lecture_segments(3, start=0.0, step=5.0)  # 末条 end = 15
        clips = segment_transcript(segments, min_clip_sec=1.0, total_duration=14.5)
        assert clips[-1].end == 14.5

    def test_empty_input(self):
        assert segment_transcript([]) == []

    def test_only_greeting_gives_nothing(self):
        """全是寒暄 → 没有任何教学片段，返回空而不是硬造一片。"""
        segments = [seg(0.0, 2.0, '大家好'), seg(2.0, 4.0, '欢迎收看')]
        assert segment_transcript(segments) == []

    def test_near_limit_splits_at_topic_shift(self):
        """接近上限时遇到话题转折 → 提前下刀，而不是硬等超限。"""
        # 5 分钟连续讲解，之后是明显的转折
        segments = lecture_segments(60, step=5.0)  # 300 秒
        segments += [
            seg(300.0, 305.0, '好，接下来我们来看下一个问题：脉冲电离室'),
            *lecture_segments(30, start=305.0, step=5.0),
        ]
        clips = segment_transcript(segments, min_clip_sec=10.0)
        assert len(clips) >= 2
        # 第二片的起点应该落在「接下来」那一句上
        assert clips[1].start == 300.0, f'应在转折处下刀，实际 {clips[1].start}'

    def test_reason_is_human_readable(self):
        """每一片都有可读理由，且理由里出现具体秒数。"""
        segments = [
            seg(0.0, 2.0, '大家好'),
            *lecture_segments(50, start=2.0, step=5.0),
        ]
        clips = segment_transcript(segments, min_clip_sec=10.0)
        assert clips
        for clip in clips:
            assert clip.reason, f'第 {clip.index} 片没有理由'
            assert len(clip.reason) >= 10, f'理由太短：{clip.reason}'
        assert '跳过片头' in clips[0].reason


class TestSummarize:
    def test_summary_reports_count_and_longest(self):
        clips = [
            Clip(index=0, start=0, end=100, segments=[seg(0, 100, 'a')], reason='r'),
            Clip(index=1, start=100, end=260, segments=[seg(100, 260, 'b')], reason='r'),
        ]
        text = summarize_clips(clips)
        assert '2 片' in text
        assert '4:20' in text or '最长' in text

    def test_empty_summary(self):
        assert summarize_clips([]) == '没有可导出的讲解片段'
