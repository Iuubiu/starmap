import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, UseFilters } from '@nestjs/common';
import {
  RedirectRequestSchema,
  type RecommendationListResponse,
  type RedirectResponse,
} from '@starmap/api-contract';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { RecommendService } from './recommend.service.js';

/**
 * 今日推荐与改道。
 *
 * ## 为什么在控制器里 `new` 服务而不是注入 provider
 *
 * `app.module.ts` 的 `providers` 数组是共享写入点（integrator 维护）。为加一个
 * Service 去改它，等于让每条并行泳道在同一个数组里排队——`market.controller.ts`
 * 已经踩过这个坑。控制器本身是各自领域文件，构造器里现场 `new` 是这台仓库
 * 既有的做法（见 `AttemptsController`）。
 *
 * ## 为什么改道是 POST 而不是 PATCH
 *
 * 它不改任何已有资源的字段，只往事件流里追加一条「我拒绝了 A，改去 B」。
 * 事件一旦写下就不能改（否则「不反复推同一个」的判据会被人为抹掉），所以
 * 动词是「追加」而不是「更新」。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class RecommendController {
  private readonly recommendService: RecommendService;

  constructor(@Inject(DatabaseService) db: DatabaseService) {
    this.recommendService = new RecommendService(db);
  }

  @Get('recommendations')
  async list(): Promise<RecommendationListResponse> {
    return this.recommendService.list();
  }

  @Post('recommendations/redirect')
  @HttpCode(200)
  async redirect(@Body() body: unknown): Promise<RedirectResponse> {
    // 请求体来自网络，先过契约再进业务：类型断言不会在运行时兜底，而缺字段
    // 会在 SQL 层变成「undefined 拼进参数数组」，报出来的错跟真正的原因无关。
    const parsed = RedirectRequestSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: `请求体不合法：${detail}`,
      });
    }
    return this.recommendService.redirect(parsed.data);
  }
}
