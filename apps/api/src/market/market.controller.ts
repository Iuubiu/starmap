import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  MarketDraftRequestSchema,
  MarketDraftResponseSchema,
  MarketLevelDetailResponseSchema,
  MarketLevelListResponseSchema,
  MarketSaveLevelResponseSchema,
  type MarketDraftResponse,
  type MarketLevelDetailResponse,
  type MarketLevelListResponse,
  type MarketSaveLevelResponse,
} from '@starmap/api-contract';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { DatabaseService } from '../db/database.service.js';
import { MarketService } from './market.service.js';

/**
 * 关卡市场（票 14）。
 *
 * 归属泳道：authoring-dev。
 *
 * ## 四条路由，没有第五条
 *
 *   GET  /market/levels         预制 + 自保存，一屏列表
 *   POST /market/levels         保存自制关卡（先过校验器）
 *   POST /market/drafts         把一段学习过程打包成草稿
 *   GET  /market/levels/:id     单张关卡 + 完整 spec（编辑 / 重新开始）
 *
 * **没有 publish / share / 分发类路由**：spec.md:496 把「关卡市场的真实分发」
 * 列为 Out of Scope，当前只做「保存」。加一条 `/market/publish` 就等于承诺了
 * 一个不存在的语义。
 *
 * ## 参数校验放在控制器，业务放在 service
 *
 * 项目没有全局 `ValidationPipe`（main.ts 只装了过滤器），所以请求体一律显式
 * `safeParse`。放在控制器里是因为 400 与 422 的边界是**语法 vs 语义**：
 * 请求体不成形是 400，成型但关卡不合法才是 422 —— 前者在这里报，后者在
 * `MarketService.save()` 报（那里才能拿到校验器的字段级 issues）。
 *
 * ## 为什么 `MarketService` 是 new 出来的而不是注入的
 *
 * `app.module.ts` 的 providers 是 integrator 的合并点，注册一个只被本控制器
 * 使用的 service 会让「新增市场功能」变成两处联动改动。这里现场构造，依赖
 * 仍然只有 `DatabaseService`（由根模块提供），换一天要提成正式 provider 时
 * 只需把构造挪到构造函数参数上。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class MarketController {
  private readonly market: MarketService;

  constructor(@Inject(DatabaseService) db: DatabaseService) {
    this.market = new MarketService(db);
  }

  @Get('market/levels')
  async list(): Promise<MarketLevelListResponse> {
    return MarketLevelListResponseSchema.parse(await this.market.list());
  }

  @Get('market/levels/:levelId')
  async get(@Param('levelId') levelId: string): Promise<MarketLevelDetailResponse> {
    return MarketLevelDetailResponseSchema.parse(await this.market.get(levelId));
  }

  @Post('market/drafts')
  // Nest 的 @Post 默认 201。这里显式 200：草稿是**读操作的产物**（由已有
  // attempts 拼出来），没有在服务端创建可寻址的新资源 —— 草稿要等用户点保存
  // 才成为资源。契约（market.mjs）把成功码写成 200，两边必须一致。
  @HttpCode(200)
  async createDraft(@Body() body: unknown): Promise<MarketDraftResponse> {
    const parsed = MarketDraftRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '请求参数不合法：microKpId 必填',
        details: parsed.error.issues,
      });
    }
    const draft = await this.market.buildDraft(parsed.data.microKpId, parsed.data.sessionId);
    return MarketDraftResponseSchema.parse(draft);
  }

  @Post('market/levels')
  // 同上：保存走 200 + `created` 区分新建/覆盖（见 market.mjs 的注释）。
  // 用 201 表达「新建」会让覆盖保存没有对应的成功码，又得引入 200，
  // 于是前端多出一条按状态码分支的逻辑，而它能提供的信息 created 已经给了。
  @HttpCode(200)
  async save(@Body() body: unknown): Promise<MarketSaveLevelResponse> {
    return MarketSaveLevelResponseSchema.parse(await this.market.save(body));
  }
}
