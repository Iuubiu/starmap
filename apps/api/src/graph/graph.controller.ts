import { Controller, Get, Inject, UseFilters } from '@nestjs/common';
import {
  GraphResponseSchema,
  type GraphEdge,
  type GraphNode,
  type GraphResponse,
} from '@starmap/api-contract';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { RecommendService } from '../recommend/recommend.service.js';

interface EdgeRow extends Record<string, unknown> {
  from_id: string;
  to_id: string;
  kind: string;
}

interface GapRow extends Record<string, unknown> {
  id: string;
  topic: string;
  reason: string;
  expected_role: string;
  nearest_kp_ids: string[];
}

/**
 * 知识地图的数据源：整张图谱一次返回。
 *
 * ## 为什么不分页
 *
 * 画布要对整张图跑力导向布局（`graphology-layout-forceatlas2`，跑在 Web
 * Worker 里）。布局算法看的是全局拓扑：只给一半节点，算出来的坐标和给了全部
 * 时不是「同一张图的局部」，而是另一张图——用户逐页加载会看到节点不停跳动。
 * 两跳邻域的裁剪也必须先有完整邻接表（「邻居的邻居」跨页时按需取会退化成
 * N 次请求）。
 *
 * spec 第 27 行按 2000+ 节点设计：2000 个节点 + 数千条边的 JSON 约 300 KB，
 * 一次拉完比按需拼接更快也更简单。所以这里是一次全量查询，不做 limit/cursor。
 *
 * ## 为什么不在这里算「需复验」
 *
 * `reviewDueAt` 直接透出 `mastery.next_review_at`，不折算成布尔值。票 07 的
 * 验收第 5 条要求「图谱上『需复验』状态与到期判定一致」——唯一能保证一致的
 * 做法是两边读同一列、用同一个比较。本服务不持有排期规则（1/3/7/21/60 天），
 * 也就不该替票 07 回答「现在到期了吗」；前端用一个纯函数做 `<= now` 比较，
 * 那个函数同时被画布与测试使用。
 *
 * ## `recommendedIds` 必须与看板同源
 *
 * 票 13 验收第 5 条要求「图谱与看板推荐同一时刻指向同一批节点」。这里的做法
 * 不是「两边各算一遍然后希望结果一样」——那在数据更新的一瞬间就会漂移，
 * 而且没人能复现。两边调**同一个函数**（`@starmap/engine` 的 `recommend()`，
 * 经 `RecommendService` 复用同一套 `attempts` 回放），并把结果一并放进图谱
 * 响应，好让界面和测试都能直接对照。
 *
 * 顺序有意义（就是推荐的优劣顺序）；空数组表示「此刻没有可推荐的节点」，
 * 不是「功能没接通」。
 *
 * ## 掌握度读回放，不读 `app.mastery` 的快照列
 *
 * 这一条是本票修掉的真实缺陷。原实现 `LEFT JOIN mastery` 直接取
 * `ms.current` / `ms.state`；实测症状是同一个知识点出现两个数：
 *
 * ```
 * GET /api/v1/nodes/kp-probe-tmp   → state=proficient, percent=0.9
 * GET /api/v1/mastery/kp-probe-tmp → state=unseen, current=null, attemptCount=0
 * ```
 *
 * 根因是 `app.mastery` 记的是「上次作答那一刻的 `current`」，而 `current` 会
 * 按半衰期持续衰减；`MasteryService` 早就改成每次从 `attempts` 回放了
 * （见 `mastery.service.ts:43-52` 的说明），图谱却还在读缓存。
 *
 * 现在节点事实由 `RecommendService.graphData()` 提供 —— 与看板、推荐**共用
 * 同一次** `attempts` 回放。因此有三条性质同时成立：
 *
 * 1. 图谱上的 `percent` 与 `GET /api/v1/mastery/:id` 的 `current` 逐位相同；
 * 2. 图谱上的 `state` 与掌握度接口的五态相同；
 * 3. `recommendedIds` 与看板的推荐列表同一批、同一顺序、同一时刻。
 *
 * `percent` 保持 `number | null`：证据不足时必须是 `null`，不能用 0 顶替 ——
 * 前端 `formatPercent(null)` 显示「证据不足」，而 0 会显示成「0%」。
 *
 * `reviewDueAt` 仍然只从 `app.mastery.next_review_at` 取：那是票 07 写下的
 * **排期**，不是掌握度数字，没有第二个来源。
 *
 * ## SQL 不写 `app.` 前缀
 *
 * 与 `NodesController` 同样的理由：schema 由连接的 `search_path` 决定
 * （生产 `app`，测试 `app_test_*`）。写死前缀会让测试静默读到生产表。
 *
 * ## 内容缺口（`contentGaps`）
 *
 * 票 18 验收第 5 条要求「资源库没有『数字多道／FPGA／数字脉冲处理』对口教材，
 * 该缺口在图上可见」。缺口存在 `content_gaps` 表里（迁移 0060），与节点一起
 * 返回而不是单开一个接口：它只在跟图摆在一起时才有意义（见 `ContentGapSchema`
 * 的注释）。
 *
 * 三条读库约定：
 *
 * 1. **表为空就返回空数组**，不是 404 也不是 500。缺口是「内容侧的事实」，
 *    资源库补齐之后它就应该变空 —— 空是正常终态，不是功能没接通。
 * 2. **不过滤掉 `nearest_kp_ids` 解析不到的缺口**。迁移里那三个数组是入库时
 *    按名字解析的；知识点重导入后 id 会漂移，此时 `nearest_kp_ids` 指向的
 *    节点可能已经不在 `nodes` 里。那种情况下缺口仍然要显示（「这里缺内容」
 *    是事实），只是跳转入口点不动。前端按「在不在 nodes 里」自己决定渲染
 *    成链接还是纯文本。
 * 3. **按 `id` 排序**，不按 `created_at`。迁移是同一毫秒插进去的，`created_at`
 *    分不出先后；而 `id` 是稳定的，重启后顺序不变。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class GraphController {
  private readonly recommendService: RecommendService;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    // 与 `AttemptsController` / `MarketController` 同一做法：控制器在自己文件里
    // 现场构造服务，避免为加 provider 去改共享的 `app.module.ts`。
    this.recommendService = new RecommendService(db);
  }

  @Get('graph')
  async graph(): Promise<GraphResponse> {
    // 推荐要用同一个时刻算：图谱上的掌握度与推荐理由里的数字若取自两个时刻，
    // 验收第 5 条的「同一时刻」就落空了。所以先取库时间，再并发查。
    const now = await this.db.now();
    // 节点事实与推荐 id 来自**同一次** `computeAll`（见 `RecommendService`）：
    // 掌握度数字与推荐标记因此必然属于同一时刻，不是两次计算碰巧一致。
    // 边是纯拓扑数据，与掌握度无关，并行取。
    const [{ facts, recommendedIds }, edgeRows, gapRows] = await Promise.all([
      this.recommendService.graphData(now),
      this.db.query<EdgeRow>(`
        SELECT from_id, to_id, kind
        FROM kp_edges
        ORDER BY from_id, to_id, kind
      `),
      // 缺口是静态内容，与掌握度无关，并行取。表不存在时会抛 —— 那是迁移没
      // 跑完，应该响亮地失败，而不是把缺口静默当成空（否则「缺口在图上可见」
      // 这条验收会变成一个永远绿的空断言）。
      this.db.query<GapRow>(`
        SELECT id, topic, reason, expected_role, nearest_kp_ids
        FROM content_gaps
        ORDER BY id
      `),
    ]);

    const nodes: GraphNode[] = facts.map((fact) => ({
      microKpId: fact.microKpId,
      name: fact.name,
      // `state` / `percent` 来自 attempts 回放（`RecommendService.computeAll`），
      // 不是 `app.mastery` 的快照列 —— 后者记的是「上次作答那一刻」，读它会让
      // 图谱与 `/api/v1/mastery/:id` 出现两个数（见 `mastery.service.ts:43-52`）。
      state: fact.state,
      percent: fact.percent,
      depth: fact.depth,
      moduleId: fact.moduleId,
      moduleName: fact.moduleName,
      moduleOrdinal: fact.moduleOrdinal,
      ordinal: fact.ordinal,
      // 复验排期是票 07 写下的**排期**，不是掌握度数字，没有第二个来源。
      reviewDueAt: fact.reviewDueAt,
    }));

    const edges: GraphEdge[] = edgeRows.map((r) => ({
      from: r.from_id,
      to: r.to_id,
      kind: r.kind as GraphEdge['kind'],
    }));

    // 出口校验：形状由契约定义，这里再 parse 一次保证「后端以为发出去的」
    // 和「契约声明的」是同一件事（类型断言不会在运行时兜底）。
    return GraphResponseSchema.parse({
      nodes,
      edges,
      recommendedIds,
      contentGaps: gapRows.map((r) => ({
        id: r.id,
        topic: r.topic,
        reason: r.reason,
        expectedRole: r.expected_role as 'prereq' | 'core' | 'advanced',
        nearestKpIds: r.nearest_kp_ids,
      })),
    });
  }
}
