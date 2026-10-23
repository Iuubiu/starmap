import { Controller, Get, Inject, Param, UseFilters } from '@nestjs/common';
import type { KpProgressView, MasteryView, ProgressBoard } from '@starmap/api-contract';
import { tierParams } from '@starmap/engine';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { MasteryService } from './mastery.service.js';
import { PlacementService } from '../placement/placement.service.js';

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

  private readonly placement: PlacementService;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    this.mastery = new MasteryService(db);
    this.placement = new PlacementService(db);
  }

  /**
   * 个人看板（票 80）。
   *
   * **必须声明在 `mastery/:microKpId` 之前**：Nest 按声明顺序匹配路由，
   * 先声明参数路由的话 `/mastery/board` 会被当成「查一个叫 board 的知识点」，
   * 拿到 404 而不是看板。
   */
  @Get('mastery/board')
  async board(): Promise<ProgressBoard> {
    const evaluatedAt = await this.mastery.now();
    return this.mastery.board(evaluatedAt);
  }


  /**
   * 学习页右栏的本知识点进度（票 89）。
   *
   * 路径里带 `/kp/`：它和 `mastery/:microKpId` 返回的是两件事（掌握度回放 vs
   * 本关门槛进度），共用一个参数路由会让调用方分不清拿到的是哪一种。声明顺序
   * 仍在参数路由之前 —— 与 `mastery/board` 同理。
   */
  @Get('mastery/kp/:microKpId')
  async kp(@Param('microKpId') microKpId: string): Promise<KpProgressView> {
    const evaluatedAt = await this.mastery.now();
    // 连对阈值随档位变（P1 是 2 题），档位只能走 placement 这一层读
    const status = await this.placement.status();
    const streakTarget = tierParams(status.tier ?? 'P1').masteryRule.consecutiveCorrect;
    return this.mastery.kpProgress(microKpId, evaluatedAt, streakTarget);
  }

  @Get('mastery/:microKpId')
  async get(@Param('microKpId') microKpId: string): Promise<MasteryView> {
    const evaluatedAt = await this.mastery.now();
    return this.mastery.view(microKpId, evaluatedAt);
  }
}
