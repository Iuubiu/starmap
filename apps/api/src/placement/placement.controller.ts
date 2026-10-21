import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseFilters,
  BadRequestException,
} from '@nestjs/common';
import {
  PlacementAnswerRequestSchema,
  PlacementStartRequestSchema,
  SelfAssessmentSubmitRequestSchema,
  type PlacementAnswerResponse,
  type PlacementRejudgeResponse,
  type PlacementResultResponse,
  type PlacementSessionResponse,
  type PlacementStatusResponse,
  type SelfAssessmentFormResponse,
  type SelfAssessmentSubmitResponse,
} from '@starmap/api-contract';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { DatabaseService } from '../db/database.service.js';
import { PlacementService } from './placement.service.js';

/**
 * 初始定级（票 11）的接口。
 *
 * ## 为什么服务是现场 new 的
 *
 * `apps/api/src/app.module.ts` 的 `providers` 是共享文件（integrator 维护），
 * 而 `AppModule` 的注释要求「控制器用到的 Service 必须在 providers 里」。
 * 为加一个 Service 去改共享文件会让每条泳道在同一个数组上排号 ——
 * `attempts` 与 `market` 两个控制器已经踩过并留下了这个写法，这里照抄。
 *
 * ## 为什么六条路由都显式 `@HttpCode(200)`
 *
 * Nest 对 `@Post` 的默认状态码是 **201 Created**。定级里的三个 POST
 * （提交自评、开一次定级、提交一道作答）返回的都**不是新建资源的句柄**：
 * 自评返回的是先验，定级返回的是「当前状态 + 下一道题」，作答复核返回的是
 * 判定与下一个状态。用 201 会让前端的通用错误处理、以及任何按 2xx 细分的
 * 调用方把「拿到状态快照」误解成「有资源被创建」。
 *
 * 这类偏差不会在单元测试里暴露 —— 只有真发一次请求才看得见。所以
 * `placement.controller.test.ts` 对每个 POST 都断言 `200` 而不是「2xx」。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class PlacementController {
  private readonly placement: PlacementService;

  constructor(@Inject(DatabaseService) db: DatabaseService) {
    this.placement = new PlacementService(db);
  }

  /** 行为自评问卷（4 题，只问行为）。 */
  @Get('placement/self-assessment')
  form(): SelfAssessmentFormResponse {
    return this.placement.form();
  }

  /**
   * 提交自评。
   *
   * 只回先验，**不建会话**：自评结果是「起手往哪边挪一点」，会话要等
   * 第一道题真正发出去才有意义。分成两个请求是为了让前端能在自评后、
   * 开题前展示一句「我们据此把你的起点略微上移」——那正是自评该有的分量。
   */
  @Post('placement/self-assessment')
  @HttpCode(200)
  async submitSelfAssessment(@Body() body: unknown): Promise<SelfAssessmentSubmitResponse> {
    const parsed = SelfAssessmentSubmitRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '请求体不合法',
        details: parsed.error.issues,
      });
    }
    return this.placement.submitSelfAssessment(parsed.data);
  }

  @Post('placement/sessions')
  @HttpCode(200)
  async start(@Body() body: unknown): Promise<PlacementSessionResponse> {
    const parsed = PlacementStartRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '请求体不合法',
        details: parsed.error.issues,
      });
    }
    return this.placement.start(parsed.data);
  }

  @Get('placement/sessions/:sessionId')
  async session(@Param('sessionId') sessionId: string): Promise<PlacementSessionResponse> {
    return this.placement.sessionView(sessionId);
  }

  @Post('placement/sessions/:sessionId/answers')
  @HttpCode(200)
  async answer(
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
  ): Promise<PlacementAnswerResponse> {
    const parsed = PlacementAnswerRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '请求体不合法',
        details: parsed.error.issues,
      });
    }
    return this.placement.answer(sessionId, parsed.data);
  }

  @Get('placement/sessions/:sessionId/result')
  async result(@Param('sessionId') sessionId: string): Promise<PlacementResultResponse> {
    return this.placement.result(sessionId);
  }

  /**
   * 当前档位状态。
   *
   * 没定过级时返回 `status: "none"`、`tier: null`，**不是 404**：新用户
   * 没定过级是正常状态，前端据此决定要不要引导他去定级，而不是弹一个
   * 「找不到」的红条。
   */
  @Get('placement')
  async status(): Promise<PlacementStatusResponse> {
    return this.placement.status();
  }

  /**
   * 用学习证据重判。
   *
   * 没有请求体：重判读的是已有的学习证据，不是重答定级题。前端不该为
   * 一个「你学得怎么样」的结论提供任何输入。
   */
  @Post('placement/rejudge')
  @HttpCode(200)
  async rejudge(): Promise<PlacementRejudgeResponse> {
    return this.placement.rejudge();
  }
}
