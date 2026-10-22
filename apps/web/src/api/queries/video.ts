/**
 * 课程视频片段的 query hook（票 19）。
 *
 * 归属泳道：authoring-dev。加 hook 就往这里加，不要改 `queries/index.ts`
 * （那个文件是纯 re-export，已经含 `export * from './video.js'`）。
 *
 * ## 为什么这里只有一个 hook、没有 mutation
 *
 * 切片与对齐都在离线管线（`tools/video/run.py`）里做完，产物由
 * `run.py import` 投影进库。HTTP 层是纯读：页面不该等 30 分钟的 ASR，
 * 也不该有「点一下按钮在服务器上转写视频」这种入口。
 */
import { useListLevelVideoClips, useListVideoClips } from '../generated/default/default';
import type {
  LevelVideoClipListResponse,
  VideoClip,
  VideoClipListResponse,
} from '../generated/model';

/**
 * 把生成模型里的类型从这一层转出去。
 *
 * 为什么需要这一行：`queries/index.ts` 里写的是 `export * from './video.js'`，
 * 而 `export *` 只转发本文件**声明/导出**的名字 —— 从别处 `import` 进来的
 * 名字不会因为它被 `export *` 自动转出去。所以这里必须先 `export type { ... }`，
 * 页面才能写 `import type { VideoClip } from '../api/queries'`
 * （`apps/web/src/level/VideoPanel.tsx:43` 就是这么用的）。
 *
 * 直接让页面从 `generated/model` 取类型也行，但那样就绕过了这层收口，
 * 以后换生成器版本要改的地方从一个变成 N 个。
 */
export type { LevelVideoClipListResponse, VideoClip, VideoClipListResponse };

/**
 * 一个关卡能看的讲解片段。
 *
 * `levelId` 为空时不发请求（`enabled: false`）—— 页面在关卡还没加载完时
 * 不该先打一发 `/levels//video-clips`。
 */
export function useLevelVideoClips(levelId?: string) {
  const query = useListLevelVideoClips(levelId ?? '', {
    query: { enabled: Boolean(levelId) },
  });
  return {
    ...query,
    payload: query.data?.data as LevelVideoClipListResponse | undefined,
  };
}

/** 一个知识点能看的讲解片段（内容作者自查用）。 */
export function useKnowledgePointVideoClips(microKpId?: string) {
  const query = useListVideoClips(
    microKpId ? { microKpId } : undefined,
    { query: { enabled: Boolean(microKpId) } },
  );
  return {
    ...query,
    payload: query.data?.data as VideoClipListResponse | undefined,
  };
}

/**
 * 片段的可播地址。
 *
 * `playUrl` 是相对路径（`/media/clips/<id>.mp4`），要拼上 API 的 base 才能
 * 被 `<video src>` 用。base 来自 `VITE_API_BASE_URL`，与 `fetcher.ts` 用的是
 * 同一个环境变量 —— 两处各读一次而不是从这里 import，是为了让这个函数在
 * 测试里也能用（`fetcher.ts` 在 import 时就读了 env）。
 */
export function clipSrc(clip: VideoClip, apiBase = import.meta.env.VITE_API_BASE_URL ?? ''): string {
  return `${apiBase}${clip.playUrl}`;
}

/** 把秒格式化成 `m:ss`，给「从 3:20 开始」这类文案用。 */
export function formatClipTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
