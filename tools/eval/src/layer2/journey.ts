/**
 * 跑一个 persona 的全流程旅程。
 *
 * ## 职责边界
 *
 * - **执行**：按 `STAGE_DEFINITIONS` 顺序跑九个阶段，每阶段独立计时、独立截图、
 *   独立归类失败。
 * - **不判定**：这一步该不该算通过，由阶段自己给（`stages-impl.ts`）。这里只负责
 *   「把失败归到三类里」「出错不中断整条旅程」。
 * - **不改产品**：所有断言都是只读的（除了 `answer` 阶段的真实作答，那是评估
 *   本身要做的事，且按 persona 前缀隔离）。
 *
 * ## 三类失败的归类规则
 *
 * | 现象 | 归类 | 判据 |
 * | --- | --- | --- |
 * | 阶段自己返回 `locator_failure` | `locator_failure` | 元素/页面没找到 |
 * | 阶段自己返回 `backend_error` | `backend_error` | HTTP 非 2xx |
 * | 阶段自己返回 `assertion_mismatch` | `assertion_mismatch` | 两边数字/文本不一致 |
 * | 阶段抛异常且是 Playwright 超时 | `locator_failure` | `TimeoutError` / `waiting for` |
 * | 阶段抛异常且带 HTTP 状态 | `backend_error` | 错误消息里有 `HTTP 4xx/5xx` |
 * | 其他异常 | `assertion_mismatch` | 兜底：不静默吞掉，标成"未知断言失败" |
 *
 * 第四/五条是经验规则，覆盖「阶段没自己判但确实炸了」的情况。兜底到
 * `assertion_mismatch` 而不是 `crash` 是刻意的：**未知异常不该让整条旅程丢掉
 * 后续阶段的证据**。
 */

import { chromium, type Browser, type Page } from '@playwright/test';
import { EvalDriver } from './driver.ts';
import { assertStageOrder, STAGE_DEFINITIONS } from './stages-impl.ts';
import type { StageApi, StageContext, StageRecord, VerifyResult } from './stages.ts';
import type { Persona } from '../personas/schema.ts';
import { voiceOf } from './voice.ts';

export interface JourneyOptions {
  persona: Persona;
  webUrl: string;
  apiUrl: string;
  /** 截图与 trace 的输出目录。必须按 persona + 时间戳隔离。 */
  outputDir: string;
  /** 阶段之间额外等待（毫秒）。默认 0；调试时可调大。 */
  settleMs?: number;
  /** 只跑这些阶段（调试用）；省略则全跑。 */
  only?: readonly string[];
}

export interface JourneyResult {
  personaId: string;
  tier: string;
  displayName: string;
  startedAt: string;
  durationMs: number;
  webUrl: string;
  apiUrl: string;
  stages: StageRecord[];
  /** 三类失败的计数，报告直接吃。 */
  failures: {
    locatorFailure: number;
    backendError: number;
    assertionMismatch: number;
  };
  /** 走到的最大阶段（最后一个 passed 的 stage）。 */
  lastPassedStage: string | null;
  /** 第一个失败发生在哪一阶段。 */
  firstFailureStage: string | null;
  consoleErrors: string[];
  /** 浏览器是否成功启动；启动失败时整个 journey 是 infra 问题不是产品问题。 */
  browserLaunched: boolean;
}

/** 用 stage 上的 API 客户端打后端。从不抛异常：状态码是断言对象。 */
/**
 * 后端不可达时的重试。
 *
 * ## 为什么需要
 *
 * 开发时 `pnpm --filter @starmap/api dev` 是 `tsx watch`：任何被监视的源文件
 * 一改就重启进程，重启窗口里连接直接被拒（`fetch failed`，`status: 0`）。
 * 本工具跑一次三档要两分钟，期间别的泳道在写代码，撞上重启窗口几乎必然。
 *
 * 实测：一次三档连跑里 `Nest application successfully started` 出现了 12 次，
 * 四条失败全部是 `httpStatus: 0` / `fetch failed` —— 一条也不是产品缺陷。
 * 不重试的话报告会写「P1 卡在知识图谱」，而实际只是那 300ms 里后端在重启。
 *
 * ## 边界
 *
 * 只重试**网络层失败**（`status: 0`）。4xx/5xx 不重试：那是后端真的在回答
 * 「不行」，再问一次答案一样，只会拖长跑批时间。重试 2 次、间隔 500/1500ms
 *（总上限 ~2s）—— 重启通常 1–3 秒，再长就是真挂了，那时应该报错而不是
 * 继续等。
 */
const UNREACHABLE_DELAYS_MS = [500, 1500];

function makeStageApi(apiUrl: string, timeoutMs = 20_000): StageApi {
  const base = apiUrl.replace(/\/$/, '');
  const once = async (path: string, init: RequestInit): Promise<{ status: number; body: unknown; rawText: string }> => {
    try {
      const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      const rawText = await response.text();
      let body: unknown = rawText;
      try {
        body = rawText.length === 0 ? null : (JSON.parse(rawText) as unknown);
      } catch {
        /* 保留文本，调用方自己判。 */
      }
      return { status: response.status, body, rawText };
    } catch (error) {
      return { status: 0, body: null, rawText: `网络错误：${(error as Error).message}` };
    }
  };

  const call = async (path: string, init: RequestInit): Promise<{ status: number; body: unknown; rawText: string }> => {
    let last = await once(path, init);
    for (let attempt = 0; attempt < UNREACHABLE_DELAYS_MS.length && last.status === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, UNREACHABLE_DELAYS_MS[attempt]));
      last = await once(path, init);
    }
    /* 重试过仍然不通时把次数写进 rawText：报告里看到「重试 2 次仍失败」
       和「一次就失败」是两件事，后者更像真的配错了地址。 */
    if (last.status === 0) {
      last = { ...last, rawText: `${last.rawText}（已重试 ${UNREACHABLE_DELAYS_MS.length} 次）` };
    }
    return last;
  };
  return {
    getJson: (path) => call(path, { method: 'GET', headers: { accept: 'application/json' } }),
    postJson: (path, body) =>
      call(path, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}

/**
 * 把阶段抛出的异常归类。
 *
 * Playwright 的超时消息里一定有 `Timeout` 与选择器描述；HTTP 状态从我们自己的
 * `status: 0` 约定里来。两条都不是靠猜——下面每条判断都对应一个真实会出现的
 * 报错形状。
 *
 * 导出是为了能被单测直接覆盖：三类分开计数是报告的地基，合并成「失败 5 条」
 * 等于把「按钮不存在」和「计数差 1」当成同一件事。
 */
export function classifyThrown(error: unknown): VerifyResult {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || /Timeout \d+ms exceeded|waiting for (locator|selector)/i.test(message)) {
    return { status: 'locator_failure', selector: '（见异常消息）', detail: `阶段抛超时异常：${message.split('\n')[0]?.slice(0, 300)}` };
  }
  const httpMatch = /HTTP\s+(\d{3})/.exec(message);
  if (httpMatch?.[1]) {
    return { status: 'backend_error', httpStatus: Number(httpMatch[1]), responseBody: message.slice(0, 800), detail: '阶段抛 HTTP 错误' };
  }
  return {
    status: 'assertion_mismatch',
    expected: '阶段正常完成',
    actual: `${name}: ${message.split('\n')[0]?.slice(0, 300)}`,
    detail: '阶段抛出未归类异常（兜底到 assertion_mismatch，避免整条旅程中断）',
  };
}

/** 跑完整旅程。**不会因为某一阶段失败而中断** —— 后面的阶段仍要留下证据。 */
export async function runJourney(options: JourneyOptions): Promise<JourneyResult> {
  assertStageOrder();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const persona = options.persona;
  const voice = voiceOf(persona);
  const api = makeStageApi(options.apiUrl);
  const carry = new Map<string, string>();
  const stages: StageRecord[] = [];
  const consoleErrors: string[] = [];

  let browser: Browser | null = null;
  let driver: EvalDriver | null = null;
  let page: Page | null = null;
  let browserLaunched = false;

  const selected = STAGE_DEFINITIONS.filter((definition) => !options.only || options.only.includes(definition.stage));

  try {
    browser = await chromium.launch();
    browserLaunched = true;
    driver = await EvalDriver.create(browser, { baseUrl: options.webUrl, stepTimeoutMs: 15_000, settleMs: 300 });
    page = driver.page;

    /* 关卡页与详情页都要用到知识点 id。从接口直接拿比从 DOM 反推可靠：
       DOM 上的 aria-label 只有名字，没有 id。 */
    const graph = await api.getJson('/graph');
    if (graph.status === 200) {
      const nodes = (graph.body as { nodes?: Array<{ microKpId?: string; name?: string }> }).nodes ?? [];
      const bool = nodes.find((node) => node.name === '布尔代数基本运算');
      if (bool?.microKpId) carry.set('microKpId', bool.microKpId);
    }

    for (const definition of selected) {
      const stageStarted = performance.now();
      const stageStartedAt = new Date().toISOString();
      const consoleBefore = driver.consoleErrors.length;
      let result: VerifyResult;
      let evidence: string[] = [];

      const context: StageContext = { page, api, persona: voice, carry };
      try {
        const outcome = await definition.run(context);
        result = outcome.result;
        evidence = outcome.evidence;
      } catch (error) {
        result = classifyThrown(error);
      }

      const stageConsole = driver.consoleErrors.slice(consoleBefore);
      consoleErrors.push(...stageConsole);

      /* 失败一定截图；通过也截（报告里"这一步真的发生了"的视觉证据）。
         截图失败不能让旅程挂掉 —— 它只是证据缺失，不是产品缺陷。 */
      const shotName = `${String(stages.length).padStart(2, '0')}-${definition.stage}.png`;
      let screenshot: string | null = null;
      try {
        await page.screenshot({ path: `${options.outputDir}/${shotName}`, fullPage: false });
        screenshot = shotName;
      } catch {
        screenshot = null;
      }

      stages.push({
        stage: definition.stage,
        label: definition.label,
        url: page.url(),
        startedAt: stageStartedAt,
        durationMs: Math.round(performance.now() - stageStarted),
        result,
        evidence,
        screenshot,
        consoleErrors: stageConsole,
      });

      if (options.settleMs && options.settleMs > 0) await page.waitForTimeout(options.settleMs);
    }
  } catch (error) {
    /* 浏览器起不来 / 上下文创建失败：记一条 infra 失败，不装作跑完了。 */
    stages.push({
      stage: 'infra',
      label: '基础设施',
      url: '',
      startedAt,
      durationMs: Math.round(performance.now() - started),
      result: {
        status: 'backend_error',
        httpStatus: 0,
        responseBody: '',
        detail: `浏览器/上下文启动失败：${(error as Error).message.split('\n')[0]?.slice(0, 300)}`,
      },
      evidence: [],
      screenshot: null,
      consoleErrors: [],
    });
  } finally {
    await driver?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }

  const count = (status: string): number => stages.filter((stage) => stage.result.status === status).length;
  const firstFailure = stages.find((stage) => stage.result.status !== 'passed');
  const lastPassed = [...stages].reverse().find((stage) => stage.result.status === 'passed');

  return {
    personaId: persona.id,
    tier: persona.tier,
    displayName: persona.displayName,
    startedAt,
    durationMs: Math.round(performance.now() - started),
    webUrl: options.webUrl,
    apiUrl: options.apiUrl,
    stages,
    failures: {
      locatorFailure: count('locator_failure'),
      backendError: count('backend_error'),
      assertionMismatch: count('assertion_mismatch'),
    },
    lastPassedStage: lastPassed?.stage ?? null,
    firstFailureStage: firstFailure?.stage ?? null,
    consoleErrors,
    browserLaunched,
  };
}

/** 人可读摘要（命令行输出用）。 */
export function summarizeJourney(result: JourneyResult): string {
  const lines: string[] = [
    '',
    `旅程 · ${result.tier} ${result.displayName}（${result.personaId}）`,
    `web=${result.webUrl}  api=${result.apiUrl}  耗时=${(result.durationMs / 1000).toFixed(1)}s`,
    '─'.repeat(78),
  ];
  for (const stage of result.stages) {
    const mark = stage.result.status === 'passed' ? '✓' : '✗';
    lines.push(`${mark} ${stage.label} (${stage.durationMs}ms)${stage.screenshot ? `  截图 ${stage.screenshot}` : ''}`);
    lines.push(`   ${stage.result.detail}`);
    for (const item of stage.evidence.slice(0, 4)) lines.push(`   · ${item}`);
    if (stage.result.status === 'backend_error') {
      lines.push(`   HTTP ${stage.result.httpStatus ?? '?'}：${(stage.result.responseBody ?? '').slice(0, 200)}`);
    }
    if (stage.result.status === 'assertion_mismatch') {
      lines.push(`   期望 ${stage.result.expected} / 实际 ${stage.result.actual}`);
    }
  }
  lines.push('─'.repeat(78));
  lines.push(
    `找不到目标 ${result.failures.locatorFailure} 次 · 后端报错 ${result.failures.backendError} 次 · 数字对不上 ${result.failures.assertionMismatch} 次`,
  );
  lines.push(`最后通过的阶段：${result.lastPassedStage ?? '无'}；第一个失败：${result.firstFailureStage ?? '无'}`);
  if (result.consoleErrors.length > 0) lines.push(`console error ${result.consoleErrors.length} 条（前 3：${result.consoleErrors.slice(0, 3).join(' | ')})`);
  return lines.join('\n');
}
