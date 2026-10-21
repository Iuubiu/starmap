"""把片段从源视频里切出来，并校验切完的时长与 ASR 时间戳一致。

## 精度

`ffmpeg -ss <start> -to <end> -i <src>` 与 `-i <src> -ss <start> -to <end>` 的区别：

- **输入侧 `-ss`（放在 `-i` 之前）**：快速定位，从最近的关键帧开始解码后丢弃
  前面的帧。新版本 ffmpeg 会精确 seek，但仍然可能因为关键帧间隔产生几十毫秒误差。
- **输出侧 `-ss`（放在 `-i` 之后）**：先解码全部再丢弃，精确但慢。
- **`-ss` 输入侧 + `-accurate_seek`（默认开启）+ `-copyts`**：兼顾速度与精度。

这里用输入侧 `-ss` + `-to`（相对 seek 点的时长）+ `-avoid_negative_ts make_zero`
把时间轴归零，切完立即用 `probe_duration` 回读校验。**校验不过就报错，不静默
接受** —— 票面红线是「切完回读时长校验误差 < 0.5s」。

## 为什么重新编码而不是 `-c copy`

`-c copy` 会把切点对齐到关键帧，实际起点可能比要求早 1-2 秒，音画与转写就对不
上了。精确切必须重编码。代价是慢一些、体积大一些，换来的是「切片时长与 ASR
时间戳一致」这条能被测试守住。
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from asr import ffmpeg_path, probe_duration

# 切片时长与转写时间戳的允许误差（票面：< 0.5s）
DURATION_TOLERANCE_SEC = 0.5


class CutError(RuntimeError):
    """切出来的片段与预期不符。带上两个时长，便于诊断是哪一端偏了。"""

    def __init__(self, message: str, *, expected: float, actual: float) -> None:
        super().__init__(message)
        self.expected = expected
        self.actual = actual


def cut_clip(
    source: Path,
    out_path: Path,
    start: float,
    end: float,
    *,
    ffmpeg: str | None = None,
    verify: bool = True,
    crf: int = 25,
    preset: str = 'veryfast',
) -> float:
    """从 source 切出 [start, end) 到 out_path，返回实测时长。

    `verify=True` 时回读时长并与 `end - start` 比对，超出 `DURATION_TOLERANCE_SEC`
    就抛 `CutError`。这个校验是票面第七条的证据来源。
    """
    if end <= start:
        raise ValueError(f'切片区间不合法：start={start}, end={end}')
    expected = end - start
    out_path.parent.mkdir(parents=True, exist_ok=True)
    exe = ffmpeg_path(ffmpeg)

    # -ss 放在 -i 之前 = 输入侧快速 seek；-t 给时长（比 -to 更不容易因时间基偏移）
    # -avoid_negative_ts make_zero 把输出时间轴从 0 开始，播放器才不会一开始就「拖到中间」
    cmd = [
        exe, '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', f'{start:.3f}',
        '-i', str(source),
        '-t', f'{expected:.3f}',
        '-avoid_negative_ts', 'make_zero',
        '-c:v', 'libx264', '-preset', preset, '-crf', str(crf),
        '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart',
        str(out_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', check=False)
    if proc.returncode != 0:
        raise CutError(
            f'ffmpeg 切片失败（{out_path.name}）：{(proc.stderr or "").strip()[:400]}',
            expected=expected,
            actual=0.0,
        )

    actual = probe_duration(out_path, ffmpeg=ffmpeg)
    if verify and abs(actual - expected) > DURATION_TOLERANCE_SEC:
        raise CutError(
            f'切片时长与预期不符：{out_path.name} 期望 {expected:.2f}s，实测 {actual:.2f}s，'
            f'超出容差 {DURATION_TOLERANCE_SEC}s。多半是关键帧对齐没生效。',
            expected=expected,
            actual=actual,
        )
    return actual


def check_clip_alignment(
    clip_start: float,
    clip_end: float,
    first_seg_start: float,
    last_seg_end: float,
    *,
    tolerance: float = DURATION_TOLERANCE_SEC,
) -> tuple[bool, str]:
    """纯函数：判断一个片段的时长是否与它的 ASR 时间戳跨度一致。

    这就是票面要求的那条测试所用的核心判据：
    `abs((end - start) - (last_seg.end - first_seg.start)) < 0.5`。

    返回 (是否通过, 说明)。说明里带具体数值，失败时可以直接贴进报错。
    """
    clip_span = clip_end - clip_start
    seg_span = last_seg_end - first_seg_start
    delta = abs(clip_span - seg_span)
    if delta < tolerance:
        return True, f'片段 {clip_span:.3f}s 与转写跨度 {seg_span:.3f}s 一致（差 {delta:.3f}s）'
    return False, (
        f'片段 {clip_span:.3f}s 与转写跨度 {seg_span:.3f}s 不一致（差 {delta:.3f}s，'
        f'容差 {tolerance}s）'
    )


__all__ = ['cut_clip', 'CutError', 'check_clip_alignment', 'DURATION_TOLERANCE_SEC']
