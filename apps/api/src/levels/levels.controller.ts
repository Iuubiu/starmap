import {
  Controller,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import {
  GateHistoryResponseSchema,
  GateResponseSchema,
  LevelDetailResponseSchema,
  ReviewCompleteResponseSchema,
  ReviewQueueResponseSchema,
  ReviewRoundDetailResponseSchema,
  ReviewRoundStartResponseSchema,
  UnlockStateSchema,
  type GateHistoryResponse,
  type GateResponse,
  type LevelDetailResponse,
  type ReviewCompleteResponse,
  type ReviewQueueResponse,
  type ReviewRoundDetailResponse,
  type ReviewRoundStartResponse,
  type UnlockState,
} from '@starmap/api-contract';
import { validateLevelSpec, type LevelSpec } from '@starmap/shared';
import { DatabaseService } from '../db/database.service.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { GatingService } from '../gating/gating.service.js';
import { ReviewService } from '../review/review.service.js';

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
}
