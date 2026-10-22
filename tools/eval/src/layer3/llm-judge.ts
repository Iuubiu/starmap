/**
 * 第三层的**真模型**实现：调 OpenAI 兼容的 chat/completions 端点。
 *
 * ## 与 `judge.ts` 的分工
 *
 * `judge.ts` 定契约（评哪四维、什么不许问、`agreementWithHumanKappa` 恒 null）。
 * 这个文件只负责把契约接到真模型上，外加票 20 新要求的四件事：
 *  ① 答对识别 ② 答错识别 ③ 是否泄露答案（分 L1/L2/L3）④ 是否过度追问。
 *
 * ## 为什么用两层 prompt
 *
 * 主观维度（judge.ts 的四维）与「识别/泄露/追问」是两类问题：
 * 前者没有确定答案，只能靠模型判断；后者的正确答案在层①里已经由确定性代码
 * 算过（`JUDGE_MUST_NOT_DECIDE` 逐条列了）。但票 20 要求这两类**都**进报告，
 * 所以这里让 judge 判的是「界面上那句话有没有明确说对/说错」，而不是
 * 「学生这题到底对不对」—— 后者读 attempts 表，不归 judge。
 *
 * 这个区别不是文字游戏：judge 看的是 screenText（学习者实际看到的字），
 * 它回答的是「反馈里有没有明确表态」，这是主观判断；而 attempts 里的
 * `correct` 是客观事实。两者对照才得出「答对识别率」。
 *
 * ## API key
 *
 * 只从 `process.env.LLM_API_KEY` 读，**绝不读 `.env` 文件本身**——仓库里
 * `.env` 是敏感路径。调用方用 `node --env-file=.env` 注入（与 apps/api
 * 的六个入口同一做法）。缺 key 时抛错并说清怎么补，不静默降级成假分数。
 */

import { z } from 'zod';
import { JudgeVerdictSchema, type JudgeDimension, type JudgeMeta, type JudgeVerdict } from './judge.ts';

export const DEFAULT_LLM_BASE_URL = 'https://d1api.xin/v1';
export const DEFAULT_LLM_MODEL = 'deepseek-v4.1-flash';

/** 一次 chat completion 的原始响应留痕；解析失败时报告要能看到原文。 */
export interface RawCompletion {
  model: string;
  /** 请求发出到收到响应的毫秒数。 */
  durationMs: number;
  /** HTTP 状态；网络错误时是 null。 */
  status: number | null;
  /** 模型返回的正文（`choices[0].message.content`）；解析失败时为原文。 */
  content: string;
  /** 结构化解析结果；失败时为 null 且 `parseError` 有值。 */
  parsed: unknown;
  parseError: string | null;
  /** 是否用掉了重试（解析失败后重问一次）。 */
  retried: boolean;
}

export interface LlmJudgeOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  /** 单次请求超时（毫秒）。默认 90s：judge 的 prompt 比产品侧长很多。 */
  timeoutMs?: number;
  /** 测试与离线复现用：注入一个假的 fetch。 */
  fetchImpl?: typeof fetch;
}

export interface JudgePromptInput {
  /** 这是第几轮（从 1 开始）。用来把 judge 结果回填到识别观察上。 */
  turn: number;
  screenText: string;
  learnerInput: string;
  dimensions: readonly JudgeDimension[];
  /** 学习者这一轮答的是对是错（**客观事实**，来自 attempts 表，不是 judge 判断的）。 */
  answerCorrect?: boolean | null;
  /**
   * 该知识点当前检索门控档位。用于分层统计泄露率。
   * `null` = 这一轮没有检索门控信息（比如非问答阶段）。
   */
  gateTier?: 'L1' | 'L2' | 'L3' | null;
  /** 答案块原文片段，用于**确定性**泄露核对（judge 的看法只作交叉验证）。 */
  answerChunks?: readonly string[];
}

/**
 * judge 的结构化输出。
 *
 * 四维分（1–5）沿用 `judge.ts` 的 `scores`；票 20 的三项新增在这三个字段里。
 * 每项都必须带 `evidenceQuote` —— 没有引文的判断无法审计，与 judge.ts 的
 * `DimensionScoreSchema.rationale` 是同一条纪律。
 */
export interface JudgeAssessment {
  /** 反馈里有没有明确肯定学生答对了。`null` = 这一轮没有对错可言（如讲解阶段）。 */
  acknowledgesCorrect: boolean | null;
  /** 反馈里有没有明确指出错在哪（而不是含糊肯定）。`null` 同上。 */
  identifiesWrong: boolean | null;
  /** judge 认为这一轮泄露了答案吗；只作交叉验证，主判据是确定性字串匹配。 */
  leaksAnswer: boolean;
  /** 若泄露，judge 认为泄露了哪一段（引原文）。 */
  leakEvidence: string | null;
  /** 这一轮之后同一处又追问了几次（judge 从对话片段里数）。 */
  consecutiveProbes: number;
  /** 是否发生了降级（给出答案 / 换例子 / 明说不会继续追问）。 */
  degraded: boolean;
  /** 四个主观维度分。 */
  scores: JudgeVerdict['scores'];
  needsHumanReview: string[];
  /** 给审计用的一句话总结。 */
  summary: string;
}

export interface JudgeRunRecord {
  sample: number;
  assessment: JudgeAssessment | null;
  raw: RawCompletion;
}

/** 调模型的客户端。每次 `judge` 调用 = 一次 completion。 */
export class LlmJudge {
  private readonly options: Required<Omit<LlmJudgeOptions, 'fetchImpl'>> & { fetchImpl: typeof fetch };
  readonly meta: JudgeMeta;

  constructor(options: LlmJudgeOptions = {}) {
    const apiKey = options.apiKey ?? process.env['LLM_API_KEY'] ?? '';
    if (apiKey.trim() === '') {
      throw new Error(
        '缺少 LLM_API_KEY。judge 不降级成假分数 —— 补法：\n' +
          '  node --env-file=.env ./src/run.ts --persona P1\n' +
          '（`.env` 在仓库根，已被 .gitignore 忽略；不要把 key 写进任何被跟踪的文件）',
      );
    }
    this.options = {
      apiKey,
      baseUrl: (options.baseUrl ?? process.env['LLM_BASE_URL'] ?? DEFAULT_LLM_BASE_URL).replace(/\/$/, ''),
      model: options.model ?? process.env['LLM_MODEL'] ?? DEFAULT_LLM_MODEL,
      temperature: options.temperature ?? 0,
      timeoutMs: options.timeoutMs ?? 90_000,
      fetchImpl: options.fetchImpl ?? fetch,
    };
    this.meta = {
      model: this.options.model,
      promptVersion: 'judge-v1-2026-10',
      samples: 3,
      temperature: this.options.temperature,
      agreementWithHumanKappa: null,
    };
  }

  async judge(input: JudgePromptInput, sample = 0): Promise<JudgeRunRecord> {
    const first = await this.complete(chatMessages(input));
    const firstParsed = parseAssessment(first.content);
    if (firstParsed.ok) {
      return { sample, assessment: firstParsed.assessment, raw: { ...first, parsed: firstParsed.assessment, parseError: null, retried: false } };
    }

    /* 解析失败重问一次：把上一次的输出与错误一起喂回去，比原样重问更可能修好。
       重问仍失败就**记录原文**并让 assessment 为 null —— 报告层看到 null 会写
       「该轮 judge 输出不可解析」，绝不会静默算成 0 分。 */
    const second = await this.complete([
      ...chatMessages(input),
      { role: 'assistant', content: first.content.slice(0, 4000) },
      {
        role: 'user',
        content:
          `你上一次的输出不是合法 JSON（错误：${firstParsed.error}）。` +
          '请只输出一个 JSON 对象，不要代码围栏、不要任何解释文字。字段与取值范围见第一条消息。',
      },
    ]);
    const secondParsed = parseAssessment(second.content);
    if (secondParsed.ok) {
      return {
        sample,
        assessment: secondParsed.assessment,
        raw: { ...second, parsed: secondParsed.assessment, parseError: null, retried: true },
      };
    }
    return {
      sample,
      assessment: null,
      raw: {
        ...second,
        parsed: null,
        parseError: `两次都解析失败：第一次「${firstParsed.error}」，第二次「${secondParsed.error}」`,
        retried: true,
      },
    };
  }

  /** 同一条 transcript 跑 n 次，用于算判分漂移。 */
  async judgeRepeated(input: JudgePromptInput, samples: number): Promise<JudgeRunRecord[]> {
    const records: JudgeRunRecord[] = [];
    for (let index = 0; index < samples; index += 1) {
      records.push(await this.judge(input, index));
    }
    return records;
  }

  private async complete(messages: ReadonlyArray<{ role: string; content: string }>): Promise<RawCompletion> {
    const started = performance.now();
    let status: number | null = null;
    let content = '';
    try {
      const response = await this.options.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: this.options.temperature,
          /* response_format 是 OpenAI 的 JSON mode。网关若不支持会 400，
             所以下面解析失败时仍然有「重问一次」的兜底 —— 两条路都留着。 */
          response_format: { type: 'json_object' },
          messages,
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      status = response.status;
      const rawText = await response.text();
      if (!response.ok) {
        content = `HTTP ${response.status}: ${rawText.slice(0, 1500)}`;
      } else {
        content = extractContent(rawText);
      }
    } catch (error) {
      content = `网络/超时错误：${(error as Error).message}`;
    }
    return {
      model: this.options.model,
      durationMs: Math.round(performance.now() - started),
      status,
      content,
      parsed: null,
      parseError: null,
      retried: false,
    };
  }
}

function extractContent(rawText: string): string {
  try {
    const body = JSON.parse(rawText) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    return rawText;
  } catch {
    return rawText;
  }
}

/** 解析 judge 的 JSON 输出，并用 zod 校验每一项的取值范围。 */
export function parseAssessment(content: string): { ok: true; assessment: JudgeAssessment } | { ok: false; error: string } {
  const trimmed = content.trim();
  if (trimmed === '') return { ok: false, error: '模型输出为空' };

  // 容忍 ```json 围栏与前后解释：与 layer2 的 parseAgentAction 同一手法。
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, error: `输出里没有 JSON 对象：${trimmed.slice(0, 160)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch (error) {
    return { ok: false, error: `JSON 解析失败：${(error as Error).message}` };
  }

  const result = AssessmentSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}：${issue.message}`);
    return { ok: false, error: `字段不合协议：${issues.join('；')}` };
  }
  return { ok: true, assessment: result.data };
}

const nullableBool = z.boolean().nullable();

const AssessmentSchema = z.object({
  acknowledgesCorrect: nullableBool,
  identifiesWrong: nullableBool,
  leaksAnswer: z.boolean(),
  leakEvidence: z.string().nullable().default(null),
  consecutiveProbes: z.number().int().min(0).max(20),
  degraded: z.boolean(),
  scores: JudgeVerdictSchema.shape.scores,
  needsHumanReview: z.array(z.string()).default([]),
  summary: z.string().min(5),
});

function chatMessages(input: JudgePromptInput): Array<{ role: string; content: string }> {
  const tierLine = input.gateTier
    ? `本题当前检索门控档位：${input.gateTier}（L1=只给背景，L2=给脚手架，L3=可给全量）。`
    : '本轮没有检索门控信息。';
  const answerLine =
    input.answerCorrect === null || input.answerCorrect === undefined
      ? '本轮学生没有作答。'
      : `本轮学生作答的客观结果是：${input.answerCorrect ? '答对' : '答错'}（这是事实，不是你要判断的东西）。`;
  const chunks =
    input.answerChunks && input.answerChunks.length > 0
      ? `\n\n【该知识点的答案块原文】（只用于你核对是否泄露，不要直接抄进理由）\n${input.answerChunks
          .slice(0, 3)
          .map((chunk, index) => `[${index + 1}] ${chunk.slice(0, 500)}`)
          .join('\n')}`
      : '';

  const system = `你是一名教育对话质量评审员。你评审的是**核电子学学习系统对学生说的话**，不是学生说的。

你只判断"系统说得对不对、够不够好"，**不要重新判断学生这道题答得对不对** —— 那个事实已经给你了。

关于 null：只有当本轮学生**根本没有作答**（提示里写「本轮学生没有作答」）时，acknowledgesCorrect 与 identifiesWrong 才填 null。只要给了客观对错，这两个字段就必须是 true 或 false —— 用 null 逃避判断会让「答对识别率」「答错识别率」两个指标的分母凭空变小，而报告上不会显示任何异常。

严格输出一个 JSON 对象，不要代码围栏、不要任何解释文字。字段：
{
  "acknowledgesCorrect": 布尔或 null  // 系统有没有**说学生对了**。注意问的是「系统说了什么」这个事实，不是「系统说得对不对」：学生答错而系统说「很好！你的思路是对的」，这里就是 true —— 那正是要抓的缺陷。学生作答有客观对错时必须是布尔值，不能填 null。
  "identifiesWrong": 布尔或 null      // 学生答错时，系统有没有**明确指出错在哪**（指到具体的错处，如「你把分配律用在了不能用的地方」）。"再想想""差一点""不完全对"这类模糊反馈填 false。学生作答有客观对错时必须是布尔值，不能填 null。
  "leaksAnswer": 布尔                 // 系统的回复里有没有出现最终答案（数值、完整公式、选项内容）。**在说明「你错在哪」时顺口把正确结果说出来，也算泄露** —— 那等于把学生该自己做的那一步替他做了。
  "leakEvidence": 字符串或 null       // 若泄露，逐字引用泄露的那一段；否则 null
  "consecutiveProbes": 整数           // 从这段对话看，系统在同一处已经连续追问了几轮（含本轮）
  "degraded": 布尔                    // 系统本轮是否**降低了难度**（给例子、给答案、明说不再追问、换讲法）
  "scores": 数组                      // 只评下面列出的维度，每项 {"dimension","score"(1-5整数),"rationale"(≥10字),"evidenceQuote"(界面原文)}
  "needsHumanReview": 字符串数组      // 你觉得人需要复核的点；可以是空数组
  "summary": 字符串                   // 一句话，≤60 字
}

评分的四个维度里，本次只评：${input.dimensions.join(', ')}。
每个分数必须带 evidenceQuote —— **逐字引用界面上出现过的原文**，不要转述。`;

  const user = `【学生这一轮说的话】
${input.learnerInput.slice(0, 2000)}

【系统显示的界面原文（学习者实际看到的字）】
${input.screenText.slice(0, 6000)}

${answerLine}
${tierLine}${chunks}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Judge 自检用的 gold transcript。
 *
 * 三条，覆盖三种典型行为，对应票 20 的硬要求。**每条都写明人工标注的
 * 期望输出**——judge 在这三条上判错，报告就要写明「judge 未通过自检，
 * 以下数字不可信」。没有这一步，一个总是说"很好"的 judge 也能产出漂亮的
 * 四维分数。
 */
export interface GoldTranscript {
  id: string;
  /** 人工标注：这条 transcript 里系统的表现属于哪一类。 */
  label: 'good' | 'leaks_answer' | 'false_praise';
  note: string;
  input: JudgePromptInput;
  expect: {
    acknowledgesCorrect: boolean | null;
    identifiesWrong: boolean | null;
    leaksAnswer: boolean;
  };
}

const DEMO_DIMENSIONS: JudgeDimension[] = ['actionability', 'clarity', 'tone', 'scaffolding_fit'];

export const GOLD_TRANSCRIPTS: readonly GoldTranscript[] = [
  {
    id: 'gold-good',
    label: 'good',
    note: '学生答错（误用分配律），系统指出错在误用分配律、给出可执行的下一步，且**没有**把结果说出来。',
    input: {
      turn: 1,
      screenText:
        '还不对。你把 $A + A·B$ 化成了 $A + B$ —— 这一步用的是分配律，但分配律在这里不适用。吸收律管的是「一个式子被它自己的一项吸收」，不是把括号拆开。\n下一步：先写出 $A + A·B$ 的真值表四行（$A$ 取 0 和 1、$B$ 取 0 和 1），看看 $B$ 变化时结果有没有变。',
      learnerInput: '$A + A·B$ 应该等于 $A + B$ 吧？',
      dimensions: DEMO_DIMENSIONS,
      answerCorrect: false,
      gateTier: 'L2',
      answerChunks: ['吸收律：A + A·B = A。多出来的 B 被 A 吸收。'],
    },
    expect: { acknowledgesCorrect: false, identifiesWrong: true, leaksAnswer: false },
  },
  {
    id: 'gold-leaks-answer',
    label: 'leaks_answer',
    note: '学生连续追问后，系统直接把答案和完整推导都给了出来。',
    input: {
      turn: 1,
      screenText:
        '好吧，直接告诉你：答案是 $A$。推导是这样的：$A + A·B = A·(1 + B) = A·1 = A$，因为 $1 + B$ 恒等于 1，所以整个式子化简为 $A$。',
      learnerInput: '我真不会，你直接告诉我答案吧',
      dimensions: DEMO_DIMENSIONS,
      answerCorrect: null,
      gateTier: 'L3',
      answerChunks: ['吸收律：A + A·B = A·(1+B) = A·1 = A。'],
    },
    expect: { acknowledgesCorrect: null, identifiesWrong: null, leaksAnswer: true },
  },
  {
    id: 'gold-false-praise',
    label: 'false_praise',
    note: '学生答错了，系统却说「很好」，没有任何纠错。',
    input: {
      turn: 1,
      screenText: '很好！你的思路是对的，继续保持这个方向。',
      learnerInput: '$A + A·B$ 应该等于 $A + B$。',
      dimensions: DEMO_DIMENSIONS,
      answerCorrect: false,
      gateTier: 'L1',
      answerChunks: ['吸收律：A + A·B = A。'],
    },
    expect: { acknowledgesCorrect: true, identifiesWrong: false, leaksAnswer: false },
  },
];

export interface GoldCheckResult {
  transcriptId: string;
  label: GoldTranscript['label'];
  passed: boolean;
  /** 逐字段对比的说明；passed=false 时报告直接引用。 */
  mismatches: string[];
  assessment: JudgeAssessment | null;
  raw: RawCompletion;
}

/** 在全部 gold 上跑 judge，逐条比对人工标注。 */
export async function runGoldCheck(judge: LlmJudge): Promise<GoldCheckResult[]> {
  const results: GoldCheckResult[] = [];
  for (const gold of GOLD_TRANSCRIPTS) {
    const record = await judge.judge(gold.input, 0);
    const assessment = record.assessment;
    const mismatches: string[] = [];
    if (!assessment) {
      mismatches.push(`judge 输出无法解析：${record.raw.parseError ?? '未知'}`);
    } else {
      if (assessment.acknowledgesCorrect !== gold.expect.acknowledgesCorrect) {
        mismatches.push(
          `acknowledgesCorrect 期望 ${String(gold.expect.acknowledgesCorrect)}，实际 ${String(assessment.acknowledgesCorrect)}`,
        );
      }
      if (assessment.identifiesWrong !== gold.expect.identifiesWrong) {
        mismatches.push(
          `identifiesWrong 期望 ${String(gold.expect.identifiesWrong)}，实际 ${String(assessment.identifiesWrong)}`,
        );
      }
      if (assessment.leaksAnswer !== gold.expect.leaksAnswer) {
        mismatches.push(`leaksAnswer 期望 ${String(gold.expect.leaksAnswer)}，实际 ${String(assessment.leaksAnswer)}`);
      }
    }
    results.push({ transcriptId: gold.id, label: gold.label, passed: mismatches.length === 0, mismatches, assessment, raw: record.raw });
  }
  return results;
}

export { AssessmentSchema };
