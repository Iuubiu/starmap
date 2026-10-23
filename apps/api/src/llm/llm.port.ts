/**
 * LlmPort：唯一触达模型的地方（测试接缝 2）。
 *
 * 存在的理由是「跑测试不打任何真实模型、不产生费用」。所有上层代码
 * 只依赖这个接口，测试里注入脚本化假实现即可覆盖超时、非法 JSON、
 * 中英混杂等失败模式。
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompleteOptions {
  messages: LlmMessage[];
  /** 要求模型输出 JSON 时给出 Zod schema，由实现负责校验 */
  schema?: unknown;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmResult {
  text: string;
  /** 结构化输出解析成功时的结果；失败为 null，调用方决定降级 */
  parsed: unknown;
  usage?: { promptTokens: number; completionTokens: number };
  /** 实际应答的模型名（服务端可能改写，如指向别名）；拿不到时省略 */
  model?: string;
  /** 从发请求到拿到响应的墙钟耗时，毫秒。决策链要显示它，所以由端口返回而不是调用方自己计时 */
  latencyMs?: number;
  /**
   * 服务端返回的推理内容（DeepSeek 的 `reasoning_content` 等）。
   * 很多 provider 不返回这一项 —— 那就保持 undefined，**不要用模板填充**：
   * 界面上「未返回」是事实，编一段「思考过程」是造假。
   */
  reasoning?: string;
}

/** 逐字流的一段增量。`text` 与 `reasoning` 可能同时为空（心跳/空 chunk） */
export interface LlmDelta {
  text?: string;
  reasoning?: string;
}

export interface LlmStreamResult {
  /** 流结束后才有值：与 `complete()` 同形的聚合结果，便于调用方复用同一套校验 */
  final: LlmResult;
}

export interface LlmPort {
  readonly id: string;
  complete(options: LlmCompleteOptions): Promise<LlmResult>;
  /**
   * 逐字流。**语义与 `complete` 有两个刻意的差别**：
   * 1. 超时是「空闲超时」而不是总时长：长回答本来就该跑 60–90 秒，
   *    拿 45 秒卡整轮会把正常回答从中间砍断。
   * 2. 不保证 `parsed` 可用 —— 流式下模型逐字输出，JSON 只有到结尾才完整；
   *    调用方拿到 `final` 后再走原来的校验与降级路径。
   */
  stream(options: LlmCompleteOptions): AsyncGenerator<LlmDelta, LlmStreamResult>;
}

/** DI token —— 用字符串而不是 class，避免 NestJS 反射元数据依赖 */
export const LLM_PORT = Symbol('LLM_PORT');
