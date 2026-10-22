/**
 * 课程视频领域契约：片段元数据、按知识点/关卡查片段、流式播放。
 *
 * 归属泳道：authoring-dev（票 19）。
 *
 * ## 为什么片段元数据要带「可追溯」字段
 *
 * 票面第 7 条要求「下载的视频与转写产物可追溯来源（原始链接、时长、下载时间），
 * 不混入无出处的素材」。这句话不能只写在文档里 —— 它必须是响应形状的一部分：
 * 每个片段都随元数据带回 `sourceUrl`/`videoId`/`downloadedAt`/`asrModel`。
 * 只要有一个片段的可追溯字段是空的，调用方就能立刻看出来。
 *
 * ## 为什么 `reason` 与 `alignments` 也进契约
 *
 * 「每一片都有为什么从这里开始/结束的可读理由」和「对齐必须可复核」是票面
 * 验收第 3、5 条。把它们藏在数据库里等于只对开发者可见；放进响应，界面就能
 * 把「为什么这一段被切出来」直接展示给学习者与内容作者。
 */
import { z } from 'zod';

/**
 * 一次知识点对齐的证据。
 *
 * `evidence` 是一句人话，例如「命中知识点名「脉冲电离室」3 次（7 字）」。
 * 保留原始命中次数与分数，是因为「为什么是这个名字而不是另一个」需要可比较
 * 的依据 —— 只给最终 id 的话，两个候选之间没法复核。
 */
export const VideoAlignmentSchema = z.object({
  microKpId: z.string(),
  name: z.string(),
  score: z.number().min(0),
  hits: z.number().int().min(0),
  evidence: z.string(),
});

/**
 * 一个课程视频片段。
 *
 * `startSec`/`endSec` 都是从源视频起点算的秒数，**不是片内偏移**：
 * 播放器要能用 `源视频 + startSec` 直接定位，切片文件只是离线产物。
 */
export const VideoClipSchema = z.object({
  clipId: z.string(),
  videoId: z.string(),
  microKpId: z.string().nullable(),
  microKpName: z.string().nullable(),
  title: z.string(),
  /** 片段的绝对起点（相对源视频），秒 */
  startSec: z.number().min(0),
  /** 片段的绝对终点（相对源视频），秒 */
  endSec: z.number().min(0),
  durationSec: z.number().min(0),
  /**
   * 可播放的 URL，**相对路径**（例如 `/media/clips/lv-c01.mp4`）。
   *
   * 前端不该自己拼路径：content 根目录换了、静态服务改成流式接口了，
   * 前端都要跟着改。让后端给一个能直接用的路径。
   *
   * 写相对路径而不是 `http://127.0.0.1:3001/...`：绝对地址在换端口/换主机后
   * 全失效，而前端本来就知道 API 的 base（`VITE_API_BASE_URL`）。
   */
  playUrl: z.string(),
  transcriptExcerpt: z.string().nullable(),
  /** 「为什么从这里开始/结束」的中文说明，可直接展示 */
  reason: z.string().nullable(),
  /** 对齐证据，可复核 */
  alignments: z.array(VideoAlignmentSchema),
  /** 可追溯字段 */
  sourceUrl: z.string(),
  uploadedBy: z.string().nullable(),
  downloadedAt: z.string().nullable(),
  asrModel: z.string().nullable(),
  /** 这个片段的来源是不是一个「来源链接未知」的本地文件 */
  sourceOrigin: z.enum(['yt-dlp', 'local-file', 'unknown']),
  /** 本地文件的免责说明；正式素材为 null */
  sourceNote: z.string().nullable(),
});

/**
 * 来源可追溯的硬约束：`sourceUrl` 要么非空，要么 `sourceNote` 说明为什么空。
 *
 * 票面第七条要求「不混入无出处的素材」。只把 `sourceUrl` 定义成 `z.string()`
 * 挡不住空串 —— 那正好是「无出处」的形状。这条 refine 让「没有链接也没解释」
 * 的片段在契约层就被拒绝，而不是靠调用方自觉。
 */
export const VideoClipTraceableSchema = VideoClipSchema.refine(
  (clip) => clip.sourceUrl.trim().length > 0 || (clip.sourceNote ?? '').trim().length > 0,
  {
    message: '片段缺少来源链接，且没有说明为什么缺（sourceUrl 与 sourceNote 不能都为空）',
    path: ['sourceUrl'],
  },
);

/** 按知识点查片段。空数组是正常状态（这个知识点还没有配讲解视频）。 */
export const VideoClipListResponseSchema = z.object({
  microKpId: z.string().nullable(),
  items: z.array(VideoClipTraceableSchema),
});

/** 按关卡查片段：关卡 → 它所属知识点 → 挂在该知识点上的片段。 */
export const LevelVideoClipListResponseSchema = z.object({
  levelId: z.string(),
  microKpId: z.string(),
  items: z.array(VideoClipTraceableSchema),
});

export type VideoAlignment = z.infer<typeof VideoAlignmentSchema>;
/**
 * 注意：对外导出的片段**类型**用的是带可追溯 refine 的那个。
 *
 * 不导出 `VideoClipSchema` 的裸 `z.infer`，否则后端可以拿着一份没检查的
 * 对象当 `VideoClip` 用，refine 形同虚设。
 */
export type VideoClip = z.infer<typeof VideoClipTraceableSchema>;
export type VideoClipListResponse = z.infer<typeof VideoClipListResponseSchema>;
export type LevelVideoClipListResponse = z.infer<typeof LevelVideoClipListResponseSchema>;
