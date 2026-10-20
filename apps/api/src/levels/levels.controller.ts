import {
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  UseFilters,
} from '@nestjs/common';
import {
  LevelDetailResponseSchema,
  type LevelDetailResponse,
} from '@starmap/api-contract';
import { validateLevelSpec, type LevelSpec } from '@starmap/shared';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';

/**
 * 行形状刻意写成 `type` 而不是 `interface`：`DatabaseService.query<T>` 的约束是
 * `T extends Record<string, unknown>`，而 TypeScript 只给**匿名对象类型/类型别名**
 * 隐式索引签名，interface 没有。写成 interface 会在泛型约束处报 TS2344。
 */
type LevelRow = {
  id: string;
  micro_kp_id: string;
  title: string;
  kind: string;
  spec: unknown;
};

/**
 * 只读查询关卡规范。
 *
 * 播放器靠这一个请求拿全：卡片、七段步骤、每题的选项/答案/预写反馈。
 * 作答回看不再打后端 —— 关卡是一次性下发的静态资产，不是逐步拉取的对话。
 *
 * SQL 里**不写 `app.` 前缀**：schema 由连接的 `search_path` 决定
 * （生产是 `app`，测试是 `app_test_*`）。写死前缀会让测试静默读到生产表，
 * 返回空结果而不报错。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class LevelsController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  @Get('levels/:levelId')
  async get(@Param('levelId') levelId: string): Promise<LevelDetailResponse> {
    const rows = await this.db.query<LevelRow>(
      `SELECT id, micro_kp_id, title, kind, spec
         FROM levels
        WHERE id = $1`,
      [levelId],
    );

    const row = rows[0];
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `关卡不存在: ${levelId}`,
      });
    }

    // 库里存的是坏 spec 属于服务端数据问题（500），不是调用方传错了参数（400）。
    // 但 details 仍然是字段级的：谁改坏了关卡，看第一行 path 就知道该去哪一段。
    const validated = validateLevelSpec(row.spec);
    if (!validated.ok) {
      throw new InternalServerErrorException({
        code: 'INTERNAL',
        message: `关卡规范不合法: ${levelId}`,
        details: validated.issues,
      });
    }
    const spec: LevelSpec = validated.spec;

    return LevelDetailResponseSchema.parse({
      level: {
        levelId: row.id,
        microKpId: row.micro_kp_id,
        title: row.title,
        itemCount: spec.items.length,
        kind: row.kind,
      },
      spec,
    });
  }
}
