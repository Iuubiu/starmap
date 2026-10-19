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
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class NodesController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

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
      percent: number | null;
      state: string | null;
    }>(
      `SELECT n.id, n.name, n.depth, n.is_leaf,
              m.current AS percent, m.state
         FROM knowledge_points n
         LEFT JOIN mastery m ON m.micro_kp_id = n.id
        WHERE n.is_leaf = true
          AND ($1::text IS NULL OR n.id > $1)
        ORDER BY n.id
        LIMIT $2`,
      [cursor ?? null, limit],
    );

    const items = rows.map((r) => ({
      microKpId: r.id,
      name: r.name,
      state: (r.state ?? 'unseen') as
        | 'mastered'
        | 'proficient'
        | 'familiar'
        | 'attempted'
        | 'unseen',
      percent: r.percent === null ? null : Number(r.percent),
      depth: r.depth,
    }));

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
      percent: number | null;
      state: string | null;
    }>(
      `SELECT n.id, n.name, n.depth, m.current AS percent, m.state
         FROM knowledge_points n
         LEFT JOIN mastery m ON m.micro_kp_id = n.id
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

    const percent = row.percent === null ? null : Number(row.percent);
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
        state: (row.state ?? 'unseen') as
          | 'mastered'
          | 'proficient'
          | 'familiar'
          | 'attempted'
          | 'unseen',
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
