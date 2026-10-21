"""语音转写：字幕优先，没有字幕才用本地 faster-whisper。

设计约束（票 19）：
- **不调用任何大模型 API 做 ASR**。这里只有两条路：读现成字幕文件，或在
  本机跑 faster-whisper。前者零成本且时间戳来自平台，后者只依赖本机 CPU。
- 两条路产出**同一种形状**（`Segment` 列表），让下游切片逻辑不必关心来源。

为什么字幕优先：平台字幕是人工/半自动校对过的，时间戳与断句都更贴近讲解节奏；
faster-whisper 在中文专业术语上会写错字（「甄别器」这类），那会连带把知识点
对齐做歪。只有确实没有字幕时才走 ASR，且产物里记下用的模型名 —— 让下游能
看出这一份转写的可信度来源。
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Segment:
    """一条带时间戳的转写片段。时间单位是秒（浮点），与 ffmpeg 一致。"""

    start: float
    end: float
    text: str

    def to_json(self) -> dict:
        return {'start': round(self.start, 3), 'end': round(self.end, 3), 'text': self.text}


# ---------------------------------------------------------------------------
# 字幕解析
# ---------------------------------------------------------------------------

_TS = re.compile(
    r'(?P<h>\d{1,2}):(?P<m>\d{2}):(?P<s>\d{2})[.,](?P<ms>\d{1,3})'
)


def _parse_timestamp(raw: str) -> float:
    m = _TS.search(raw)
    if not m:
        raise ValueError(f'字幕时间戳格式不认识：{raw!r}')
    return (
        int(m.group('h')) * 3600
        + int(m.group('m')) * 60
        + int(m.group('s'))
        + int(m.group('ms').ljust(3, '0')) / 1000.0
    )


def parse_subtitle(text: str) -> list[Segment]:
    """解析 SRT / WebVTT 为 Segment 列表。

    两种格式的差别只有时间戳分隔符（`,` vs `.`）与可选的 `WEBVTT` 头、`NOTE`
    块，用一个解析器覆盖即可。不引入 `webvtt-py` / `srt` 依赖：这两个包各做
    一件小事，而解析器本身不到 40 行 —— 多一个依赖就多一处版本漂移。
    """
    segments: list[Segment] = []
    lines = text.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        # 跳过序号行、WEBVTT 头、NOTE / STYLE 块
        if not line or line.startswith('WEBVTT') or line.startswith('NOTE') or line.startswith('STYLE'):
            i += 1
            continue
        if '-->' not in line:
            i += 1
            continue
        try:
            left, _, right = line.partition('-->')
            start = _parse_timestamp(left)
            # 右半边可能带 cue settings（WebVTT 允许 `00:00:02.000 align:start`）
            end = _parse_timestamp(right.strip().split(' ')[0])
        except ValueError:
            i += 1
            continue
        i += 1
        body: list[str] = []
        while i < len(lines) and lines[i].strip():
            # 去掉 WebVTT 的行内标签（<c>、<00:00:01.000> 等）
            body.append(re.sub(r'<[^>]*>', '', lines[i].strip()))
            i += 1
        joined = ' '.join(part for part in body if part).strip()
        if joined:
            segments.append(Segment(start=start, end=end, text=joined))
    return segments


def load_subtitle_file(path: Path) -> list[Segment]:
    """读一个 .srt / .vtt / .json3 字幕文件。找不到就返回空列表（调用方转 ASR）。"""
    if not path.exists():
        return []
    raw = path.read_text(encoding='utf-8', errors='replace')
    if path.suffix == '.json3':
        return _parse_json3(raw)
    return parse_subtitle(raw)


def _parse_json3(raw: str) -> list[Segment]:
    """YouTube 的 json3 字幕格式（`events[].tStartMs` / `segs[].utf8`）。"""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    out: list[Segment] = []
    for event in data.get('events', []):
        if 'segs' not in event:
            continue
        text = ''.join(seg.get('utf8', '') for seg in event['segs']).strip()
        if not text or text == '\n':
            continue
        start = float(event.get('tStartMs', 0)) / 1000.0
        duration = float(event.get('dDurationMs', 0)) / 1000.0
        out.append(Segment(start=start, end=start + duration, text=text))
    return out


# ---------------------------------------------------------------------------
# faster-whisper
# ---------------------------------------------------------------------------

DEFAULT_MODEL = 'small'


def load_audio_array(media_path: Path, *, ffmpeg: str | None = None) -> 'object':
    """用 ffmpeg 把媒体解成 16kHz 单声道 float32 numpy 数组。

    ## 为什么不用 faster-whisper 自带的解码

    faster-whisper 1.2.1 通过 PyAV 解码（`av.open(..., metadata_errors=...)`），
    而本机装的是 PyAV 19 —— 那个参数已被移除，直接传路径会报
    `TypeError: open() got an unexpected keyword argument 'metadata_errors'`。

    降级 PyAV 会连带影响其它用到 av 的包；用 ffmpeg 解成数组再交进去完全绕开
    这条路径，且 ffmpeg 本来就是我们唯一的解码器（切片也用它），少一个依赖
    版本约束。

    faster-whisper 接受 `np.ndarray`（形状 `(n,)`，float32，[-1, 1]）。
    """
    import numpy as np  # noqa: PLC0415

    exe = ffmpeg_path(ffmpeg)
    proc = subprocess.run(
        [exe, '-hide_banner', '-loglevel', 'error', '-i', str(media_path),
         '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'],
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f'ffmpeg 解码音频失败：{media_path}：'
            f'{(proc.stderr or b"").decode("utf-8", "replace")[:300]}'
        )
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def transcribe_with_whisper(
    media_path: Path,
    *,
    model_size: str = DEFAULT_MODEL,
    device: str = 'cpu',
    compute_type: str = 'int8',
    language: str = 'zh',
    progress: bool = True,
    ffmpeg: str | None = None,
) -> tuple[list[Segment], str]:
    """本机 faster-whisper 转写。返回 (segments, asr_model_label)。

    `asr_model_label` 会写进产物元数据，例如 `faster-whisper:small:int8`。
    标签里带 compute_type 是有意的：同一段音频用 `medium` 与 `tiny` 转出来的
    错字率差别很大，下游读到这份转写时需要知道它有多可信。

    首次运行会从 Hugging Face 下载权重。本机在墙内，**必须**由调用方设好
    `HTTP_PROXY` / `HTTPS_PROXY`；下载失败时这里让异常照常抛出，由 `run.py`
    记录失败原因 —— 绝不静默降级成「假装转写过」。
    """
    try:
        from faster_whisper import WhisperModel  # noqa: PLC0415  （重依赖，延迟导入）
    except ImportError as exc:  # pragma: no cover - 环境问题
        raise RuntimeError(
            'faster-whisper 未安装。请 `python -m pip install faster-whisper==1.2.1`，'
            '或改用 --subtitle 传入现成字幕。'
        ) from exc

    if progress:
        print(f'[asr] 载入 faster-whisper 模型 {model_size}（device={device}, {compute_type}）…', file=sys.stderr)
    model = WhisperModel(model_size, device=device, compute_type=compute_type)
    if progress:
        print('[asr] 用 ffmpeg 解码音频（绕开 PyAV 版本不兼容）…', file=sys.stderr)
    audio = load_audio_array(media_path, ffmpeg=ffmpeg)
    if progress:
        print(f'[asr] 音频 {len(audio) / 16000:.1f}s，开始转写…', file=sys.stderr)
    segments_iter, info = model.transcribe(
        audio,
        language=language,
        # 打开 VAD：长静音与音乐段落不产生幻觉文本（whisper 在静音上会「听到」歌词）
        vad_filter=True,
        vad_parameters={'min_silence_duration_ms': 500},
        beam_size=5,
    )
    if progress:
        print(f'[asr] 识别语言 {info.language}（置信度 {info.language_probability:.2f}），开始转写…', file=sys.stderr)
    out: list[Segment] = []
    for seg in segments_iter:
        text = (seg.text or '').strip()
        if not text:
            continue
        out.append(Segment(start=float(seg.start), end=float(seg.end), text=text))
        if progress and len(out) % 50 == 0:
            print(f'[asr] 已转写 {len(out)} 段（{seg.end:.0f}s）…', file=sys.stderr)
    return out, f'faster-whisper:{model_size}:{compute_type}'


# ---------------------------------------------------------------------------
# ffmpeg 辅助
# ---------------------------------------------------------------------------

def ffmpeg_path(explicit: str | None = None) -> str:
    """定位 ffmpeg 可执行文件。

    本机 ffmpeg 不在 PATH 上，只有 `imageio-ffmpeg` 自带的那个二进制。
    优先用调用方传入的路径，其次 `imageio_ffmpeg.get_ffmpeg_exe()`，最后
    猜 `ffmpeg`（PATH 上有时更好）。
    """
    if explicit:
        return explicit
    try:
        import imageio_ffmpeg  # noqa: PLC0415

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001 - 任何导入/调用失败都退回 PATH
        return 'ffmpeg'


def probe_duration(media_path: Path, *, ffmpeg: str | None = None) -> float:
    """读媒体时长（秒）。

    `ffmpeg -i` 把信息打到 stderr，退出码是 1，所以不能用 check=True 的返回值
    判断成功；这里解析 stderr 的 `Duration:` 行。不引入 ffprobe：本机 ffprobe
    也不在 PATH 上，而这一行足够回答「切出来的片子多长」。
    """
    exe = ffmpeg_path(ffmpeg)
    proc = subprocess.run(
        [exe, '-hide_banner', '-i', str(media_path)],
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace',
        check=False,
    )
    m = re.search(r'Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})', proc.stderr or '')
    if not m:
        raise RuntimeError(f'读不出媒体时长：{media_path}（ffmpeg 输出里没有 Duration 行）')
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 100.0


def extract_audio(media_path: Path, out_wav: Path, *, ffmpeg: str | None = None) -> Path:
    """抽 16kHz 单声道 wav —— faster-whisper 内部也会做，但先抽出来能让
    转写与切片复用同一个音频源，且便于排查「是音频坏了还是模型听错」。"""
    exe = ffmpeg_path(ffmpeg)
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [exe, '-y', '-hide_banner', '-loglevel', 'error', '-i', str(media_path),
         '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(out_wav)],
        check=True,
    )
    return out_wav


def write_transcript_jsonl(segments: list[Segment], path: Path | str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as fh:
        for seg in segments:
            fh.write(json.dumps(seg.to_json(), ensure_ascii=False) + '\n')


def read_transcript_jsonl(path: Path | str) -> list[Segment]:
    path = Path(path)
    out: list[Segment] = []
    with path.open('r', encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            out.append(Segment(start=float(row['start']), end=float(row['end']), text=str(row['text'])))
    return out


def configure_proxy_env(proxy: str | None) -> None:
    """把代理写进环境变量，供 huggingface_hub 下载权重时使用。

    yt-dlp 有 `--proxy` 参数，但 huggingface_hub 只认 `HTTP_PROXY`/`HTTPS_PROXY`。
    两处都要设，否则「下载器能连、模型下载连不上」会很迷惑。
    """
    if not proxy:
        return
    for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'):
        os.environ.setdefault(key, proxy)


__all__ = [
    'Segment',
    'parse_subtitle',
    'load_subtitle_file',
    'load_audio_array',
    'transcribe_with_whisper',
    'ffmpeg_path',
    'probe_duration',
    'extract_audio',
    'write_transcript_jsonl',
    'read_transcript_jsonl',
    'configure_proxy_env',
    'DEFAULT_MODEL',
    'asdict',
]
