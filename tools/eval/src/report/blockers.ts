/**
 * 把失败阶段整理成报告里的「阻塞项」。
 *
 * ## 为什么单独一个模块
 *
 * 这里曾经有过一个真 bug：`topBlockers[].description` 直接取
 * `stage.result.detail.slice(0, 200)`，而 `ReportSchema` 要求它至少 10 个字。
 * 平时 detail 都很长（「图谱里的推荐标记数与 /recommendations 的条数不一致，
 * 期望 0 / 实际 3」），看不出问题；直到某次跑出一个只有 8 个字的 detail
 *（「读取推荐列表失败」），`ReportSchema.parse` 直接抛 ZodError ——
 * **整份报告没写出来**。
 *
 * 后果比缺一条数据严重得多：三档跑完花了十分钟，失败阶段的截图和证据
 * 都在内存里，只因为一句话太短，全部丢掉。
 *
 * 所以这里的原则是：**描述不够长就补事实，而不是放宽 schema**。
 * `min(10)` 是用来拦住「页面坏了」这种废话的，放宽它等于让报告里能出现
 * 无法据此行动的空话。补进去的都是从 `VerifyResult` 里已经有的事实：
 * 失败类型、选择器 / HTTP 状态 / 两边值、以及该阶段采集到的证据。
 */

import type { StageRecord } from '../layer2/stages.ts';

/** schema 对 `description` 的下限。两边必须一致，改这里要同时看 `report/schema.ts`。 */
export const MIN_DESCRIPTION_CHARS = 10;

/** 从 `VerifyResult` 里抽出能补进描述的事实。没有就返回空串。 */
function factsOf(result: StageRecord['result']): string {
  if (result.status === 'passed') return '';
  if (result.status === 'locator_failure') {
    return result.selector ? `选择器 ${result.selector}` : '';
  }
  if (result.status === 'backend_error') {
    /* httpStatus 为 0 不是「HTTP 0」—— 是 fetch 根本没连上（后端重启窗口、
       端口没起）。把它写成 HTTP 0 会让人去查一个不存在的状态码。 */
    if (result.httpStatus === 0 || result.httpStatus === undefined) return '后端不可达（请求没发出去）';
    return `HTTP ${result.httpStatus}`;
  }
  const expected = result.expected ?? '?';
  const actual = result.actual ?? '?';
  return `期望 ${expected} / 实际 ${actual}`;
}

/**
 * 生成一条够长、且能据以行动的阻塞项描述。
 *
 * 顺序是「阶段名 → 发生了什么 → 关键事实 → 证据」，因为读报告的人是顺着
 * 这条线走的：先知道哪一段，再知道出了什么事，最后才是去哪儿查。
 */
export function describeBlocker(stage: StageRecord): string {
  const detail = stage.result.detail.trim();
  const parts: string[] = [`${stage.label}：${detail}`];

  const facts = factsOf(stage.result);
  if (facts) parts.push(facts);

  /* 证据取前两条就够：再多会把描述撑到没人读，而完整证据在 journey JSON 里。 */
  if (stage.evidence.length > 0) parts.push(`证据：${stage.evidence.slice(0, 2).join('；')}`);

  const description = parts.filter((part) => part !== '').join(' · ');

  /* 兜底：detail 是空的（阶段抛异常且没归类出文字）时也要能过关。
     这种描述虽然不含信息，但它诚实地说「这里没拿到细节」，比伪造一句
     「加载失败」强 —— 后者会让人以为已经知道原因了。 */
  if (description.length >= MIN_DESCRIPTION_CHARS) return description;
  return `${description}（该阶段未采集到细节，详见 journey JSON）`;
}

/**
 * 三档里各取第一处失败，最多三条。
 *
 * 每档只取第一条：一个 persona 后面的失败往往是同一条原因的连锁
 *（图谱拿不到数据 → 详情页也点不进去），列出来只会把真正的首因埋掉。
 */
export function buildTopBlockers(
  runs: ReadonlyArray<{ journey: { stages: StageRecord[] } }>,
  toFunnelStage: (stage: string | null) => string,
): Array<{ stage: string; element: string; description: string; severity: 'blocker' }> {
  return runs
    .flatMap((run) =>
      run.journey.stages
        .filter((stage) => stage.result.status !== 'passed')
        .slice(0, 1)
        .map((stage) => ({
          stage: toFunnelStage(stage.stage),
          element: stage.label,
          description: describeBlocker(stage),
          severity: 'blocker' as const,
        })),
    )
    .slice(0, 3);
}
