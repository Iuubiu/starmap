/**
 * 第二层：全流程旅程的**可断言步骤**定义。
 *
 * ## 与旧 `run-walkthrough.ts` 的区别
 *
 * 旧的只走 3 步，而且只记「动作成功/失败」。票 20 要求的是「每一步都要有
 * 断言这次真的发生了什么」——「页面打开了」不算证据。所以这里每个阶段
 * 都带一个 `verify`：它拿浏览器当时的真实状态去核对（DOM 属性、接口响应、
 * 数据库行数），核对不过就是一个**可归类的失败**。
 *
 * ## 三类失败的区分（票 20 硬要求）
 *
 * - `locator_failure`：动作解析不到目标 —— 界面元素找不到。记选择器 + 截图。
 * - `backend_error`：页面在、动作执行了，但后端返回 4xx/5xx。记状态码 + 响应体。
 * - `assertion_mismatch`：页面与后端都正常，但两边数字对不上。记两边值。
 *
 * 三者修法完全不同：第一个可能只是选择器写法、第二个是接口挂了、第三个是
 * 真逻辑 bug。混成一个「失败」计数会让报告失去全部诊断价值。
 *
 * ## 为什么阶段定义是数据而不是函数
 *
 * 阶段与 persona 无关 —— 换成 P3 走的是同一批页面。写成数据表，报告里的
 * 漏斗矩阵、覆盖率、失败归因才能统一算；写成散落的函数，三档之间迟早漂移。
 */

import type { Page } from '@playwright/test';

/** 三类可归因失败 + 通过。 */
export type VerifyStatus = 'passed' | 'locator_failure' | 'backend_error' | 'assertion_mismatch';

export interface VerifyFailure {
  status: Exclude<VerifyStatus, 'passed'>;
  /** 失败描述；报告里逐条列出。 */
  detail: string;
  /** locator_failure 时的选择器/目标描述。 */
  selector?: string;
  /** backend_error 时的 HTTP 状态。 */
  httpStatus?: number;
  /** backend_error 时的响应体（截断）。 */
  responseBody?: string;
  /** assertion_mismatch 时的两边值。 */
  expected?: string;
  actual?: string;
  /** 截图相对路径（由 runner 填）。 */
  screenshot?: string;
}

export type VerifyResult = { status: 'passed'; detail: string } | VerifyFailure;

/** 便捷构造器，避免每处手写对象字面量时漏字段。 */
export const verify = {
  passed(detail: string): VerifyResult {
    return { status: 'passed', detail };
  },
  locator(selector: string, detail: string): VerifyFailure {
    return { status: 'locator_failure', selector, detail };
  },
  backend(httpStatus: number, responseBody: string, detail: string): VerifyFailure {
    return { status: 'backend_error', httpStatus, responseBody: responseBody.slice(0, 800), detail };
  },
  mismatch(expected: string, actual: string, detail: string): VerifyFailure {
    return { status: 'assertion_mismatch', expected, actual, detail };
  },
};

/** 一个阶段在单次旅程里的记录。 */
export interface StageRecord {
  stage: string;
  /** 人类可读的阶段名（报告里直接用）。 */
  label: string;
  url: string;
  startedAt: string;
  durationMs: number;
  result: VerifyResult;
  /** 这一阶段产生的证据（引用原文、数字、行数），报告里作为 `detail` 的补充。 */
  evidence: string[];
  /** 截图路径（相对 run 目录）。失败时一定有，通过时按需。 */
  screenshot: string | null;
  /** 这一阶段发生的 console error（新增的，不含之前阶段已计过的）。 */
  consoleErrors: string[];
  /**
   * 结构化产物（可选）。
   *
   * `evidence` 是给人读的字符串，指标层不该去正则解析它 —— 那会让文案一改
   * 指标就悄悄变空。需要被计算的阶段把原始数据放这里：`probe` 阶段的逐轮
   * 泄露观察就走这条路（见 `probe-leak.ts`）。
   */
  data?: unknown;
}

/** 阶段定义：`run` 负责操作，`verify` 负责断言。 */
export interface StageDefinition {
  stage: string;
  label: string;
  /**
   * 执行这个阶段。抛异常会被 runner 归到 `locator_failure`（多数是
   * `locator.click` 超时），但**能自己判定的失败应当返回 VerifyFailure**，
   * 那样才有准确的归类。
   */
  run: (context: StageContext) => Promise<{ result: VerifyResult; evidence: string[]; data?: unknown }>;
}

/** 阶段能用到的东西。刻意窄：只给页面、API 与 persona 的话术。 */
export interface StageContext {
  page: Page;
  api: StageApi;
  persona: PersonaVoice;
  /** 上一阶段/上一步留下的可复用值（比如挑中的知识点 id）。 */
  carry: Map<string, string>;
  /** 截图输出目录（与 runner 给阶段截图用的目录一致）。 */
  outputDir: string;
  /** 本阶段在旅程里的序号（0 起），截图命名要它与 runner 对齐。 */
  stageIndex: number;
}

/** 单次调用的超时覆盖。不传就用 runner 的默认值。 */
export interface StageApiCallOptions {
  /**
   * 这一次调用的超时（毫秒）。
   *
   * ## 为什么需要按调用覆盖
   *
   * 默认 20 秒是给「查列表 / 查详情」这类快接口定的。但
   * `POST /agent/probes/:id/replies` 每次要服务端调一次模型改写问句，
   * 实测单次 16 秒左右 —— 贴着默认值，9 轮里必然有一轮超时。
   * 超时会让整条 probe 阶段记成 backend_error，看起来像产品坏了。
   */
  timeoutMs?: number;
}

/** 阶段能调的后端接口（由 runner 注入，带超时与错误归类）。 */
export interface StageApi {
  getJson(path: string, options?: StageApiCallOptions): Promise<{ status: number; body: unknown; rawText: string }>;
  postJson(
    path: string,
    body: unknown,
    options?: StageApiCallOptions,
  ): Promise<{ status: number; body: unknown; rawText: string }>;
}

/** persona 的「说话方式」，由 persona JSON 的语言段与话术生成。 */
export interface PersonaVoice {
  id: string;
  tier: string;
  displayName: string;
  /** 学生这一轮想说的话（用于首页输入）。 */
  firstUtterance: string;
  /** 答错时说的话。 */
  wrongAnswerRemark: string;
  /** 三级施压要答案的话。 */
  demandAnswer: string;
  /** 被追问时的应答。 */
  probeReply: string;
}

/** 默认的阶段顺序（票 20 列的完整旅程）。 */
export const STAGE_ORDER = [
  'cold-start',
  'placement',
  'map',
  'node-detail',
  'answer',
  'probe',
  'board',
  'review',
  'database',
  'skills',
] as const;

export type StageName = (typeof STAGE_ORDER)[number];
