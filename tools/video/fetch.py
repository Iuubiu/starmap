"""下载器封装：yt-dlp 调用 + 失败分类 + B 站 DNS 劫持绕过。

## 本机实测结论（票 19 调研，逐条验证过，别再重复踩）

### B 站
- **搜索接口 412**：`ytsearch`/`bilisearch` 走代理时被风控。**走直连（`--proxy ""`）
  就通** —— 2026-10 实测能列出 BV1VE411e7UP 的全部 37 个分 P。
- **纯音频流 `-f ba` 全部失败**：`mcdn.bilivideo.cn` 被本机 DNS 解析成 Clash 的
  假 IP `198.18.2.53`，SSL 握手失败。绕过办法是**先下视频轨 + 音频轨并让 yt-dlp
  自己合并**（`-f "bv*+ba/b"` 在直连下两路都能落到 `*.bilivideo.com` 的真 IP），
  或者退回 single-file（`-f b`，兼容性最好，画质差）。
  **失败时必须给出可操作提示**，不能静默返回空 —— 见 `ExplainFailure`。
- 合并需要 ffmpeg，而本机 ffmpeg 不在 PATH：**必须传 `--ffmpeg-location`**，
  否则 yt-dlp 找不到它会留下两个分离文件并在最后一步报错。

### YouTube
- **IP 级 bot 检查**：本机代理出口被 YouTube 判定为机器人。2026-10 实测 141 个
  候选视频（15 个主题的搜索 + 人工挑选的热门教育视频）全部报
  `Sign in to confirm you're not a bot`，只有极少数超热门视频（如 dQw4w9WgXcQ）能过。
  **这不是配置问题**，试过的无效方案记录在此，避免下一个人重复：
  `--extractor-args youtube:player_client=` 的 android / ios / mweb / tv / tv_embedded /
  web_embedded / web_safari / android_vr / tv_simply / web_creator / android_music /
  android_producer / ios_music / visionos 全部被拦；`--impersonate chrome` 无效；
  `--cookies-from-browser chrome` 因 Chrome 正在运行、cookie 库被独占而读不到；
  自建 Playwright 匿名会话导出 cookie 也无效（拿到的 cookie 里没有登录态）；
  bgutil PO Token provider（HTTP 模式，本地 4416 端口，能正常签发 token）注入后仍被拦；
  `has_verified=1`、`bpctr` 参数无效；Invidious / Piped / Cobalt 公共实例全部 401/403/502
  或返回 `SignInConfirmNotBotException`。
  **可行的出路**（写进提示里，供后续有登录态时使用）：
  `--cookies-from-browser <browser>`（先关掉浏览器）或 `--cookies cookies.txt`。
"""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from asr import ffmpeg_path

# ---------------------------------------------------------------------------
# 失败分类
# ---------------------------------------------------------------------------

FAILURE_KINDS = (
    'login_required',   # YouTube bot 检查 / 需要登录 / 会员专享
    'geo_blocked',      # 地区限制
    'not_found',        # 视频不存在 / 已删除 / 私享
    'dns_hijack',       # B 站音频 CDN 被本机 DNS 劫持（SSL 握手失败）
    'forbidden',        # 403
    'network',          # 代理不通、超时
    'rate_limited',     # 412 / 429
    'tool_missing',     # yt-dlp / ffmpeg 不存在
    'unknown',
)

# 每种失败给一句**可操作**的中文提示。这是票面「失败情形有明确原因分类与重试入口」
# 的落地：只报 `ERROR: ...` 不算分类。
FAILURE_HINTS: dict[str, str] = {
    'login_required': (
        'YouTube 要求证明「不是机器人」。可行方案：先完全退出浏览器，再运行 '
        '`yt-dlp --cookies-from-browser chrome <url>`；或从浏览器扩展导出 cookies.txt '
        '后传 `--cookies cookies.txt`。本机当前无登录态，PO Token / impersonate / '
        '各种 player_client 均已实测无效。'
    ),
    'geo_blocked': '该视频在当前出口地区不可用。换代理节点（例如换到该视频允许的地区）后重试。',
    'not_found': '视频不存在或已下架。确认 URL 拼写，或换一个视频。',
    'dns_hijack': (
        'B 站音频 CDN（mcdn.bilivideo.cn）被本机 DNS 解析成代理假 IP，SSL 握手失败。'
        '请把 `*.bilivideo.com`、`*.bilivideo.cn`、`upos-*.bilivideo.com` 加入 Clash 的'
        '直连（DIRECT）规则，或改用 `-f b`（single-file，绕开分离音轨）。'
    ),
    'forbidden': '源站返回 403。可能需要在同地区出口重试，或该视频限制了下载。',
    'network': '网络/代理不通。先 `curl -x http://127.0.0.1:7890 https://www.youtube.com/` 确认代理可用。',
    'rate_limited': '被风控限流（412/429）。B 站搜索接口尤其容易触发：改用直连 `--proxy ""` 重试。',
    'tool_missing': 'yt-dlp 或 ffmpeg 不在预期路径。检查 PATH 与 imageio-ffmpeg 安装。',
    'unknown': '未识别的失败。保留完整 stderr 供排查。',
}


def classify_failure(stderr: str) -> str:
    """从 yt-dlp 的 stderr 里判断失败类别。纯字符串判定，便于单测。"""
    text = (stderr or '').lower()
    if not text:
        return 'unknown'
    if 'sign in to confirm' in text or 'login_required' in text or 'use --cookies' in text:
        return 'login_required'
    if 'private video' in text or 'members-only' in text or 'join this channel' in text:
        return 'login_required'
    if 'not available in your country' in text or 'geo' in text and 'block' in text:
        return 'geo_blocked'
    if 'video unavailable' in text or 'does not exist' in text or 'has been removed' in text:
        return 'not_found'
    if 'ssl' in text and ('wrong version number' in text or 'certificate' in text or 'handshake' in text):
        return 'dns_hijack'
    if 'mcdn.bilivideo' in text or 'bilivideo' in text and 'ssl' in text:
        return 'dns_hijack'
    if '412' in text or '429' in text or 'too many requests' in text or 'precondition failed' in text:
        return 'rate_limited'
    if '403' in text or 'forbidden' in text:
        return 'forbidden'
    if 'timed out' in text or 'connection refused' in text or 'proxy' in text and 'error' in text:
        return 'network'
    if 'ffmpeg' in text and ('not found' in text or 'not installed' in text):
        return 'tool_missing'
    if 'command not found' in text or 'no such file or directory' in text:
        return 'tool_missing'
    return 'unknown'


@dataclass
class FetchFailure(Exception):
    """下载失败，带分类与可操作提示。"""

    kind: str
    message: str
    stderr: str = ''

    @property
    def hint(self) -> str:
        return FAILURE_HINTS.get(self.kind, FAILURE_HINTS['unknown'])

    def as_dict(self) -> dict:
        return {'kind': self.kind, 'message': self.message, 'hint': self.hint}


# ---------------------------------------------------------------------------
# yt-dlp 封装
# ---------------------------------------------------------------------------

YOUTUBE_PROXY = 'http://127.0.0.1:7890'
# B 站走直连：代理会让搜索接口 412，且音频 CDN 的 DNS 被代理污染。
BILIBILI_PROXY = ''


def _run_ytdlp(args: list[str], *, timeout: int = 900) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            ['yt-dlp', *args],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise FetchFailure('tool_missing', '找不到 yt-dlp 命令', str(exc)) from exc


def proxy_for(url: str) -> str:
    """按站点选代理：B 站直连，其余走代理。"""
    if 'bilibili.com' in url or url.startswith('BV'):
        return BILIBILI_PROXY
    return YOUTUBE_PROXY


@dataclass
class VideoMeta:
    """下载前的元数据（可追溯字段的来源）。"""

    url: str
    video_id: str
    title: str
    duration_sec: float
    uploader: str | None = None
    subtitle_langs: list[str] = field(default_factory=list)
    automatic_caption_langs: list[str] = field(default_factory=list)
    webpage_url: str | None = None
    raw: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            'sourceUrl': self.webpage_url or self.url,
            'videoId': self.video_id,
            'title': self.title,
            'durationSec': round(self.duration_sec, 3),
            'uploader': self.uploader,
            'subtitleLangs': self.subtitle_langs,
            'automaticCaptionLangs': self.automatic_caption_langs,
        }


def probe_video(url: str, *, timeout: int = 120) -> VideoMeta:
    """读元数据（不下载）。失败抛 FetchFailure。"""
    proxy = proxy_for(url)
    args = ['--no-warnings', '--skip-download', '--dump-single-json']
    if proxy:
        args += ['--proxy', proxy]
    else:
        args += ['--proxy', '']
    proc = _run_ytdlp([*args, url], timeout=timeout)
    if proc.returncode != 0:
        kind = classify_failure(proc.stderr)
        raise FetchFailure(kind, f'读元数据失败（{kind}）', proc.stderr)
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise FetchFailure('unknown', '元数据不是合法 JSON', proc.stdout[:500]) from exc

    subs = data.get('subtitles') or {}
    autos = data.get('automatic_captions') or {}
    return VideoMeta(
        url=url,
        video_id=data.get('id', ''),
        title=data.get('title') or '',
        duration_sec=float(data.get('duration') or 0),
        uploader=data.get('uploader'),
        subtitle_langs=sorted(subs.keys()),
        automatic_caption_langs=sorted(autos.keys()),
        webpage_url=data.get('webpage_url'),
        raw={k: data.get(k) for k in ('id', 'title', 'duration', 'uploader', 'webpage_url')},
    )


@dataclass
class DownloadResult:
    meta: VideoMeta
    media_path: Path
    subtitle_path: Path | None
    log: str


def download(
    url: str,
    out_dir: Path,
    *,
    max_height: int = 720,
    want_subtitles: bool = True,
    ffmpeg: str | None = None,
    timeout: int = 1800,
) -> DownloadResult:
    """下载视频 + 字幕到 out_dir。

    ## 格式选择

    `bv*[height<=N]+ba/b[height<=N]/b`：
    - 优先「视频轨 + 音频轨」分下再合并（音质/画质都最好）；
    - 退到 single-file（B 站音频 CDN 被墙时这条路能过）；
    - 最后不限高度的 single-file（保底：宁可糊也要有）。

    ## 字幕

    `--write-subs --write-auto-subs --sub-langs "zh.*,en.*,zh-CN,zh-Hans" --convert-subs srt`。
    优先人工字幕；没有人工字幕时 yt-dlp 会写自动字幕。**都不存在时不报错** ——
    调用方看到 `subtitle_path is None` 就转 faster-whisper。
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = probe_video(url)

    proxy = proxy_for(url)
    args = [
        '--no-warnings',
        '-f', f'bv*[height<={max_height}]+ba/b[height<={max_height}]/b',
        '--ffmpeg-location', ffmpeg_path(ffmpeg),
        '-o', str(out_dir / 'source.%(ext)s'),
        '--print', 'after_move:FILENAME=%(filepath)s',
    ]
    args += ['--proxy', proxy] if proxy else ['--proxy', '']

    if want_subtitles:
        args += [
            '--write-subs', '--write-auto-subs',
            '--sub-langs', 'zh.*,zh-CN,zh-Hans,zh,en.*',
            '--convert-subs', 'srt',
            '--skip-download' if False else '--no-overwrites',
        ]

    proc = _run_ytdlp([*args, url], timeout=timeout)
    if proc.returncode != 0:
        kind = classify_failure(proc.stderr)
        raise FetchFailure(kind, f'下载失败（{kind}）', proc.stderr)

    media = _find_media(out_dir)
    if media is None:
        # 下载命令成功但没有产物：几乎总是 ffmpeg 合并失败留下的分离文件
        leftovers = sorted(p.name for p in out_dir.glob('source.*'))
        raise FetchFailure(
            'tool_missing',
            f'下载结束但找不到合并后的媒体文件（目录里有：{leftovers}）。'
            '多半是 ffmpeg 不可用导致合并失败 —— 检查 --ffmpeg-location。',
            proc.stderr,
        )

    subtitle = _find_subtitle(out_dir)
    return DownloadResult(meta=meta, media_path=media, subtitle_path=subtitle, log=proc.stderr)


def _find_media(out_dir: Path) -> Path | None:
    """找合并后的媒体文件。排除 `.part`/`.ytdl`/字幕/中间分离轨。"""
    candidates = [
        p for p in out_dir.glob('source.*')
        if p.suffix.lower() in {'.mp4', '.mkv', '.webm', '.flv'}
        and '.f' not in p.stem  # yt-dlp 的分离轨命名形如 source.f137.mp4
    ]
    if not candidates:
        return None
    # 最大的是合并后的成品
    return max(candidates, key=lambda p: p.stat().st_size)


def _find_subtitle(out_dir: Path) -> Path | None:
    subs = sorted(out_dir.glob('source*.srt'))
    if not subs:
        subs = sorted(out_dir.glob('source*.vtt'))
    if not subs:
        return None
    # 优先中文
    for sub in subs:
        if 'zh' in sub.name.lower() or 'chi' in sub.name.lower():
            return sub
    return subs[0]


def search(query: str, *, limit: int = 10, site: str = 'youtube') -> list[dict]:
    """搜视频（只返回 id/时长/标题，不下载）。

    B 站搜索必须走直连；YouTube 走代理。失败抛 FetchFailure。
    """
    prefix = 'bilisearch' if site == 'bilibili' else 'ytsearch'
    url = f'{prefix}{limit}:{query}'
    proxy = BILIBILI_PROXY if site == 'bilibili' else YOUTUBE_PROXY
    args = ['--no-warnings', '--flat-playlist', '--print', '%(id)s\t%(duration)s\t%(title)s']
    args += ['--proxy', proxy] if proxy else ['--proxy', '']
    proc = _run_ytdlp([*args, url], timeout=180)
    if proc.returncode != 0:
        kind = classify_failure(proc.stderr)
        raise FetchFailure(kind, f'搜索失败（{kind}）', proc.stderr)
    rows: list[dict] = []
    for line in proc.stdout.splitlines():
        parts = line.split('\t')
        if len(parts) < 3:
            continue
        vid, dur, title = parts[0], parts[1], parts[2]
        try:
            duration = float(dur)
        except ValueError:
            duration = 0.0
        rows.append({'id': vid, 'durationSec': duration, 'title': title})
    return rows


__all__ = [
    'FAILURE_KINDS',
    'FAILURE_HINTS',
    'FetchFailure',
    'VideoMeta',
    'DownloadResult',
    'classify_failure',
    'probe_video',
    'download',
    'search',
    'proxy_for',
    'YOUTUBE_PROXY',
    'BILIBILI_PROXY',
    're',
]
