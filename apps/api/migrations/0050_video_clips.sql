-- 0050: 课程视频片段（票 19）
--
-- 两张表：`video_sources` 记「这段素材从哪来」，`video_clips` 记「切出来的每一片」。
-- 分开是因为可追溯字段（原始链接、时长、下载时间、频道、ASR 模型）属于素材，
-- 不属于某一片；把同一份来源信息在 N 个片段行里各存一份，迟早互相漂移。
--
-- ## 外键为什么不是 CASCADE
--
-- 指向 `knowledge_points` 的外键必须 `ON DELETE SET NULL`：内容侧修复图谱时
-- （合并/删除噪声知识点）会连带删掉所有挂在上面的行。项目里已有 11 条 CASCADE
-- 让「删一个知识点 → 学习者的作答记录与掌握度全没」的教训，这里不再重复。
-- 片段是**媒体素材**，知识点没了不等于素材坏了：把 micro_kp_id 置空，片段
-- 仍然可播、可回看，只是暂时没有归属。
--
-- 同理 `video_clips.video_id → video_sources` 用 CASCADE：片段脱离来源就不该
-- 存在（它就是来源的一段），这条级联是有意的。
--
-- ## 为什么 file_path 存相对路径
--
-- 绝对路径在换机器/换目录后全失效。存 `videos/<videoId>/clips/<clipId>.mp4`
-- 这种以 `content/` 为根的相对路径，由服务端拼上 content 根目录 —— 迁移一次
-- 工作目录不需要改数据库。

CREATE TABLE IF NOT EXISTS app.video_sources (
    video_id        text PRIMARY KEY,
    source_url      text NOT NULL DEFAULT '',
    title           text NOT NULL DEFAULT '',
    duration_sec    numeric(10, 3) NOT NULL DEFAULT 0,
    uploader        text,
    license_or_channel text,
    downloaded_at   timestamptz,
    asr_model       text,
    transcript_source text,
    origin          text NOT NULL DEFAULT 'unknown'
                    CHECK (origin IN ('yt-dlp', 'local-file', 'unknown')),
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.video_clips (
    id              text PRIMARY KEY,
    video_id        text NOT NULL REFERENCES app.video_sources(video_id) ON DELETE CASCADE,
    micro_kp_id     text REFERENCES app.knowledge_points(id) ON DELETE SET NULL,
    title           text NOT NULL DEFAULT '',
    start_sec       numeric(10, 3) NOT NULL,
    end_sec         numeric(10, 3) NOT NULL,
    duration_sec    numeric(10, 3) NOT NULL,
    file_path       text NOT NULL,
    transcript_excerpt text,
    reason          text,
    alignment_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
    downloaded_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT video_clips_range CHECK (end_sec > start_sec),
    CONSTRAINT video_clips_max_len CHECK (end_sec - start_sec <= 360.0)
);

-- 按知识点找片段：关卡页/节点页「看讲解」的主要查询路径
CREATE INDEX IF NOT EXISTS video_clips_kp_idx ON app.video_clips (micro_kp_id, start_sec);
-- 按视频列片段
CREATE INDEX IF NOT EXISTS video_clips_video_idx ON app.video_clips (video_id, start_sec);
