"""一次性：把 .scratch/probe3/t4.mp4 转写出来，供切片与对齐使用。

这是探针脚本，不是正式产物生成器 —— 正式入口是 `tools/video/run.py`。
放在 .scratch 下是因为它绑死了本机路径。
"""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools' / 'video'))

from asr import configure_proxy_env, extract_audio, probe_duration, transcribe_with_whisper, write_transcript_jsonl

MEDIA = Path(r'D:\DeepSeek\starmap\.scratch\probe3\t4.mp4')
OUT = Path(r'D:\DeepSeek\starmap\.scratch\probe3\t4.transcript.jsonl')
WAV = Path(r'D:\DeepSeek\starmap\.scratch\probe3\t4.16k.wav')

configure_proxy_env('http://127.0.0.1:7890')

print(f'[1/3] 时长：{probe_duration(MEDIA):.2f}s', flush=True)
t0 = time.time()
extract_audio(MEDIA, WAV)
print(f'[2/3] 抽音频完成：{WAV}（{time.time() - t0:.1f}s）', flush=True)

t0 = time.time()
model = sys.argv[1] if len(sys.argv) > 1 else 'small'
segments, label = transcribe_with_whisper(MEDIA, model_size=model)
write_transcript_jsonl(segments, OUT)
print(f'[3/3] 转写完成：{len(segments)} 段，模型 {label}，耗时 {time.time() - t0:.1f}s', flush=True)
print(f'产物：{OUT}', flush=True)
for seg in segments[:5]:
    print(f'  {seg.start:7.2f}-{seg.end:7.2f} {seg.text}')
print('  …')
for seg in segments[-3:]:
    print(f'  {seg.start:7.2f}-{seg.end:7.2f} {seg.text}')
