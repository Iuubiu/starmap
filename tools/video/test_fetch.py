"""fetch.py 的单元测试：失败分类 + 代理路由。

分类函数的判据来自真实 stderr（每一条都是从本机实测里抄下来的），
不是凭空写的正则 —— 所以它能在下次踩到同一堵墙时直接认出来。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fetch import (
    BILIBILI_PROXY,
    FAILURE_HINTS,
    FAILURE_KINDS,
    YOUTUBE_PROXY,
    FetchFailure,
    classify_failure,
    proxy_for,
)

# 真实 stderr 样本（本机 2026-10 实测）
SIGN_IN_TO_CONFIRM = """ERROR: [youtube] SFrjGOpV8yk: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies."""
SSL_WRONG_VERSION = """ERROR: unable to download video data: [SSL: WRONG_VERSION_NUMBER] wrong version number (_ssl.c:1010)"""
SSL_HANDSHAKE = """ERROR: unable to download video data: <urlopen error [SSL: SSLV3_ALERT_HANDSHAKE_FAILURE] sslv3 alert handshake failure>"""
HTTP_412 = """ERROR: [BiliBiliSearch] 412: Precondition Failed"""
HTTP_403 = """ERROR: unable to download JSON metadata: HTTP Error 403: Forbidden"""
VIDEO_UNAVAILABLE = """ERROR: [youtube] dQw4w9WgXcQ: Video unavailable"""
FFMPEG_MISSING = """ERROR: You have requested merging of multiple formats but ffmpeg is not installed. Aborting due to --abort-on-error"""


class TestClassifyFailure:
    def test_youtube_bot_check_is_login_required(self):
        assert classify_failure(SIGN_IN_TO_CONFIRM) == 'login_required'

    def test_ssl_wrong_version_is_dns_hijack(self):
        assert classify_failure(SSL_WRONG_VERSION) == 'dns_hijack'

    def test_ssl_handshake_is_dns_hijack(self):
        assert classify_failure(SSL_HANDSHAKE) == 'dns_hijack'

    def test_412_is_rate_limited(self):
        assert classify_failure(HTTP_412) == 'rate_limited'

    def test_403_is_forbidden(self):
        assert classify_failure(HTTP_403) == 'forbidden'

    def test_unavailable_is_not_found(self):
        assert classify_failure(VIDEO_UNAVAILABLE) == 'not_found'

    def test_ffmpeg_missing_is_tool_missing(self):
        assert classify_failure(FFMPEG_MISSING) == 'tool_missing'

    def test_empty_is_unknown(self):
        assert classify_failure('') == 'unknown'

    def test_every_kind_has_a_hint(self):
        """每一种失败都要有可操作提示 —— 只报错不算「可操作」。"""
        for kind in FAILURE_KINDS:
            assert kind in FAILURE_HINTS, f'{kind} 缺少提示文案'
            assert len(FAILURE_HINTS[kind]) >= 15, f'{kind} 的提示太短，不构成可操作建议'


class TestProxyRouting:
    def test_bilibili_goes_direct(self):
        assert proxy_for('https://www.bilibili.com/video/BV1VE411e7UP') == BILIBILI_PROXY
        assert BILIBILI_PROXY == ''

    def test_youtube_goes_through_proxy(self):
        assert proxy_for('https://www.youtube.com/watch?v=x') == YOUTUBE_PROXY
        assert YOUTUBE_PROXY.startswith('http://')


class TestFetchFailure:
    def test_as_dict_includes_hint(self):
        failure = FetchFailure('dns_hijack', '下载失败')
        payload = failure.as_dict()
        assert payload['kind'] == 'dns_hijack'
        assert 'bilivideo' in payload['hint']
        assert '直连' in payload['hint']

    def test_is_exception(self):
        assert issubclass(FetchFailure, Exception)

    def test_unknown_kind_falls_back(self):
        failure = FetchFailure('something_new', 'x')
        assert failure.hint == FAILURE_HINTS['unknown']
