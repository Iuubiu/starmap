import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
  UseFilters,
} from '@nestjs/common';
import {
  GateHistoryResponseSchema,
  GateResponseSchema,
  LevelDetailResponseSchema,
  LevelExportFileSchema,
  LevelImportResponseSchema,
  LevelTemplateListResponseSchema,
  LevelTemplatePreviewResponseSchema,
  ReviewCompleteResponseSchema,
  ReviewQueueResponseSchema,
  ReviewRoundDetailResponseSchema,
  ReviewRoundStartResponseSchema,
  UnlockStateSchema,
  type GateHistoryResponse,
  type GateResponse,
  type LevelDetailResponse,
  type LevelExportFileView,
  type LevelImportResponse,
  type LevelImportRequest,
  type LevelTemplateListResponse,
  type LevelTemplatePreviewResponse,
  type ReviewCompleteResponse,
  type ReviewQueueResponse,
  type ReviewRoundDetailResponse,
  type ReviewRoundStartResponse,
  type UnlockState,
} from '@starmap/api-contract';
import {
  fillLevelTemplate,
  validateLevelSpec,
  type LevelSpec,
} from '@starmap/shared';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { GatingService } from '../gating/gating.service.js';
import { ReviewService } from '../review/review.service.js';
import { LEVEL_TEMPLATES, findLevelTemplate } from './level-templates.js';
import { ImportEnvelopeSchema } from './levels.export.js';
import { LevelsTransferService } from './levels-transfer.service.js';

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
 * 关卡查询与出口门控。
 *
 * 门控路由挂在这里而不是单开一个控制器，是因为它天然以关卡为入口
 * （`levels/:levelId/gate`），而 `nodes/:microKpId/unlock` 是同一个服务读的另一面。
 * 新开控制器还得往 `domains.ts` 加一行 —— 那个文件由 integrator 维护，
 * 为了三条路由去动共享文件不划算。
 *
 * SQL 里**不写 `app.` 前缀**：schema 由连接的 `search_path` 决定
 * （生产是 `app`，测试是 `app_test_*`）。写死前缀会让测试静默读到生产表，
 * 返回空结果而不报错。
 */
@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class LevelsController {
  private readonly gating: GatingService;
  private readonly review: ReviewService;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    // 现场实例化，与 attempts/mastery 控制器一致：这样不用改共享的 app.module.ts
    // 的 providers 数组。GatingService 自己无状态，构造成本可以忽略。
    this.gating = new GatingService(db);
    this.review = new ReviewService(db);
  }

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

    // 入口锁（票 06）：这张关卡挂在某个知识点上，而那个知识点可能还被它的先修门
    // 挡着。检查放在 spec 校验**之后**：坏 spec 是服务端数据问题，该报 500 并指出
    // 坏在哪一段；不该因为节点锁着就把一个坏关卡藏起来。
    //
    // 409 而不是 403，理由见 GatingService#lockedException：本应用没有登录态，
    // 403 语义是「你的身份不够」，而这里挡人的是学习进度而不是权限。
    await this.gating.requireUnlocked(row.micro_kp_id);

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

  /**
   * 评一次出口门控。
   *
   * `POST` 而不是 `GET`：通过时会写 `learning_log` 与 `node_unlocks`，带副作用
   * 的读请求会在预取/刷新/后退时被静默重放（理由详见契约片段里的注释）。
   *
   * 返回 200 不代表通过 —— 要读 `evaluation.passed` / `evaluation.verdict`：
   * 没通过（`failed`）与题量不足（`undetermined`）都是**一次成功的判定**，
   * 不是请求失败。
   */
  @Post('levels/:levelId/gate')
  @HttpCode(200)
  async evaluate(@Param('levelId') levelId: string): Promise<GateResponse> {
    const response = await this.gating.evaluate(levelId);
    return GateResponseSchema.parse(response);
  }

  /**
   * 这张关卡的门控判定历史，新的在前。
   *
   * 「可回看每次判定用了哪几题」的读端：每条评估里带 `itemIds`（做过的全部
   * 判定题）与 `wrongItemIds`（答错的）。判定当时就写死了题目 id，之后内容
   * 改了也不会让历史跟着变。
   */
  @Get('levels/:levelId/gate/history')
  async gateHistory(@Param('levelId') levelId: string): Promise<GateHistoryResponse> {
    const response = await this.gating.history(levelId);
    return GateHistoryResponseSchema.parse(response);
  }

  /**
   * 一个知识点的解锁状态。
   *
   * 锁是默认态：新节点天生锁着，只有真的过了一道门控才有解锁行。所以这个
   * 接口的 200 不代表开放，要读 `unlocked`。
   */
  @Get('nodes/:microKpId/unlock')
  async unlock(@Param('microKpId') microKpId: string): Promise<UnlockState> {
    const state = await this.gating.unlockState(microKpId);
    return UnlockStateSchema.parse(state);
  }

  // -------------------------------------------------------------------------
  // 票 07：复验与间隔排期
  // -------------------------------------------------------------------------

  /**
   * 此刻到期的复验队列。
   *
   * 空数组是正常状态（没到期的日子不该有复验）。到期判据与图谱「需复验」
   * 那一档读同一列（`mastery.next_review_at`）、同一个 `<= now` 比较，
   * 所以不会出现「图谱说有、抽考说没有」。
   */
  @Get('review/queue')
  async reviewQueue(): Promise<ReviewQueueResponse> {
    const now = await this.db.now();
    return ReviewQueueResponseSchema.parse(await this.review.queue(now));
  }

  /**
   * 开始一轮复验，返回交错后的题单。
   *
   * `POST` 而不是 `GET`：会写 `review_rounds` / `review_round_items` 两行。
   * 带副作用的读请求会在预取、刷新、后退时被静默重放 —— 每重放一次就多
   * 一轮没做完的会话。
   *
   * 没有到期知识点时返回 **409** 而不是空题单：这不是请求错了，是「现在
   * 不该开始复验」。空题单会让前端渲染出一个「0 题的测验」。
   */
  @Post('review/rounds')
  @HttpCode(200)
  async startReview(): Promise<ReviewRoundStartResponse> {
    const now = await this.db.now();
    return ReviewRoundStartResponseSchema.parse(await this.review.start(now));
  }

  /**
   * 判分。
   *
   * 幂等：会话一旦写死结果，重复请求原样返回存下来的判定，不再推进排期
   * （推进排期不是幂等操作，连点两次会推两档）。
   *
   * 还有题没答完 → 422，`details.missingItemIds` 列出缺哪几道。
   */
  @Post('review/rounds/:roundId/complete')
  @HttpCode(200)
  async completeReview(@Param('roundId') roundId: string): Promise<ReviewCompleteResponse> {
    return ReviewCompleteResponseSchema.parse(await this.review.complete(roundId));
  }

  /**
   * 读一回复验（判分前是题单，判分后是结果）。
   *
   * 刷新页面后回到同一份结果要靠它：判分是 `POST`，不能靠浏览器后退重放。
   */
  @Get('review/rounds/:roundId')
  async reviewRound(@Param('roundId') roundId: string): Promise<ReviewRoundDetailResponse> {
    return ReviewRoundDetailResponseSchema.parse(await this.review.detail(roundId));
  }

  // -------------------------------------------------------------------------
  // 票 66：关卡模板与导入导出
  // -------------------------------------------------------------------------

  /**
   * 内置模板列表。
   *
   * 模板存在代码里（`level-templates.ts`），不是一张表 —— 所以这条路由不碰
   * 数据库，是纯读常量。这也是「模板改了要跟着代码一起发布」的结构表达。
   */
  @Get('level-templates')
  listTemplates(): LevelTemplateListResponse {
    return LevelTemplateListResponseSchema.parse({ templates: [...LEVEL_TEMPLATES] });
  }

  /**
   * 用模板 + 学习者状态填一份**草稿**（不落库）。
   *
   * 为什么预览要真的走一遍 `fillLevelTemplate()` 而不是返回模板本身：作者要看
   * 的是「按我这个知识点、这个档位，这一关长什么样」——段数会随档位变（P1 七段
   * / P2 六段 / P3 五段），只看模板看不出这个差异。
   *
   * 填出来的草稿**在这里过一次校验器**：模板能拼出非法关卡的话，错误应该出现在
   * 作者点「预览」的时候，而不是等它落库之后变成学习者眼前的播放器白屏。
   * 校验不过属于服务端问题（模板是我们写的），所以 500 而不是 422。
   */
  @Post('level-templates/:templateId/preview')
  @HttpCode(200)
  async previewTemplate(
    @Param('templateId') templateId: string,
    @Body() body: unknown,
  ): Promise<LevelTemplatePreviewResponse> {
    const template = findLevelTemplate(templateId);
    if (!template) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `关卡模板不存在: ${templateId}`,
      });
    }

    const request = parsePreviewRequest(body);
    const microKpName = request.microKpName ?? (await this.knowledgePointName(request.microKpId));

    const draft = fillLevelTemplate(template, {
      microKpId: request.microKpId,
      microKpName,
      tier: request.tier ?? null,
    });

    const validated = validateLevelSpec(draft);
    if (!validated.ok) {
      throw new InternalServerErrorException({
        code: 'INTERNAL',
        message: `模板 ${templateId} 填出的草稿不合法（模板有 bug）`,
        details: validated.issues,
      });
    }

    return LevelTemplatePreviewResponseSchema.parse({
      persisted: false,
      templateId,
      // 草稿的 tier 已由 `fillLevelTemplate` 归一（未知值回落 P1），这里读回来
      // 而不是重复一遍归一逻辑 —— 两处各写一次必然漂移。
      tier: validated.spec.meta.tier,
      spec: validated.spec,
    });
  }

  /**
   * 导出一张关卡为 `starmap.level/1` 文件。
   *
   * `POST` 而不是 `GET`：导出会把「这一次导出的时刻」写进文件（`exportedAt`），
   * 而 `GET` 应该是可缓存、可预取的。带时间戳的读请求在预取时会被静默重放，
   * 拿到的文件时间戳各不相同 —— 那会让「同一关卡连按两次导出，除时间戳外字节
   * 相同」这条验收在浏览器缓存下变得不可验证。
   */
  @Post('levels/:levelId/export')
  @HttpCode(200)
  async exportLevel(@Param('levelId') levelId: string): Promise<LevelExportFileView> {
    const transfer = new LevelsTransferService(this.db);
    try {
      const file = await transfer.exportLevel(levelId);
      return LevelExportFileSchema.parse(file);
    } catch (error) {
      throw translateTransferError(error);
    }
  }

  /**
   * 从 `starmap.level/1` 文件导入一张新关卡。
   *
   * 422 与 400 的分界：**文件形状**不对（`format` 不是 `starmap.level/1`、缺字段、
   * 类型不对）是 400 —— 请求体本身不是这个接口的输入；**关卡内容**不合法
   * （spec 校验不过、摊平题表与 spec 不一致）是 422 —— 请求体形状对，但内容
   * 违反业务规则。两者的 `details` 都是字段级路径，前端可以逐条显示。
   */
  @Post('levels/import')
  @HttpCode(201)
  async importLevel(@Body() body: unknown): Promise<LevelImportResponse> {
    // 两道门，缺一不可：
    //   ① 信封（format / exportedAt / source / items 形状）→ 400
    //   ② 内容（spec 跨字段不变量 + 摊平题表与 spec 一致）→ 422
    // 不能合并成一次 `LevelExportFileSchema.safeParse`：那个 schema 内嵌了带
    // `superRefine` 的 `LevelSpecSchema`，内容错误会以「shape 不合法」的身份冒出来，
    // 于是「关卡内容写错了」被报成 400，且 details 是 Zod 的英文形状错误而不是
    // `validateLevelSpec` 那套字段级中文路径 —— 前端就没法定位到哪一段哪一题。
    const envelope = ImportEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '导入文件形状不对：需要 starmap.level/1 格式的导出文件',
        details: envelope.error.issues.map((issue) => ({
          path: issue.path.map((segment) => String(segment)).join('.'),
          message: issue.message,
          code: issue.code,
        })),
      });
    }

    const transfer = new LevelsTransferService(this.db);
    try {
      // `spec` 在信封里是 unknown（见 ImportEnvelopeSchema 的注释），由
      // `validateLevelSpec` 负责校验并返回强类型 —— 它是唯一的内容真源。
      const outcome = await transfer.importLevel(envelope.data as unknown as LevelImportRequest);
      return LevelImportResponseSchema.parse(outcome);
    } catch (error) {
      throw translateTransferError(error);
    }
  }

  /** 知识点名，用于填模板的占位正文。查不到时回落成 id（不编造名字）。 */
  private async knowledgePointName(microKpId: string): Promise<string> {
    const rows = await this.db.query<{ name: string }>(
      `SELECT name FROM knowledge_points WHERE id = $1`,
      [microKpId],
    );
    return rows[0]?.name ?? microKpId;
  }
}

/** 预览请求的宽松解析：只认 `microKpId` 必填，其余给默认。 */
function parsePreviewRequest(body: unknown): {
  microKpId: string;
  tier?: 'P1' | 'P2' | 'P3';
  microKpName?: string;
} {
  const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const microKpId = raw['microKpId'];
  if (typeof microKpId !== 'string' || microKpId.length === 0) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: '预览请求必须带 microKpId（草稿的 id 与 meta 都从它派生）',
      details: [{ path: 'microKpId', message: '缺少必填字段 microKpId', code: 'invalid_type' }],
    });
  }
  const tierRaw = raw['tier'];
  const tier =
    tierRaw === 'P1' || tierRaw === 'P2' || tierRaw === 'P3' ? (tierRaw as 'P1' | 'P2' | 'P3') : undefined;
  const nameRaw = raw['microKpName'];
  const microKpName = typeof nameRaw === 'string' && nameRaw.length > 0 ? nameRaw : undefined;
  return { microKpId, tier, microKpName };
}

/**
 * 把服务层抛的 `code` 翻译成 HTTP 状态。
 *
 * 服务层不依赖 `@nestjs/common`（它要能在非 HTTP 环境被测试与复用），所以它抛
 * 带 `code` 的普通 Error，由控制器翻译 —— 与 `gating.service.ts` 的
 * `lockedException` 是同一套分工。
 */
function translateTransferError(error: unknown): Error {
  const coded = error as { code?: string; message?: string; details?: unknown };
  if (coded?.code === 'NOT_FOUND') {
    return new NotFoundException({ code: 'NOT_FOUND', message: coded.message ?? '关卡不存在' });
  }
  if (coded?.code === 'INVALID_SPEC') {
    return new UnprocessableEntityException({
      code: 'VALIDATION_FAILED',
      message: coded.message ?? '关卡规范不合法',
      details: coded.details,
    });
  }
  return error instanceof Error ? error : new Error(String(error));
}
