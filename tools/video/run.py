"""课程视频离线管线的入口。

用法：

    # 完整流程：下载 → 转写（字幕优先，否则 faster-whisper）→ 切片 → 对齐 → 落盘
    python tools/video/run.py process URL --out content/videos

    # 用本地文件（跳过下载）
    python tools/video/run.py process --local-file path/to/video.mp4 \
        --video-id local-xxx --title "..." --source-url "" --out content/videos

    # 只切已有转写（不下载、不转写）
    python tools/video/run.py segment-existing content/videos/<id> --max-minutes 6

    # 把 content/videos/*/clips.jsonl 导入数据库
    python tools/video/run.py import --content-dir content/videos --database-url ...

    # 只读地看一眼某个视频的转写与切片结果
    python tools/video/run.py inspect content/videos/<id>

## 产物布局

    content/videos/<videoId>/
        meta.json          来源与可追溯字段（原始链接、时长、下载时间、频道、ASR 模型）
        transcript.jsonl   带时间戳的转写（每行一个 segment）
        audio.16k.wav      抽出来的音频（可选，便于复跑转写）
        clips/
            <clipId>.mp4   切出来的片段
        clips.jsonl        每个片段的元数据（起止、时长、对齐、可读理由）

## 为什么产物是「文件 + jsonl」而不是直接进库

下载与转写会失败、会重跑、会换模型。把中间产物落成可 diff、可回看的文件，
才能回答「这一片是怎么来的」；入库只是一个幂等的投影步骤（`import`）。
把两者混在一起会让每次调参数都重跑一遍 30 分钟的 ASR。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from align import Alignment, KnowledgePoint, align_clip, load_points_from_rows  # noqa: E402
from asr import (  # noqa: E402
    Segment,
    configure_proxy_env,
    extract_audio,
    load_subtitle_file,
    probe_duration,
    read_transcript_jsonl,
    transcribe_with_whisper,
    write_transcript_jsonl,
)
from clip import CutError, check_clip_alignment, cut_clip  # noqa: E402
from fetch import FetchFailure, download  # noqa: E402
from segment import MAX_CLIP_SEC, segment_transcript, summarize_clips  # noqa: E402

DEFAULT_PROXY = 'http://127.0.0.1:7890'


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _slug(text: str, *, limit: int = 40) -> str:
    """把中文标题变成文件名安全的 id 片段。中文保留（Windows 支持），只去符号。"""
    cleaned = ''.join(ch if ch.isalnum() else '-' for ch in text.strip())
    cleaned = '-'.join(part for part in cleaned.split('-') if part)
    return (cleaned or 'video')[:limit]


# ---------------------------------------------------------------------------
# 知识点：从数据库只读加载
# ---------------------------------------------------------------------------


def load_knowledge_points(database_url: str | None) -> list[KnowledgePoint]:
    """从 `app.knowledge_points` 只读加载全部叶节点。

    **只读**：票面边界明确说「不要碰 app.knowledge_points 的行」。这里只
    SELECT，且只取对齐需要的四列。
    """
    try:
        import psycopg  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover
        raise SystemExit('需要 psycopg3：python -m pip install psycopg[binary]') from exc

    if not database_url:
        raise SystemExit('没有数据库连接串。用 --database-url 或设 DATABASE_URL。')

    with psycopg.connect(database_url, options='-c search_path=app,public') as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT id, name, is_leaf, source_id FROM knowledge_points WHERE is_leaf = true')
            rows = [
                {'id': row[0], 'name': row[1], 'is_leaf': row[2], 'source_id': row[3]}
                for row in cur.fetchall()
            ]
    return load_points_from_rows(rows)


# ---------------------------------------------------------------------------
# 转写：字幕优先
# ---------------------------------------------------------------------------


def resolve_transcript(
    *,
    media: Path,
    subtitle: Path | None,
    work_dir: Path,
    model_size: str,
    proxy: str | None,
    force_asr: bool = False,
) -> tuple[list[Segment], str, str]:
    """拿到带时间戳的转写。返回 (segments, 来源说明, asr_model_label)。

    优先级：显式字幕文件 > 同目录下 yt-dlp 下的字幕 > faster-whisper。
    """
    if subtitle and subtitle.exists() and not force_asr:
        segments = load_subtitle_file(subtitle)
        if segments:
            return segments, f'subtitle:{subtitle.name}', 'none (subtitle)'

    if proxy:
        configure_proxy_env(proxy)
    segments, label = transcribe_with_whisper(media, model_size=model_size)
    write_transcript_jsonl(segments, work_dir / 'transcript.jsonl')
    return segments, 'faster-whisper', label


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def cmd_process(args: argparse.Namespace) -> int:
    out_root = Path(args.out)
    if args.local_file:
        media = Path(args.local_file)
        if not media.exists():
            raise SystemExit(f'找不到本地文件：{media}')
        video_id = args.video_id or _slug(media.stem)
        out_dir = out_root / video_id
        out_dir.mkdir(parents=True, exist_ok=True)
        # 本地文件可能是「来源链接未知」的素材：元数据里如实标注，不编造 URL
        meta = {
            'sourceUrl': args.source_url or '',
            'videoId': video_id,
            'title': args.title or media.stem,
            'durationSec': round(probe_duration(media), 3),
            'uploader': args.uploader or None,
            'downloadedAt': _now_iso(),
            'origin': 'local-file',
            'note': args.note or '本地文件：来源链接未知，不得作为正式内容发布。',
        }
        subtitle = Path(args.subtitle) if args.subtitle else None
        source_media = media
    else:
        if not args.url:
            raise SystemExit('要么给 URL，要么给 --local-file')
        print(f'[1/5] 下载 {args.url} …', flush=True)
        try:
            result = download(
                args.url,
                out_root / '_download-tmp',
                want_subtitles=True,
                ffmpeg=args.ffmpeg,
            )
        except FetchFailure as failure:
            print(f'下载失败：{failure.message}', file=sys.stderr)
            print(f'原因分类：{failure.kind}', file=sys.stderr)
            print(f'可操作建议：{failure.hint}', file=sys.stderr)
            return 2
        video_id = result.meta.video_id or _slug(result.meta.title)
        out_dir = out_root / video_id
        out_dir.mkdir(parents=True, exist_ok=True)
        source_media = out_dir / f'source{result.media_path.suffix}'
        if result.media_path != source_media:
            shutil.move(str(result.media_path), source_media)
        subtitle = result.subtitle_path
        if subtitle and subtitle.parent != out_dir:
            target = out_dir / subtitle.name
            shutil.move(str(subtitle), target)
            subtitle = target
        meta = {
            **result.meta.to_json(),
            'downloadedAt': _now_iso(),
            'origin': 'yt-dlp',
            'licenseOrChannel': result.meta.uploader,
        }

    try:
        duration = probe_duration(source_media, ffmpeg=args.ffmpeg)
    except RuntimeError as exc:
        raise SystemExit(f'读不出时长：{exc}') from exc
    meta['durationSec'] = round(duration, 3)

    print(f'[2/5] 转写（时长 {duration:.0f}s）…', flush=True)
    segments, transcript_source, asr_label = resolve_transcript(
        media=source_media,
        subtitle=subtitle,
        work_dir=out_dir,
        model_size=args.model,
        proxy=args.proxy,
        force_asr=args.force_asr,
    )
    if not segments:
        print('没有拿到任何转写，无法切片。', file=sys.stderr)
        return 3
    write_transcript_jsonl(segments, out_dir / 'transcript.jsonl')
    meta['transcriptSource'] = transcript_source
    meta['asrModel'] = asr_label
    print(f'      {len(segments)} 段，来源 {transcript_source}', flush=True)

    print('[3/5] 切分纯讲解区间 …', flush=True)
    clips = segment_transcript(
        segments,
        max_clip_sec=args.max_minutes * 60,
        min_clip_sec=args.min_seconds,
        total_duration=duration,
    )
    if not clips:
        print('没有可导出的讲解片段（全片都是寒暄/题外话？）', file=sys.stderr)
        return 4
    print(f'      {summarize_clips(clips)}', flush=True)

    print('[4/5] 对齐知识点 …', flush=True)
    points = load_knowledge_points(args.database_url) if args.database_url else []
    if not points:
        print('      （没有加载到知识点：跳过对齐，clips.jsonl 里 alignments 为空）', flush=True)

    print('[5/5] 切片 + 写产物 …', flush=True)
    clips_dir = out_dir / 'clips'
    if clips_dir.exists():
        shutil.rmtree(clips_dir)
    clips_dir.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    for clip in clips:
        clip_id = f'{video_id}-c{clip.index + 1:02d}'
        clip_path = clips_dir / f'{clip_id}.mp4'
        expected = clip.end - clip.start
        try:
            actual = cut_clip(source_media, clip_path, clip.start, clip.end, ffmpeg=args.ffmpeg)
        except CutError as exc:
            print(f'      切片失败：{exc}', file=sys.stderr)
            return 5
        ok, why = check_clip_alignment(
            clip.start, clip.end, clip.segments[0].start, clip.segments[-1].end
        )
        alignments: list[Alignment] = align_clip(clip.text, points) if points else []
        rows.append(
            {
                'clipId': clip_id,
                'videoId': video_id,
                'index': clip.index,
                'startSec': round(clip.start, 3),
                'endSec': round(clip.end, 3),
                'durationSec': round(actual, 3),
                'expectedDurationSec': round(expected, 3),
                'alignmentOk': ok,
                'alignmentNote': why,
                'filePath': f'videos/{video_id}/clips/{clip_id}.mp4',
                'reason': clip.reason,
                'transcriptExcerpt': clip.transcript_excerpt(),
                'segmentCount': len(clip.segments),
                'firstSegmentStart': round(clip.segments[0].start, 3),
                'lastSegmentEnd': round(clip.segments[-1].end, 3),
                'droppedLeading': [
                    {'start': round(s.start, 3), 'text': s.text} for s in clip.dropped_before
                ],
                'alignments': [a.to_json() for a in alignments],
                'microKpIds': [a.micro_kp_id for a in alignments],
            }
        )
        print(
            f'      {clip_id}  {clip.start:7.1f}-{clip.end:7.1f}  {actual:6.1f}s  '
            f'{len(alignments)} 个知识点',
            flush=True,
        )

    meta['clipCount'] = len(rows)
    meta['maxClipSec'] = args.max_minutes * 60
    meta['generatedAt'] = _now_iso()
    (out_dir / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
    with (out_dir / 'clips.jsonl').open('w', encoding='utf-8') as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + '\n')

    print(f'\n完成：{out_dir}（{len(rows)} 片）', flush=True)
    unaligned = [r['clipId'] for r in rows if not r['microKpIds']]
    if unaligned:
        print(f'注意：{len(unaligned)} 片没有对齐到知识点：{unaligned}', flush=True)
    return 0


def cmd_segment_existing(args: argparse.Namespace) -> int:
    """只对已有目录重跑切片（不下载、不转写）。改切片参数时用这个。"""
    out_dir = Path(args.video_dir)
    transcript = out_dir / 'transcript.jsonl'
    if not transcript.exists():
        raise SystemExit(f'找不到转写：{transcript}')
    meta_path = out_dir / 'meta.json'
    meta = json.loads(meta_path.read_text(encoding='utf-8')) if meta_path.exists() else {}
    segments = read_transcript_jsonl(transcript)
    duration = float(meta.get('durationSec') or (segments[-1].end if segments else 0))
    clips = segment_transcript(
        segments,
        max_clip_sec=args.max_minutes * 60,
        min_clip_sec=args.min_seconds,
        total_duration=duration or None,
    )
    print(summarize_clips(clips))
    for clip in clips:
        print(f'  {clip.index + 1:02d} {clip.start:7.1f}-{clip.end:7.1f}  {clip.reason}')
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    out_dir = Path(args.video_dir)
    meta = json.loads((out_dir / 'meta.json').read_text(encoding='utf-8'))
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    clips_path = out_dir / 'clips.jsonl'
    if clips_path.exists():
        rows = [json.loads(line) for line in clips_path.read_text(encoding='utf-8').splitlines() if line.strip()]
        print(f'\n{len(rows)} 片：')
        for row in rows:
            print(
                f"  {row['clipId']}  {row['startSec']:.1f}-{row['endSec']:.1f}  "
                f"{row['durationSec']:.1f}s  kp={row['microKpIds']}"
            )
            print(f"    理由：{row['reason']}")
    return 0


def cmd_import(args: argparse.Namespace) -> int:
    """把 content/videos 下的 clips.jsonl 投影进数据库（幂等）。"""
    try:
        import psycopg  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover
        raise SystemExit('需要 psycopg3：python -m pip install psycopg[binary]') from exc

    content_dir = Path(args.content_dir)
    if not content_dir.exists():
        raise SystemExit(f'找不到目录：{content_dir}')

    manifest_rows: list[dict] = []
    for video_dir in sorted(p for p in content_dir.iterdir() if p.is_dir()):
        clips_path = video_dir / 'clips.jsonl'
        meta_path = video_dir / 'meta.json'
        if not clips_path.exists() or not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        for line in clips_path.read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            row['_meta'] = meta
            manifest_rows.append(row)

    if not manifest_rows:
        print('没有可导入的片段。')
        return 0

    sql_source = """
        INSERT INTO video_sources (video_id, source_url, title, duration_sec, uploader,
                                   license_or_channel, downloaded_at, asr_model,
                                   transcript_source, origin, note)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (video_id) DO UPDATE SET
            source_url = EXCLUDED.source_url,
            title = EXCLUDED.title,
            duration_sec = EXCLUDED.duration_sec,
            uploader = EXCLUDED.uploader,
            license_or_channel = EXCLUDED.license_or_channel,
            downloaded_at = EXCLUDED.downloaded_at,
            asr_model = EXCLUDED.asr_model,
            transcript_source = EXCLUDED.transcript_source,
            origin = EXCLUDED.origin,
            note = EXCLUDED.note
    """
    sql_clip = """
        INSERT INTO video_clips (id, video_id, micro_kp_id, title, start_sec, end_sec,
                                 duration_sec, file_path, transcript_excerpt, reason,
                                 alignment_evidence, downloaded_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            micro_kp_id = EXCLUDED.micro_kp_id,
            title = EXCLUDED.title,
            start_sec = EXCLUDED.start_sec,
            end_sec = EXCLUDED.end_sec,
            duration_sec = EXCLUDED.duration_sec,
            file_path = EXCLUDED.file_path,
            transcript_excerpt = EXCLUDED.transcript_excerpt,
            reason = EXCLUDED.reason,
            alignment_evidence = EXCLUDED.alignment_evidence,
            downloaded_at = EXCLUDED.downloaded_at
    """

    seen_sources: set[str] = set()
    with psycopg.connect(args.database_url, options='-c search_path=app,public') as conn:
        with conn.cursor() as cur:
            for row in manifest_rows:
                meta = row['_meta']
                video_id = meta.get('videoId') or row['videoId']
                if video_id not in seen_sources:
                    cur.execute(
                        sql_source,
                        (
                            video_id,
                            meta.get('sourceUrl') or '',
                            meta.get('title') or '',
                            float(meta.get('durationSec') or 0),
                            meta.get('uploader'),
                            meta.get('licenseOrChannel'),
                            meta.get('downloadedAt'),
                            meta.get('asrModel'),
                            meta.get('transcriptSource'),
                            meta.get('origin') or 'unknown',
                            meta.get('note'),
                        ),
                    )
                    seen_sources.add(video_id)
                primary = (row.get('alignments') or [{}])[0]
                cur.execute(
                    sql_clip,
                    (
                        row['clipId'],
                        video_id,
                        primary.get('microKpId'),
                        meta.get('title') or '',
                        float(row['startSec']),
                        float(row['endSec']),
                        float(row['durationSec']),
                        row['filePath'],
                        row.get('transcriptExcerpt'),
                        row.get('reason'),
                        json.dumps(row.get('alignments') or [], ensure_ascii=False),
                        meta.get('downloadedAt'),
                    ),
                )
        conn.commit()

    print(f'导入 {len(seen_sources)} 个视频、{len(manifest_rows)} 个片段。')
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description='课程视频：下载、转写、切片、对齐、导入')
    ap.add_argument('--proxy', default=DEFAULT_PROXY, help='HTTP 代理（faster-whisper 下载权重用）')
    ap.add_argument(
        '--ffmpeg',
        default=None,
        help='ffmpeg 可执行文件路径。不传则用 imageio-ffmpeg 自带的那一个',
    )
    ap.add_argument(
        '--database-url',
        default=None,
        help='读取知识点 / 导入产物用的连接串；不传则跳过对齐',
    )
    sub = ap.add_subparsers(dest='command', required=True)

    p = sub.add_parser('process', help='下载（或读本地文件）→ 转写 → 切片 → 对齐')
    p.add_argument('url', nargs='?', help='视频 URL（不给则必须给 --local-file）')
    p.add_argument('--local-file', help='本地视频文件（跳过下载）')
    p.add_argument('--video-id', help='本地文件用：产物目录名')
    p.add_argument('--title', help='本地文件用：标题')
    p.add_argument('--source-url', help='本地文件用：原始链接（不知道就留空，别编造）')
    p.add_argument('--uploader', help='本地文件用：频道/作者')
    p.add_argument('--note', help='本地文件用：来源说明')
    p.add_argument('--subtitle', help='现成字幕文件（.srt/.vtt），给了就不跑 ASR')
    p.add_argument('--force-asr', action='store_true', help='有字幕也强制跑 ASR')
    p.add_argument('--out', default='content/videos')
    p.add_argument('--model', default='small', help='faster-whisper 模型（tiny/base/small/medium）')
    p.add_argument('--max-minutes', type=int, default=6, help='单片最长分钟数（票面红线 6）')
    p.add_argument('--min-seconds', type=float, default=45, help='单片最短秒数（更短的并入前一片）')
    p.set_defaults(func=cmd_process)

    p = sub.add_parser('segment-existing', help='只对已有目录重跑切片')
    p.add_argument('video_dir')
    p.add_argument('--max-minutes', type=int, default=6)
    p.add_argument('--min-seconds', type=float, default=45)
    p.set_defaults(func=cmd_segment_existing)

    p = sub.add_parser('inspect', help='看已生成产物的元数据与片段')
    p.add_argument('video_dir')
    p.set_defaults(func=cmd_inspect)

    p = sub.add_parser('import', help='把 content/videos 的产物导入数据库')
    p.add_argument('--content-dir', default='content/videos')
    p.set_defaults(func=cmd_import)

    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == 'import' and not args.database_url:
        raise SystemExit('import 需要 --database-url')
    return int(args.func(args))


if __name__ == '__main__':
    raise SystemExit(main())
