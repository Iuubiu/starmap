# 课程视频管线（票 19）

从 B 站 / YouTube 下载核电子学公开课，切成 **≤6 分钟的纯讲解区间**，按知识点名对齐，
导入数据库后在关卡页的「看讲解」面板里播放。

```
tools/video/
  fetch.py    yt-dlp 封装：探元数据、下载、失败分类与可操作提示
  asr.py      字幕优先（SRT/WebVTT/json3），无字幕才用 faster-whisper 本地转写
  segment.py  纯函数：按转写文本判定讲解区间并切片（含寒暄/题外话/结束语判定）
  align.py    纯函数：把片段对到 knowledge_points.name 上，记命中依据
  clip.py     ffmpeg 精确切片 + 切完回读时长校验
  run.py      入口：process / segment-existing / inspect / import
  test_*.py   50 条单测（pytest）
```

## 快速上手

```bash
# 下载 → 转写 → 切片 → 对齐（产物落 content/videos/<videoId>/）
python tools/video/run.py process "https://www.bilibili.com/video/BV1VE411e7UP?p=9" \
  --out content/videos --model small

# 只切已有转写
python tools/video/run.py segment-existing content/videos/BV1VE411e7UP_p9 --max-minutes 6

# 导入数据库（幂等，重复跑不会出重复行）
python tools/video/run.py import --content-dir content/videos --database-url "$DATABASE_URL"
```

产物布局：

```
content/videos/<videoId>/
  meta.json          来源与可追溯字段（原始链接、时长、下载时间、频道、ASR 模型）
  transcript.jsonl   带时间戳的转写（每行一个 segment）
  clips/<clipId>.mp4 片段（.gitignore 忽略，可再生）
  clips.jsonl        片段元数据（起止、时长、对齐、可读切分理由）
```

`meta.json` 与 `clips.jsonl` **必须入库**（票面第 7 条可追溯）；mp4 与 wav 被
`content/videos/.gitignore` 忽略 —— 13 个片段约 90 MB，而且用同样的源视频与转写
重跑就能再生。这条分界写在该 `.gitignore` 的注释里。

## 本机环境（踩过的坑，别重复）

**ffmpeg 不在 PATH。** 用 imageio-ffmpeg：

```bash
python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
# → ...\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe
```

`asr.py` 的 `ffmpeg_path()` 会自动找它（explicit 参数 > imageio-ffmpeg > `ffmpeg`）。
不要 `choco install ffmpeg`。

**ffprobe 也不在 PATH。** `asr.probe_duration()` 解析 `ffmpeg -i` 的 stderr 里的
`Duration:` 行，不依赖 ffprobe。

**PyAV 19 与 faster-whisper 1.2.1 不兼容。** `faster_whisper/audio.py` 调
`av.open(..., metadata_errors="ignore")`，本机 av 19.0.1 已移除该参数，报
`TypeError: open() got an unexpected keyword argument 'metadata_errors'`。
`asr.load_audio_array()` 因此**完全绕开 PyAV**：用 ffmpeg 把音频解成
float32 PCM 到 stdout，再 `np.frombuffer` 交给 `model.transcribe()`。改这条路径
之前先确认 PyAV 版本。

## B 站：DNS 劫持与本机绕过方案

本机（Clash 代理环境）把 `mcdn.bilivideo.cn` 解析成代理假 IP `198.18.2.53`，
导致 B 站的**纯音频流**（`-f ba`）SSL 握手失败：

```
ERROR: unable to download video data: [SSL: WRONG_VERSION_NUMBER] wrong version number
```

绕过方案**已实现在 `fetch.py` 里**：B 站一律**直连**（`BILIBILI_PROXY = ''`，
即 `yt-dlp --proxy ""`），YouTube 才走代理（`YOUTUBE_PROXY`）。`proxy_for(url)`
按域名返回。直连后搜索、元数据、音视频下载全通。

同时下载格式退化为 `-f "bv*[height<=720]+ba/b[height<=720]/b"`：DASH 双流拿不到时
自动退到 single-file（含音轨），这条是 `-f` 表达式的 `/` 兜底，不是额外逻辑。

**失败时不静默。** `fetch.classify_failure()` 把 stderr 归到 8 类之一
（`login_required` / `geo_blocked` / `not_found` / `dns_hijack` / `forbidden` /
`network` / `rate_limited` / `tool_missing` / `unknown`），每类在 `FAILURE_HINTS`
里有一句可操作中文提示。`dns_hijack` 的提示是：

> B 站音频/视频 CDN 被本机 DNS 劫持（解析到代理假 IP）。把 `*.bilivideo.com`、
> `*.bilivideo.cn`、`upos-*.bilivideo.com` 加进 Clash 的直连规则，或改用
> `--proxy ""` 直连。

`FetchFailure.as_dict()` 输出 `{kind, message, hint, stderr}`，跑批时可以按 `kind`
聚合失败原因。

## YouTube：本机拿不到（已实测穷举）

**141/141 个候选视频全部被 `Sign in to confirm you're not a bot` 拦下。**
试过并全部无效：

- 14 种 `--extractor-args youtube:player_client=`（android / ios / mweb / tv /
  tv_embedded / web_embedded / web_safari / android_vr / tv_simply / web_creator /
  android_music / android_producer / ios_music / visionos）
- `--impersonate chrome`
- 自建 bgutil PO Token provider（能正常签发 124 字节 token，注入后仍被拦）
- `has_verified=1`、`bpctr=9999999999`
- Playwright 匿名会话导出的 cookie（无登录态）
- Invidious / Piped / Cobalt 公共实例（401 / 403 / 502 / `SignInConfirmNotBotException` /
  `error.api.auth.jwt.missing`）

唯一能过的是极少数超热门视频，说明出口 IP 在风控名单里、按视频等级放行，不是纯 IP 封。

**唯一出路是有登录态的 cookies**：

```bash
# 先完全退出浏览器（cookie 库被独占时会报 "Could not copy Chrome cookie database"）
python tools/video/run.py process <url> --cookies-from-browser chrome
# 或导出的 cookies.txt
python tools/video/run.py process <url> --cookies cookies.txt
```

`fetch.classify_failure()` 对这类 stderr 归到 `login_required`，提示用户先登录。

**票面第 1 条「B 站与 YouTube 各至少成功下载 1 个」在本机只完成了 B 站那一半。**
YouTube 侧受环境限制（需要登录态），代码路径与失败分类已完成并测过
（`test_fetch.py` 用真实 stderr 样本覆盖 `SIGN_IN_TO_CONFIRM` 等情形）。

## 切片判据（票面第 3 条）

`segment.py` 是**纯函数**，输入 `list[Segment]`，输出 `list[Clip]`，不碰文件系统。

1. **分类**：每条 segment 归为 `greeting` / `tangent` / `outro` / `lecture`。
   - `greeting` 只在**片段开头 20 秒内**才算（`GREETING_WINDOW_SEC`）——「大家好」
     出现在 5 分钟处是正文，不是开场白。
   - `tangent`（点赞投币、休息一下、弹幕、广告）与位置无关。
   - 正则表见 `GREETING_PATTERNS` / `OUTRO_PATTERNS` / `TANGENT_PATTERNS`，
     其中有若干条是从真实语料里补的（「好的 我们现在开始上课」「那么由我给大家上」
     「我是张雪梅」「这是我的email地址」）。
2. **聚合成 run**：只按**长停顿**（`gap >= TOPIC_PAUSE_SEC = 1.6s`）分段，不按固定时长。
3. **每 run 按 `max_clip_sec`（默认 360s）细分**，优先在**话题转折词**处下刀
   （`TOPIC_SHIFT_PATTERNS`：接下来/下面/首先/第二个…）。
4. **过短的相邻 run 合并**（`MIN_CLIP_SEC = 45`）。
5. 每片写 `reason`：**为什么从这里开始、为什么在这里结束**，用人类可读的中文，
   并列出被丢掉的寒暄/题外话。

`test_segment.py` 20 条用例覆盖：纯讲解整段不裁、开头寒暄被裁（证明不是恒等函数）、
结尾结束语被裁、题外话被丢、30 分钟切 ≥5 片且全 ≤6 分钟、切点落在 segment 边界、
**`abs((end-start) - (last_seg.end - first_seg.start)) < 0.5`**（票面第 5 条）、
无重叠且升序、空输入、全是寒暄返回空。

## 对齐（票面第 4 条）

`align.py` 用 `knowledge_points.name` 做子串匹配，规则：

- **长名字优先 + 掩码**：命中「电荷灵敏前置放大器的主要特性」后把它从文本里挖掉，
  避免短名「前置放大器」在同一段文字上重复计分。
- `score = len(name) * hits`，默认阈值 `MIN_SCORE = 6.0`，最多取 3 个。
- 排除容器名（小结/习题/思考题/目录/前言/附录…）与长度 < 3 的名字。
- 只匹配**叶节点**（`is_leaf = true`）。

每条对齐都带 `evidence`（如「命中知识点名「前置放大器」6 次（5 字）」），
存进 `video_clips.alignment_evidence`，页面也能显示 —— 这是「对齐可复核」的实现。

`run.py import` 只取 `alignments[0]` 作为 `micro_kp_id`（主归属），其余留在
`alignment_evidence` 里。

## 数据库与 HTTP

迁移 `apps/api/migrations/0050_video_clips.sql`：

- `app.video_sources`（`video_id` PK，来源 URL、标题、时长、上传者、下载时间、ASR 模型、
  `origin` ∈ `yt-dlp|local-file|unknown`）
- `app.video_clips`（`id` PK，`video_id` FK **CASCADE**，`micro_kp_id` FK
  **`ON DELETE SET NULL`** —— 项目已有 11 条指向 `knowledge_points` 的 CASCADE 教训，
  删知识点不该带走视频片段；`CHECK (end_sec - start_sec <= 360)` 在数据库层兜住
  「≤6 分钟」这条红线）

接口（`apps/api/src/video/`）：

| 路由 | 用途 |
| --- | --- |
| `GET /api/v1/video/clips?microKpId=` | 按知识点查片段（内容作者自查） |
| `GET /api/v1/levels/{levelId}/video-clips` | 关卡页用（先查关卡的 micro_kp_id） |
| `GET /media/clips/{clipId}` | 流式吐 mp4，支持 Range（200 / 206 / 416） |

**`app.module.ts` 不改** —— controller 自己 `new VideoService(db)`，与
`MarketController` / `GenerationController` 同一取舍（providers 是多人合并点）。

`VideoController` 需要在 `apps/api/src/domains.ts` 的 `domainControllers` 里登记一行。

### 为什么静态路由是手写的而不是 `ServeStatic`

只服务 `content/videos/*/clips/*.mp4` 一类文件，且**必须支持 Range**（浏览器拖进度条）。
`StreamableFile` + 手写 `parseRange()` 只有 40 行，而 `@nestjs/serve-static` 要加依赖、
还要处理根目录与 `file_path` 的相对关系。手写版把「片段不存在」与「文件不在盘上」
分成两种 404 文案（后者提示重跑 `tools/video/run.py`）。

### Vite 开发代理必须带 `/media`

`apps/web/vite.config.ts` 的 `server.proxy` 原本只代理 `/api`。`<video src="/media/clips/...">`
是相对路径（captain 定下的约定，不写死 `http://127.0.0.1:3001`），所以浏览器会打到
Vite 的 5173 → 404。已加 `'/media'` 到同一份 proxy 配置。

**症状特别难查**：`curl http://127.0.0.1:3001/media/clips/<id>` 是 200，但页面里
`<video>` 的 `readyState` 永远是 0。Playwright 用例
（`apps/web/e2e/video-panel.spec.ts`）现在守着这条。

## 跑测

```bash
python -m pytest tools/video -q                    # 50 条纯函数单测
cd apps/api && npx vitest run src/video            # 22 条（10 单测 + 12 集成，连真库）
cd apps/web && npx playwright test video-panel.spec.ts \
  --output=../../.scratch/pw-authoring-video       # 3 条真浏览器
```

`apps/web/e2e/video-panel.spec.ts` 会先 `GET /api/v1/market/levels` 找一个「挂了视频」
的关卡和一个「没挂视频」的关卡；找不到就 `test.skip`（环境事实，不让 e2e 变成偶然失败）。

## 已知缺口：教材插图未接通（不在票 19 范围）

`content/*/ocr/figures/*.png` 有 **3529 张 / 171 MB**（git 跟踪 339 张），**零消费方**：

1. **入库那一步把链断了**：`tools/ingest/ocr.py` 的 `crop_figures()` 切了图、
   `ocr/figures.jsonl` 记了 `{page, index, image, bbox, caption, chunkId}`，但
   `apps/api/scripts/import-content.ts:343-348` 写 chunk meta 时只有
   `{pdfPage, bbox, headingPath, tableRows}`，不含任何图片路径。
2. **API 没有插图静态路由**：`/media/` 下目前只有 `clips/`。
3. **前端没有 `<img>`**：`apps/web/src/**/*.tsx` 里 `<img` / `<Image` 0 命中。

三件事任缺一件都是死代码，且 171 MB 二进制怎么进仓库/怎么部署还没决策。

**未来放在哪套机制上**：建议**共用同一套 `/media/*`** —— `video_clips.file_path`
已经是「相对仓库 `content/` 的路径」，插图可以照抄这个形状（`content/<book>/ocr/figures/x.png`
→ `/media/figures/<book>/<file>`）。`VideoService.resolveClipPath()` 里已经有
「`resolve()` 后前缀越界检查」，抽成通用的 `contentPath()` 就能同时守住两条路。
不建议再起一套 `/static` 或 `ServeStatic`，否则 Range 与路径安全的处理会有两份。

## 本机已验证的真实产物

| 视频 | 时长 | 片段 | 对齐 |
| --- | --- | --- | --- |
| `BV1VE411e7UP_p1`（核电子学 37 讲 p01 绪论） | 1877.65s | 6 片，最长 358.36s | 1 片对齐 `kp-chenboxian-2011-3-1` |
| `BV1VE411e7UP_p9`（p09 前置放大器（1）） | 1993.68s | 7 片，最长 358.94s | 6 片对齐（5 片到 `kp-jichangsong-1990-11-8`） |

全 13 片：**超过 6 分钟的 0 条**，最大 359.32s。
`video_sources` 2 行、`video_clips` 13 行（7 行有 `micro_kp_id`）。

为端到端验证「关卡页能调出播放」，用票 16 的生成接口在 `kp-jichangsong-1990-11-8`
（前置放大器）上生成了一关 `lv-ai-kp-jichangsong-1990-11-8`，它有 5 片讲解可看。
这是**唯一**「关卡的知识点挂了视频」的组合 —— 其余 7 关的知识点（电离室、中子探测、
碲锌镉探测器、放射性衰变等）与现有两集视频不重合。

## 已知的验证边界

这两条不是「待办」，是**当前环境里验不到**的部分。写在这里是为了让读的人
不用重新调查一遍，也不会把「没验」误读成「已验」。

### 1. YouTube 侧只验了代码路径，没验成功下载

`141/141` 个候选视频全部被 `Sign in to confirm you're not a bot` 拦下
（探测方式：15 个主题 × `ytsearch20`，10 并发）。试过并全部无效的清单见上面
「YouTube：本机拿不到（已实测穷举）」一节。

**这是出口 IP 的风控，不是代码缺陷**：`fetch.download()` 的参数透传、失败分类、
提示文案都有测试覆盖（`test_fetch.py` 用真实 stderr 样本覆盖
`SIGN_IN_TO_CONFIRM` / `SSL_WRONG_VERSION` / `HTTP_412` / `HTTP_403` 等情形）。
本机唯一能验的是 B 站那半边 —— 已验到「下载 → 转写 → 切片 → 对齐 → 入库 → 页面播放」全链路。

要补上 YouTube 那一半，需要：有登录态的浏览器（`--cookies-from-browser`，且**先完全退出浏览器**，
否则 Chrome 的 cookie 库被独占会报 `Could not copy Chrome cookie database`）
或导出的 `cookies.txt`。

### 2. 教材插图链路未接通

`content/*/ocr/figures/*.png` 有 **3529 张 / 171 MB**（git 跟踪 339 张），**零消费方**。
三个环节分别缺什么、以及「未来应该共用同一套 `/media/*`」的论证见上面
「已知缺口：教材插图未接通」一节。

简单说：视频这条链是通的（`app.video_clips.file_path` → `/media/clips/<id>` →
`<video>`），插图那条链一节都没接。**不要把「视频能播」当成「插图也能显示」。**

### 3. 本机验过的范围

| 环节 | 状态 |
| --- | --- |
| B 站下载（3 集，31–33 分钟） | 已验，真实产物在 `content/videos/` |
| YouTube 下载 | **未验**（需登录态 cookies） |
| faster-whisper 转写（3 集，无字幕） | 已验，`transcript.jsonl` 带时间戳 |
| 纯讲解区间切片（13 片，全部 ≤6 分钟） | 已验，每片有可读理由 |
| 知识点对齐（7/13 片） | 已验，`alignment_evidence` 有命中记录 |
| 入库（`video_sources` 2 / `video_clips` 13） | 已验 |
| HTTP 播放（200 / 206 / 416） | 已验（`curl` + Playwright 双证） |
| 关卡页 `<video>` 真解码 | 已验（Playwright，`readyState >= 2`） |
| `/media` 路径越界防护 | 已验（`paths.test.ts` 8 条） |
| 教材插图显示 | **未接通**（见上） |
