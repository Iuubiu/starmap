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
} from '@starmap/api-contract';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { MasteryService } from '../mastery/mastery.service.js';

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

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

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    // 与 `AttemptsController` / `MarketController` 同一做法：控制器在自己文件里
    // 现场构造服务，避免为加 provider 去改共享的 `app.module.ts`。
    this.mastery = new MasteryService(db);
  }

  @Get('health')
  async health(): Promise<HealthResponse> {
    const dbNow = await this.db.now();
    return HealthResponseSchema.parse({ status: 'ok', dbNow, version: '0.1.0' });
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
    const rows = await this.db.query<{
      id: string;
      name: string;
      depth: number;
    }>(
      `SELECT n.id, n.name, n.depth
         FROM knowledge_points n
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

    return NodeDetailResponseSchema.parse({
      node: {
        microKpId: row.id,
        name: row.name,
        state: view.state,
        percent,
        depth: row.depth,
      },
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
