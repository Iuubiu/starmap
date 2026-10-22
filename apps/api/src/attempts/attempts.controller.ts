import { Body, Controller, HttpCode, Inject, Post, UseFilters } from '@nestjs/common';
import {
  AttemptSubmitRequestSchema,
  type AttemptSubmitResponse,
} from '@starmap/api-contract';
import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { MasteryService } from '../mastery/mastery.service.js';
import { AttemptsService } from './attempts.service.js';

/**
 * 记录一次作答。
 *
 * ## 为什么服务是现场 new 的
 *
 * `apps/api/src/app.module.ts` 的 `providers` 是共享文件（integrator 维护），
 * 而 `AppModule` 的注释明确写着「控制器用到的 Service 必须在这下面的
 * providers 里」。为了加两个 Service 去改共享文件会让每条泳道都在同一个
 * 数组上排号 —— `market` 泳道已经踩过这个问题并留下了这个写法（见
 * `market.controller.ts`），这里照抄。
 *
 * ## 为什么请求体解析失败返回 400 而题目不存在返回 404
 *
 * 「你发的 JSON 不成形」与「你要的东西没有」是两件事，前端要据此决定是
 * 弹个红条还是回退到关卡列表。统一成 400 会让后者看起来像自己的错。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class AttemptsController {
  private readonly attempts: AttemptsService;

  constructor(@Inject(DatabaseService) db: DatabaseService) {
    // MasteryService 与 AttemptsService 都只依赖 DatabaseService，构造它们
    // 不需要容器参与。显式依赖关系也比分装在两个 provider 里更好读。
    this.attempts = new AttemptsService(db, new MasteryService(db));
  }

  @Post('attempts')
  @HttpCode(200)
  async submit(@Body() body: unknown): Promise<AttemptSubmitResponse> {
    const parsed = AttemptSubmitRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '请求体不合法',
        details: parsed.error.issues,
      });
    }
    return this.attempts.record(parsed.data);
  }
}
