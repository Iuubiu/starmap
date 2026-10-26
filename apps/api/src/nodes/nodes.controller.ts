import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  UseFilters,
} from '@nestjs/common';
import { z } from 'zod';
import {
  HealthResponseSchema,
  NodeDetailResponseSchema,
  NodeListResponseSchema,
  type HealthResponse,
  type NodeDetailResponse,
  type NodeListResponse,
  type NodeSource,
} from '@starmap/api-contract';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { MasteryService } from '../mastery/mastery.service.js';
import { SemanticSearch } from '../retrieval/semantic-search.js';

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/**
 * 把「知识点详情那一行」变成契约里的 `source`（票 18 验收 6）。
 *
 * ## 为什么三列必须同生同死
 *
 * `source_id` 为 NULL 的只有 3 个手工种的示例知识点（`kp-bool` / `kp-kmap` /
 * `kp-logic`），它们返回 `null`，前端说「示例知识点（无教材出处）」。
 * （其中 `kp-logic` 是非叶容器，`detail()` 本来就按 `is_leaf = true` 过滤，
 * 所以真正能走到这里的是 `kp-bool` / `kp-kmap` 两个。）
 *
 * 但 `source_id` 有、`source_page` 没有是**数据缺陷**，不是一种合法状态：
 * 全库 7312 行里，`source_page` 为 NULL 的正好就是那 3 个 `source_id` 也为
 * NULL 的示例节点（实测无一行只有其中一个）。这里选择抛错而不是拼出
 * 「第 null 页」或者悄悄降级成 null —— 悄悄降级会让「某本书的 source_id 丢了」
 * 变成界面上少一行字，而没人会发现。抛错会变成 500 + 日志，这才是数据缺陷
 * 该有的可见度。
 */
function sourceOf(row: {
  id: string;
  source_id: string | null;
  source_title: string | null;
  source_page: number | null;
}): NodeSource | null {
  if (row.source_id === null) return null;
  if (row.source_title === null || row.source_page === null) {
    throw new Error(
      `知识点 ${row.id} 有 source_id（${row.source_id}）却没有书名或页码：` +
        `source_title=${String(row.source_title)}, source_page=${String(row.source_page)}`,
    );
  }
  return {
    sourceId: row.source_id,
    title: row.source_title,
    page: row.source_page,
    // 句子只在服务端拼一处（理由见契约里 NodeSourceSchema 的注释）
    pageLabel: `「${row.source_title}」第 ${row.source_page} 页`,
  };
}

/**
 * 只读查询知识点与掌握状态。
 *
 * 掌握度只在叶节点持有（ADR-0004），非叶节点的颜色由子节点聚合——
 * 聚合在前端做，因为它是纯展示派生，不该落库也不该占后端 CPU。
 *
 * SQL 里**不写 `app.` 前缀**：schema 由连接的 `search_path` 决定
 * （生产是 `app`，测试是 `app_test_*`）。写死前缀会让测试静默读到生产表，
 * 返回空结果而不报错——这个坑我踩过一次。
 *
 * ## 掌握度走回放，不读 `app.mastery` 的快照列（票 23）
 *
 * 原实现 `LEFT JOIN mastery` 直接取 `m.current AS percent, m.state`，与
 * `GET /api/v1/mastery/:id`（走 `MasteryService.view`，从 `attempts` 重放）
 * 不是同一个数据源。实测症状是同一个知识点两个接口两个数：
 *
 * ```
 * GET /api/v1/nodes/kp-probe-tmp   → { state: proficient, percent: 0.9 }
 * GET /api/v1/mastery/kp-probe-tmp → { state: unseen, current: null, attemptCount: 0 }
 * ```
 *
 * 差异的根因写在 `mastery.service.ts:43-52`：`app.mastery.current` 是「上次
 * 作答那一刻的 current」，而 `current` 按半衰期持续衰减。读它等于把「上次算
 * 的时候」当成「现在」。
 *
 * 所以这里两段都改成调 `MasteryService`：列表用 `viewMany()`（一次
 * `loadEvidence` 回放整页，查询次数与节点数无关），详情用 `view()`（它还要
 * 处理非叶节点的递归聚合）。**两处都不再 join `mastery` 表。**
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class NodesController {
  private readonly mastery: MasteryService;

  /**
   * 健康检查里报语义检索状态（t82）。**不注入 `RetrievalService`**：
   * 那会把整个 BM25 索引（78k chunk 的 MiniSearch）拖进只想知道「连没连上
   * 库」的路径里，而 `/health` 是最常被轮询的端点。`SemanticSearch` 的
   * `status()` 只看磁盘与环境变量，构造也只是一次字符串拼接。
   */
  private readonly semantic = new SemanticSearch();

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    // 与 `AttemptsController` / `MarketController` 同一做法：控制器在自己文件里
    // 现场构造服务，避免为加 provider 去改共享的 `app.module.ts`。
    this.mastery = new MasteryService(db);
  }

  @Get('health')
  async health(): Promise<HealthResponse> {
    const dbNow = await this.db.now();
    // 语义检索状态（t82）。`status()` 只看磁盘与环境变量，不发网络请求，
    // 所以健康检查不会因为网关慢而变慢；具体原因由 `SemanticSearch` 保证
    // 是「人话」（「向量库文件不存在：…」），这里原样透出，不加工、不兜底。
    const semantic = this.semantic.status();
    return HealthResponseSchema.parse({
      status: 'ok',
      dbNow,
      version: '0.1.0',
      semanticSearch: semantic.enabled ? 'on' : 'off',
      semanticSearchReason: semantic.reason,
    });
  }

  @Get('nodes')
  async list(@Query() rawQuery: unknown): Promise<NodeListResponse> {
    const parsed = ListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '查询参数不合法',
        details: parsed.error.issues,
      });
    }
    const { limit, cursor } = parsed.data;

    const rows = await this.db.query<{
      id: string;
      name: string;
      depth: number;
      is_leaf: boolean;
    }>(
      `SELECT n.id, n.name, n.depth, n.is_leaf
         FROM knowledge_points n
        WHERE n.is_leaf = true
          AND ($1::text IS NULL OR n.id > $1)
        ORDER BY n.id
        LIMIT $2`,
      [cursor ?? null, limit],
    );

    // 先取库时间，再回放：同一响应里的所有百分比共享一个时刻（不是在循环里
    // 各调一次 `Date.now()`，也不是每个节点各取一次库时间）。
    const evaluatedAt = await this.mastery.now();
    const views = await this.mastery.viewMany(
      rows.map((row) => row.id),
      evaluatedAt,
    );

    const items = rows.map((row) => {
      // 列表里的每一行都是 `is_leaf = true`（上面 WHERE 已限定），所以
      // `viewMany` 一定能给出值；拿不到就是数据库在两查之间变了，此时宁可
      // 报错也不要用「未学习」顶替 —— 那会把并发删除伪装成学习进度倒退。
      const view = views.get(row.id);
      if (!view) {
        throw new Error(`节点 ${row.id} 在取掌握度的间隙消失了`);
      }
      return {
        microKpId: row.id,
        name: row.name,
        state: view.state,
        percent: view.current,
        depth: row.depth,
      };
    });

    const lastId = rows.at(-1)?.id ?? null;
    return NodeListResponseSchema.parse({
      items,
      nextCursor: rows.length === limit ? lastId : null,
    });
  }

  @Get('nodes/:microKpId')
  async detail(@Param('microKpId') microKpId: string): Promise<NodeDetailResponse> {
    // 来源用 LEFT JOIN：`source_id` 为 NULL 的示例知识点（kp-bool / kp-kmap）
    // 必须能被点开。写成 INNER JOIN 会让它们变成 404 ——
    // 而它们在看板与图谱上都是可点的，那会变成一个死链接。
    //
    // 同理不写 `app.` 前缀：schema 由 `search_path` 决定（见文件头）。
    const rows = await this.db.query<{
      id: string;
      name: string;
      depth: number;
      source_id: string | null;
      source_title: string | null;
      source_page: number | null;
    }>(
      `SELECT n.id, n.name, n.depth,
              s.id AS source_id,
              s.title AS source_title,
              n.source_page
         FROM knowledge_points n
         LEFT JOIN sources s ON s.id = n.source_id
        WHERE n.id = $1 AND n.is_leaf = true`,
      [microKpId],
    );

    const row = rows[0];
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `知识点不存在: ${microKpId}`,
      });
    }

    // 详情走 `view()` 而不是 `viewMany()`：它还要处理非叶节点的递归聚合，
    // 且这是单个 id，没有 N+1 风险。时刻同样取自数据库的 `now()`。
    const evaluatedAt = await this.mastery.now();
    const view = await this.mastery.view(microKpId, evaluatedAt);
    const levels = await this.db.query<{
      id: string;
      title: string;
      kind: string;
      item_count: string;
    }>(
      `SELECT l.id, l.title, l.kind, count(i.id)::text AS item_count
         FROM levels l
         LEFT JOIN level_items i ON i.level_id = l.id
        WHERE l.micro_kp_id = $1
        GROUP BY l.id, l.title, l.kind
        ORDER BY l.ordinal`,
      [microKpId],
    );

    const percent = view.current;
    const reasons: string[] = [];
    if (percent === null) {
      reasons.push('这个知识点还没有作答证据，建议从教学关卡开始。');
    } else if (percent < 0.4) {
      reasons.push('当前掌握度偏低，建议先看讲解再做题。');
    } else if (percent < 0.7) {
      reasons.push('已建立基础，还没有稳定，适合做变式练习。');
    } else {
      reasons.push('掌握度较高，可以直接进入复验或跳读。');
    }

    // 章节路径（票 08）：递归 CTE 沿 parent_id 一路走到根。`depth` 升序就是
    // 「根在前」——链上每级 depth 严格 +1（schema 由迁移保证），不需要在 JS
    // 里再排一遍。`WHERE id <> $1` 摘掉自身：路径回答「我在哪」，不重复念名字。
    // 手工 kp（parent 为 NULL）只有起始行，摘掉后自然是空数组，不是错误。
    const chain = await this.db.query<{ name: string; depth: number }>(
      `WITH RECURSIVE up AS (
         SELECT id, name, parent_id, depth FROM knowledge_points WHERE id = $1
         UNION ALL
         SELECT kp.id, kp.name, kp.parent_id, kp.depth
           FROM knowledge_points kp
          JOIN up ON kp.id = up.parent_id
       )
       SELECT name, depth FROM up WHERE id <> $1 ORDER BY depth ASC`,
      [microKpId],
    );
    const ancestors = chain.map((row) => row.name);

    return NodeDetailResponseSchema.parse({
      node: {
        microKpId: row.id,
        name: row.name,
        state: view.state,
        percent,
        depth: row.depth,
      },
      source: sourceOf(row),
      ancestors,
      levels: levels.map((l) => ({
        levelId: l.id,
        microKpId,
        title: l.title,
        kind: l.kind as 'teach' | 'quiz' | 'mixed',
        itemCount: Number(l.item_count),
      })),
      reasons,
    });
  }
}
