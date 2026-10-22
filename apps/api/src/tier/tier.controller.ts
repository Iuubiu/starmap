/**
 * 三档渲染参数的读接口（票 12）。
 *
 * ## 为什么全是 GET，且没有 `@HttpCode`
 *
 * 这四个端点只读，改档位只能通过重判（学习证据的结论）。GET 的默认 200 就是
 * 正确的状态码，不需要 `@HttpCode(200)` —— 那个装饰器是给 `@Post` 纠偏用的
 * （Nest 对 POST 默认 201）。
 *
 * ## 为什么 `levels/:levelId/plan` 单独一个端点
 *
 * 「这一档怎么渲染这一关」需要读关卡 spec 才能算出首轮从哪一段开始、哪张卡
 * 要藏正文。让前端拿 `firstRoundShape` 自己推导，等于把这套规则在前端再写
 * 一遍；而两份规则漂移时，症状是「同一个学习者在两处看到不同首屏」而不报错。
 */
import { Controller, Get, Inject, Param, Query, UseFilters } from '@nestjs/common';
import type {
  TierChangesResponse,
  TierLevelPlanResponse,
  TierOverviewResponse,
  TierSessionPlanResponse,
} from '@starmap/api-contract';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { TierService } from './tier.service.js';

@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class TierController {
  private readonly tierService: TierService;

  constructor(@Inject(DatabaseService) db: DatabaseService) {
    // 现场实例化，与 `RecommendController` / `AttemptsController` 一致：这样不必
    // 去改共享的 `app.module.ts` providers 数组（那是所有泳道的排队点）。
    this.tierService = new TierService(db);
  }

  /** 当前档位与六维参数。没定过级时 `source='fallback'`、参数回落 P1。 */
  @Get('tier')
  async overview(): Promise<TierOverviewResponse> {
    return this.tierService.overview();
  }

  /** 某一关在当前档位下的首轮渲染计划。 */
  @Get('tier/levels/:levelId/plan')
  async levelPlan(@Param('levelId') levelId: string): Promise<TierLevelPlanResponse> {
    return this.tierService.levelPlan(levelId);
  }

  /**
   * 档位变更历史（新的在前）。
   *
   * `limit` 用 `Query` 直接取字符串再自己夹取，不过契约 schema：查询参数的
   * 校验失败该是 400 而不是 500，而这里唯一可能的输入错误就是「不是数字」——
   * 那种情况退回默认值比拒绝请求更合理（前端从不主动传这个参数）。
   */
  @Get('tier/changes')
  async changes(@Query('limit') limit?: string): Promise<TierChangesResponse> {
    const parsed = Number(limit);
    const safe = Number.isFinite(parsed) ? Math.min(50, Math.max(1, Math.trunc(parsed))) : 10;
    return this.tierService.changes(safe);
  }

  /** 本次会话的下一步（受档位的会话新知识点上限约束）。 */
  @Get('tier/session-plan')
  async sessionPlan(): Promise<TierSessionPlanResponse> {
    return this.tierService.sessionPlan();
  }
}
