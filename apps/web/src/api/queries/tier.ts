/**
 * 三档渲染参数的前端查询层（票 12）。
 *
 * 归属泳道：agent-dev。加 hook 就往这里加，不要改 `queries/index.ts`。
 *
 * ## 为什么参数要从服务端取，而不是前端自己写一张表
 *
 * `packages/engine/src/tier.ts` 的 `TIER_PARAMS` 是六维参数的**唯一真源**
 * （纯函数 + `Record<'P1'|'P2'|'P3', TierParams>`）。web 不在 `@starmap/engine`
 * 的依赖图里（`.dependency-cruiser.cjs` 与 `GatePanel.tsx:131` 的注释都记着
 * 这条），所以这里的每个数都来自 `GET /api/v1/tier*`。前端**不复制数值**：
 * 一旦复制，改档位表就会变成「改了两处、只生效一处」的经典漂移。
 *
 * ## 四个端点各管什么
 *
 * - `useTierOverview()` → 当前档位 + 六维参数（页面顶部的「你现在按哪一档渲染」）
 * - `useTierLevelPlan(levelId)` → 这一关的首轮从哪一段开始、哪张卡藏正文
 * - `useTierChanges(limit)` → 档位变更历史（学习日志里的 `tier_rejudge`）
 * - `useTierSessionPlan()` → 本次会话最多开几个新知识点
 *
 * 全部只读。档位不是可改的设置项：它是定级与学习证据的结论，写接口就是
 * 绕过证据改档位的后门，所以契约里也没有 POST/PATCH。
 */
import {
  getGetTierChangesQueryKey,
  getGetTierLevelPlanQueryKey,
  getGetTierOverviewQueryKey,
  getGetTierSessionPlanQueryKey,
  useGetTierChanges,
  useGetTierLevelPlan,
  useGetTierOverview,
  useGetTierSessionPlan,
} from '../generated/default/default';
import type {
  TierChange,
  TierChangesResponse,
  TierLevelPlanResponse,
  TierOverviewResponse,
  TierSessionPlanResponse,
} from '../generated/model';

export const tierKeys = {
  overview: () => getGetTierOverviewQueryKey(),
  levelPlan: (levelId: string) => getGetTierLevelPlanQueryKey(levelId),
  changes: (limit?: number) => getGetTierChangesQueryKey({ limit }),
  sessionPlan: () => getGetTierSessionPlanQueryKey(),
};

/**
 * 当前档位与六维参数。
 *
 * 没定过级时不是 404：服务端返回 `tier:'P1'` + `source:'fallback'`，让新用户
 * 看到最完整的默认档界面。`source` 用来区分「真的定了 P1」与「还没定级所以
 * 按 P1 渲染」—— 后者界面上不该说「你的水平是 P1」。
 */
export function useTierOverview() {
  const query = useGetTierOverview();
  return { ...query, payload: query.data?.data as TierOverviewResponse | undefined };
}

/**
 * 某一关的首轮计划。
 *
 * `levelId` 为空时禁用查询（页面在参数还没解析出来时不该打请求，更不该
 * 拿空字符串去撞一个 404）。
 */
export function useTierLevelPlan(levelId: string | undefined) {
  const query = useGetTierLevelPlan(levelId ?? '', {
    query: { enabled: Boolean(levelId) },
  });
  return { ...query, payload: query.data?.data as TierLevelPlanResponse | undefined };
}

/** 档位变更历史（新的在前）。空数组是正常状态：从没重评过。 */
export function useTierChanges(limit = 10) {
  const query = useGetTierChanges({ limit });
  return { ...query, payload: query.data?.data as TierChangesResponse | undefined };
}

/** 本次会话的下一步，受档位的「会话新知识点上限」约束。 */
export function useTierSessionPlan() {
  const query = useGetTierSessionPlan();
  return { ...query, payload: query.data?.data as TierSessionPlanResponse | undefined };
}

export type { TierChange, TierChangesResponse, TierLevelPlanResponse, TierOverviewResponse, TierSessionPlanResponse };
