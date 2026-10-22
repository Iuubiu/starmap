# session-55c776d2 修复日志

- 目标会话：`session-55c776d2-6df9-450c-abcf-db3fe6001ef9`（团队 `starmap-build` 队长，标题 *Set up Matt Pocock skills*）
- 日志文件：`C:\Users\Yhwhy\.dsh\sessions\--D-DeepSeek-starmap--\session-55c776d2-6df9-450c-abcf-db3fe6001ef9\session.v4.jsonl.zstd`
- 状态：**已修复，用户验收「点击继续能够正常对话」（2026-10-22 17:52 本地）**

## 1. 最初症状

- 上游 400 `prompt is too long: 4529917 tokens > 1048576 maximum`（后续 4,991,338 / 4,991,409 / 4,991,885）。
- 代理前置保险丝 413 `preflight_compress_failed`：`payload core text alone is ~15,641,854 bytes … ≥ ~2,092,621 tokens vs the model window 1000000`，请求未上送。
- 该会话给模型的正文合计 **20.69 MB**（assistant/message 12.71 MB，其中 reasoning 7.39 MB；tool/result 7.10 MB），约 200–400 万 token。
- bili 状态库记录：15,132 条 message、`contextTokens` 13.5 M、`lastInputTokens` 4.1 M —— 压缩几乎没生效。
- 当时 billion-context 为 0.1.202（重试/切模型后丢压缩状态，把整段历史裸发）。

## 2. 三次修复与三个根因

### 根因 A：正文体量超窗
- 脚本 `.scratch/session_trim.mjs` 按 `KEEP_FROM_TURN=61` 折叠 turn 1–60：
  assistant `reasoning` → `[本轮推理已折叠：原 N 字符]`；`tool-call` arguments → `{}`；assistant text 截断 1200 字符；`tool/result` 文本 → `[旧轮次工具输出已折叠]`；user 文本截断 2000（source.kind ≠ 'user' 的通知类 300）。
- 结果：正文 20.69 MB → **1.55 MB**，文件 26,445,153 B → 13,025,295 B。

### 根因 B：整份日志被压成 1 个 zstd 帧 → 侧边栏找不到会话
- DSH 读取路径 `readFirstZstdLine()` 分 8192 字节读首帧，再 `assertZstdHeaderFrame()`：
  `if (plaintext.indexOf(10) !== plaintext.length - 1) throw new Error("corrupt Zstandard session log: first frame is not exactly one header line")`
  —— **首帧必须恰好一行 header**。整份压成一帧必然失败，会话被静默从列表丢弃（文件与 workspace.json 都正常）。
- 脚本 `.scratch/session_reframe.mjs` 按原始备份的 16,316 帧行数 profile 逐帧重建（每帧 `ZSTD_c_checksumFlag=1`），首帧只放 header。
- 结果：frames=16316、lines=27814、badJson=0、seqBreaks=0；文件 13,025,295 B → 23,246,430 B（帧变小、压缩率下降，但发给模型的正文不变）。

### 根因 C：UTF-8 被按 64 KB chunk 解码 → tool-call 参数两份副本不再全等
- 报错原文：`历史加载失败：stored session "session-55c776d2-…" is corrupt: … SessionFormatError: tool/call call_00_tatCwnREQCqNKy7mh34v9045 does not match one advertised tool call`
- 校验点 `@deepseek-ai/dsh-session-format-v3-to-v4/lib/index.js:644`：
  `if (pending.started || pending.name !== data["name"] || pending.arguments !== data["arguments"]) throw new SessionFormatError(…)`
  —— assistant/message 的 `tool-call` 块与 `tool/call` 事件里的 arguments 必须**字符串全等**。
- 实测：ORIGINAL 两份都是 7945 字符且相等；损坏版块 7945 / 事件 **7947**，差异处 `反常：` → `反常` + U+FFFD（流式解压 + `c.toString('utf8')` 逐 chunk 拼接把多字节字符劈开）。
- 脚本 `.scratch/session_trim2.mjs`：从**原始备份**出发，按帧整段 `zstdDecompressSync().toString('utf8')` 解码 → 逐行 JSON → 修剪 → 按原 frameLines 重新分帧压缩；tool-call 参数在**块与事件两处同时**置 `{}`。
  参数：`frames=16316 lines=27814 firstFrameLines=1`、advertised=5175 / calls=5175、trimmed ids=5041、changed=15124、`badJson=0 seqBreaks=0 badToolCalls=0 orphanCalls=0`（replacementChars=18 为原始文件本就存在）。

## 3. 落盘方式（Windows 注意）

- `fs.renameSync` 覆盖该日志报 **EPERM**（有进程持有句柄且不带 FILE_SHARE_DELETE），重试 3 次均失败。
- 实际路径：`fs.writeFileSync(TMP)` → `fs.copyFileSync(TMP, SRC)` → `fs.unlinkSync(TMP)`。

## 4. 真校验器（可复用）

- `D:\DeepSeek\starmap\.scratch\asar_x\validate.mjs`：从 app.asar 提取的官方包做逐行 `assertV4RowAdmission(row, KNOWN_SESSION_EVENT_TYPES)`，再 `assertReleasedV4Relationships({header, events, inheritedEventCount:0}, …)`。
- 依赖补齐靠 `.scratch/mklink.mjs` 建 junction 农场 + `.scratch/dep_loop.sh` 循环提取缺失 `@deepseek-ai/*` 包。

**最新一次校验（2026-10-22T09:52Z，日志已被 DSH 继续追加到 34,059,209 B）**：

```
rows=41556  knownTypes=62
admission failures=0
RELATIONSHIPS: PASS (no throw)
```

说明修复后的日志持续被正常追加，关系约束仍成立。

## 5. 备份与回滚

- 原始未动副本：`.scratch/session-backup/session-55c776d2.v4.jsonl.zstd`（26,445,153 B，16,316 帧）——所有重建都从它出发。
- 坏的单帧中间版本：`.scratch/session-backup/session-55c776d2.singleframe.zstd`（13,025,295 B）。
- 回滚：把备份 `copyFileSync` 覆盖回原路径（仍需在 DSH 未持有句柄时操作）。

## 6. 防复发

- billion-context 已升到 **0.1.204**（0.1.202 → 0.1.203 修复「重试不带会话身份 → 压缩状态丢失、整段历史裸发」与「超窗保险丝」；0.1.204 为当前运行版，pid 变化见 `~/.local/state/billion-context/bili.log`）。
- 升级后必须**完全退出 DSH** 再启动才会加载新插件。
- 若再遇超窗，可把 `session_trim2.mjs` 的 `KEEP_FROM_TURN` 从 61 调到 62 重跑（再省约 0.6 MB），仍然从原始备份出发。

## 7. 环境教训（一次性踩坑，别再踩）

1. 日志里的多字节文本**必须整帧/整行解码**，绝不能按 64 KB chunk `toString('utf8')` 拼接。
2. 分帧必须保留「首帧 = 单行 header」这一不变量，压缩用检查点校验（checksum flag）。
3. 覆盖 DSH 正在读写的日志用 `copyFileSync`，不要 `renameSync`。
4. `run_code` 内嵌 Node worker 的 `zlib.createZstdDecompress()` 流式解压该日志会抛 `ZSTD_error_prefix_unknown` 并杀死 worker —— zstd 一律用 `ops_bash` 跑 `.mjs` 脚本。
5. heredoc 写长脚本会在 ~1 KB 处被截断，长脚本用文件工具写。
6. bili 的 `[fold-reconcile] resent history drifted … (~437 tok unfolded in churn region)` 告警是噪声（125 次折叠只丢 1 块、coverageLostFrozenTokens=0），**不要**为此清账本：清账本需完全退出 DSH、重开要重折 3.0 M 字符（≈ 70–75 万 token 上送）、block-content 回溯失效。

## 8. 结论

- 会话列表可见、打开无 SessionFormatError、点击继续可正常对话（用户 17:52 验收）。
- 修复只改历史正文，不改任何 `seq`、`toolCallId`、`surfaceOp`，因此 bili 按 seq 的 ingest 记录与 DSH 的关系校验都保持自洽。
