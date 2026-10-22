import { Controller, Get, Inject, Param, UseFilters } from '@nestjs/common';
import type { MasteryView } from '@starmap/api-contract';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { MasteryService } from './mastery.service.js';

/**
 * 读一个知识点的双字段掌握度。
 *
 * 叶节点直接回放它的证据；折叠父节点回它的叶子后代的加权聚合
 * （ADR-0004：只读派生、不落库）。
 *
 * `evaluatedAt` 取自数据库的 `now()` 而不是 Node 的 `Date.now()`：两个应用
 * 实例的时钟可能差几秒，而「同一响应里的所有数字共享同一时刻」这件事一旦
 * 靠进程时钟就不再成立。生产上这让衰减在数据库侧一致，测试里则完全不依赖
 * 时钟 —— 回放函数本身已经把时刻做成了显式参数。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class MasteryController {
  private readonly mastery: MasteryService;

  constructor(@Inject(DatabaseService) db: DatabaseService) {
    this.mastery = new MasteryService(db);
  }

  @Get('mastery/:microKpId')
  async get(@Param('microKpId') microKpId: string): Promise<MasteryView> {
    const evaluatedAt = await this.mastery.now();
    return this.mastery.view(microKpId, evaluatedAt);
  }
}
