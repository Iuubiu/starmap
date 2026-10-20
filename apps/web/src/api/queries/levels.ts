/**
 * 关卡领域的 query hook（票 04 / 05 / 06 / 07 / 11 的落点）。
 *
 * 归属泳道：level-dev。加 hook 就往这里加，不要改 `queries/index.ts`。
 */
import { useGetLevel } from '../generated/default/default';
import type { LevelDetailResponse, LevelSpec } from '../generated/model';

/**
 * 取一张关卡的完整规范。
 *
 * 播放器整个生命周期只发这一个请求：卡片、七段步骤、每道题的选项/答案/
 * 预写反馈全在里面。作答不走后端 —— 反馈是作者写死在 spec 里的，
 * 不是模型现场生成的，所以「提交后立即显示」在实现上是零延迟而不是「很快」。
 *
 * `levelId` 为 `undefined` 时（路由还没取到参数）不发请求，避免打
 * `/api/v1/levels/undefined`。
 */
export function useLevel(levelId: string | undefined) {
  const query = useGetLevel(levelId ?? '', {
    query: { enabled: Boolean(levelId) },
  });
  return {
    ...query,
    payload: query.data?.data as LevelDetailResponse | undefined,
  };
}

/** 契约生成的 spec 类型别名，供播放器组件使用，免得各处再记生成物路径。 */
export type { LevelSpec };
