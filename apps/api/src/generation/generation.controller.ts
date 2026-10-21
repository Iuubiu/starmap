/**
 * 票 16 的 HTTP 面：发起批量生成、看进度、看历史。
 *
 * ## 三条路由的分工
 *
 *   POST /api/v1/market/generations          发起（默认后台跑，立刻返回 runId）
 *   GET  /api/v1/market/generations          最近若干次运行（只给头部计数）
 *   GET  /api/v1/market/generations/{runId}  一次运行的完整视图（含逐条失败原因）
 *
 * ## 为什么默认后台跑
 *
 * 票 16 验收①要求「可后台跑并观察进度」。如果 POST 一直挂到整批跑完，那
 * 就不存在「观察进度」这件事 —— 前端只能等，等到超时。默认立刻返回、由前端
 * 轮询 `runId`，才是这个验收项要求的形状。`wait: true` 只给测试与 CLI 用。
 *
 * ## 为什么没有取消/删除路由
 *
 * 取消需要能中断正在跑的 workflow，而它跑在 Mastra 的执行引擎里；
 * 半途杀掉会留下「任务行还是 running、关卡可能写了一半」的状态。这一版
 * 不做，而是靠幂等重跑覆盖 —— 一条跑坏的任务重跑一次就能修好，比实现
 * 一个可靠的取消语义便宜得多。这个取舍记在票的 Comments 里。
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import {
  GenerationRunListResponseSchema,
  GenerationRunRequestSchema,
  GenerationRunSchema,
  type GenerationRun,
  type GenerationRunListResponse,
  type GenerationRunRequest,
} from '@starmap/api-contract';
import { randomUUID } from 'node:crypto';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { DatabaseService } from '../db/database.service.js';
import { LLM_PORT, type LlmPort } from '../llm/llm.port.js';
import { GenerationService } from './generation.service.js';
import { QUESTIONS_PER_KP } from './constants.js';
import { createGenerationWorkflow, type GenerationItemResult } from './generation.workflow.js';

/**
 * 票 16 指定的并发度。
 *
 * 4 是票面写死的值（`.foreach(spec, { concurrency: 4 })`），不是随手取的。
 * 请求可以调低（排查限流时降到 1），但不给调高的默认值 —— 上游配额由
 * `concurrency` 上限 8 兜底。
 */
const DEFAULT_CONCURRENCY = 4;

/**
 * 正在跑的运行。进程内 Map 就够了，理由是：
 *
 *   - 「这批还在跑吗」只在**发起它的那个进程**里为真。跨进程看进度应该查
 *     DB 里的运行状态（`GET /generations/{runId}` 就是这么做的）。
 *   - 重启后 Map 清空，但 DB 里状态是 `running` 的运行会被
 *     `reapStaleRuns()` 标成 failed。也就是说这个 Map 丢数据不会造成
 *     「永远显示在跑」。
 *
 * 存 Promise 而不是存 workflow 句柄：目的是「服务关闭时能等它跑完」，
 * 而不是「能取消它」（不实现取消，见文件头）。
 */
const inFlight = new Map<string, Promise<void>>();

@Controller('api/v1')
@UseFilters(ApiExceptionFilter)
export class GenerationController {
  private readonly logger = new Logger(GenerationController.name);
  private readonly generation: GenerationService;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
  ) {
    // 与 MarketController 同样的做法：service 用 new 而不是 DI provider。
    // 理由见 market.controller.ts 顶部的注释 —— app.module.ts 是合并点，
    // 每加一个 provider 都要 integrator 动手。
    this.generation = new GenerationService(db);
  }

  /**
   * 发起一次批量生成。
   *
   * 返回 200 而不是 201：这不是「创建了一个可寻址资源」—— 运行本身在
   * GET /generations/{runId} 能查到，但语义上这次调用是「启动一个已经
   * 规划好的作业」，与 MarketController 保存关卡的判断一致（见那里注释）。
   */
  @Post('market/generations')
  @HttpCode(200)
  async start(@Body() body: unknown): Promise<GenerationRun> {
    const parsed = GenerationRunRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '请求体不合法：microKpIds 与 limit 至少给一个，并发度 1–8，每个知识点的题数 3–8',
        details: parsed.error.issues,
      });
    }
    const request: GenerationRunRequest = parsed.data;

    // 目标知识点：给了 id 列表就用它，否则按「最缺关卡」自动挑。
    // 这里会**校验 id 是否存在**并 404，而不是让它们跑到 workflow 里各自
    // 失败 —— 「你给了 5 个 id，其中 2 个不存在」应该在发起时就告诉调用方，
    // 而不是让他等一批跑完再从失败明细里看出来。
    let microKpIds: string[];
    if (request.microKpIds !== undefined) {
      microKpIds = [...new Set(request.microKpIds)];
      const missing = await this.findMissing(microKpIds);
      if (missing.length > 0) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `这些知识点不存在：${missing.slice(0, 5).join('、')}${missing.length > 5 ? ` 等 ${missing.length} 个` : ''}`,
        });
      }
    } else {
      microKpIds = await this.generation.pickTargets(request.limit ?? DEFAULT_CONCURRENCY);
      if (microKpIds.length === 0) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: '没有可生成的知识点：没有哪个叶子知识点有足够长的教材片段',
        });
      }
    }

    const concurrency = request.concurrency ?? DEFAULT_CONCURRENCY;
    // 每个知识点出几道题。不传则用常量 5（票面「每关 5–8 题」的下界）；
    // 下限 3 与 `MASTERY_MIN_VARIANTS` 对齐 —— 少于 3 道题就凑不出 3 个
    // 变式组，那张关卡无论如何答都到不了「已掌握」。
    const questionsPerKp = request.questionsPerKp ?? QUESTIONS_PER_KP;
    const runId = `run-${randomUUID()}`;

    // 建运行 + 明细。若这一步失败，什么都没开始跑，调用方拿到 500 即可。
    await this.generation.createRun({ runId, microKpIds, concurrency });

    // 后台跑。**不 await** —— 这是「可后台跑」的实现点。
    const execution = this.execute(runId, microKpIds, concurrency, questionsPerKp);
    inFlight.set(runId, execution);
    void execution.finally(() => inFlight.delete(runId));

    if (request.wait === true) {
      await execution;
    }

    const run = await this.generation.getRun(runId);
    if (!run) {
      // 只有一种可能：createRun 成功但立刻被别的东西删了。防御性返回 500。
      throw new NotFoundException({ code: 'NOT_FOUND', message: `运行记录不存在: ${runId}` });
    }
    return GenerationRunSchema.parse(run);
  }

  @Get('market/generations')
  async list(@Query('limit') rawLimit?: string): Promise<GenerationRunListResponse> {
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'limit 必须是 1–100 的整数',
      });
    }
    return GenerationRunListResponseSchema.parse(await this.generation.listRuns(limit));
  }

  @Get('market/generations/:runId')
  async get(@Param('runId') runId: string): Promise<GenerationRun> {
    const run = await this.generation.getRun(runId);
    if (!run) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `运行记录不存在: ${runId}` });
    }
    return GenerationRunSchema.parse(run);
  }

  /**
   * 真正跑这一批。
   *
   * 这个方法**不抛异常**（除了自己内部的日志）：它跑在后台，抛出去会变成
   * 未处理的 rejection，把进程带崩。所有失败都折算成任务行上的状态。
   */
  private async execute(
    runId: string,
    microKpIds: string[],
    concurrency: number,
    questionsPerKp: number,
  ): Promise<void> {
    try {
      const workflow = createGenerationWorkflow(
        {
          llm: this.llm,
          loadMaterial: (microKpId) => this.generation.loadMaterial(microKpId),
          persist: (spec, microKpId) =>
            // spec 在这里是 unknown（workflow 的输出要能进快照），但
            // assembleLevelSpec() 已经保证了它是 LevelSpec。这个断言是
            // 那个保证的唯一出口，注释在此，不改类型去污染 workflow。
            this.generation.persistSpec(spec as Parameters<GenerationService['persistSpec']>[0], microKpId),
          onTaskStatus: (update) =>
            this.generation.markTask({
              runId,
              microKpId: update.microKpId,
              status: update.status,
              failureKind: update.failureKind ?? null,
              failureMessage: update.failureMessage ?? null,
              failureDetail: update.failureDetail,
              levelId: update.levelId ?? null,
            }),
        },
        { concurrency, runId, questionsPerKp },
      );

      const run = await workflow.createRun();
      const result = await run.start({ inputData: { runId, microKpIds } });

      if (result.status !== 'success') {
        // workflow 层失败（不是单个条目失败 —— 那些已经在 output 里）。
        // 到这里的可能原因：step 定义有 bug、快照存储挂了。
        this.logger.error(`批量生成 ${runId} 的 workflow 未成功：${result.status}`);
        await this.generation.finishRun(runId, `[workflow ${result.status}]`);
        return;
      }

      await this.generation.recordResults(runId, (result.result ?? []) as GenerationItemResult[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`批量生成 ${runId} 执行失败：${message}`);
      // 尽力收尾。如果连 failRunRun 都失败（DB 挂了），状态会停在 running，
      // 由 reapStaleRuns() 在下次启动时收拾。
      await this.generation
        .finishRun(runId, `[执行失败] ${message}`)
        .catch(() => undefined);
    }
  }

  /** 找出不存在的知识点 id。用一次 `= ANY` 而不是逐个查。 */
  private async findMissing(ids: readonly string[]): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM knowledge_points WHERE id = ANY($1::text[])`,
      [ids],
    );
    const found = new Set(rows.map((r) => r.id));
    return ids.filter((id) => !found.has(id));
  }
}

/**
 * 服务关闭时等正在跑的批量生成收尾。
 *
 * 导出成独立函数而不是 controller 的方法，是因为 `main.ts` 里在
 * `app.enableShutdownHooks()` 之后需要调它 —— 挂到 Nest 的
 * `onModuleDestroy` 上需要 controller 实现接口，而 main.ts 已经是现成的
 * 生命周期钩子点，改一处比改两处扩散小。
 *
 * 有超时：不能为了等一批 AI 生成让整个进程卡住。等不到就让它们留在
 * `running`，下次启动由 `reapStaleRuns()` 收拾 —— 这与**不实现取消**是
 * 同一个取舍的两面（见 controller 头部注释）。
 */
export async function drainGeneration(timeoutMs = 20_000): Promise<void> {
  if (inFlight.size === 0) return;
  const all = Promise.allSettled([...inFlight.values()]);
  await Promise.race([
    all,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
  ]);
}
