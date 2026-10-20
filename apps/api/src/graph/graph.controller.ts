import { Controller, Get, Inject, UseFilters } from '@nestjs/common';
import {
  GraphResponseSchema,
  type GraphEdge,
  type GraphNode,
  type GraphResponse,
  type MasteryState,
} from '@starmap/api-contract';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';

/** 节点行：知识点的位置信息 + 掌握状态 + 复验排期。 */
interface NodeRow extends Record<string, unknown> {
  id: string;
  name: string;
  depth: number;
  ordinal: number;
  module_id: string;
  module_name: string;
  module_ordinal: number;
  percent: string | null;
  state: string | null;
  next_review_at: Date | null;
}

interface EdgeRow extends Record<string, unknown> {
  from_id: string;
  to_id: string;
  kind: string;
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
 * ## SQL 不写 `app.` 前缀
 *
 * 与 `NodesController` 同样的理由：schema 由连接的 `search_path` 决定
 * （生产 `app`，测试 `app_test_*`）。写死前缀会让测试静默读到生产表。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class GraphController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  @Get('graph')
  async graph(): Promise<GraphResponse> {
    // 两个查询互不依赖，并行发；`Promise.all` 也保证它们在同一个连接池借出
    // 周期内完成，不会因为 await 串行而多占一轮往返。
    const [nodeRows, edgeRows] = await Promise.all([
      this.db.query<NodeRow>(`
        SELECT n.id,
               n.name,
               n.depth,
               n.ordinal,
               n.module_id,
               m.name    AS module_name,
               m.ordinal AS module_ordinal,
               ms.current        AS percent,
               ms.state          AS state,
               ms.next_review_at AS next_review_at
        FROM knowledge_points n
        JOIN modules m ON m.id = n.module_id
        LEFT JOIN mastery ms ON ms.micro_kp_id = n.id
        WHERE n.is_leaf = true
        ORDER BY n.id
      `),
      this.db.query<EdgeRow>(`
        SELECT from_id, to_id, kind
        FROM kp_edges
        ORDER BY from_id, to_id, kind
      `),
    ]);

    const nodes: GraphNode[] = nodeRows.map((r) => ({
      microKpId: r.id,
      name: r.name,
      // 没有 mastery 行 = 从没作答过 = unseen（与 NodesController 一致）
      state: (r.state ?? 'unseen') as MasteryState,
      percent: r.percent === null ? null : Number(r.percent),
      depth: r.depth,
      moduleId: r.module_id,
      moduleName: r.module_name,
      moduleOrdinal: r.module_ordinal,
      ordinal: r.ordinal,
      reviewDueAt: r.next_review_at === null ? null : r.next_review_at.toISOString(),
    }));

    const edges: GraphEdge[] = edgeRows.map((r) => ({
      from: r.from_id,
      to: r.to_id,
      kind: r.kind as GraphEdge['kind'],
    }));

    // 出口校验：形状由契约定义，这里再 parse 一次保证「后端以为发出去的」
    // 和「契约声明的」是同一件事（类型断言不会在运行时兜底）。
    return GraphResponseSchema.parse({ nodes, edges });
  }
}
