/**
 * 命令行参数。
 *
 * 单独一个文件而不是塞进 `run.ts`：参数解析要被单测覆盖（尤其是 `--persona`
 * 的取值校验与 run-id 的生成），而 `run.ts` 顶部有顶层副作用（`isMain` 判断
 * 会启动整个执行器），直接 import 它会真的跑一遍。
 */

export const DEFAULT_WEB_URL = 'http://localhost:5173';
export const DEFAULT_API_URL = 'http://127.0.0.1:3001/api/v1';
export const DEFAULT_LLM_MODEL = 'deepseek-v4.1-flash';

export type PersonaSelector = 'P1' | 'P2' | 'P3' | 'all';

export interface CliOptions {
  persona: PersonaSelector;
  /** 由 persona 反查文件名后缀用；`all` 时忽略。 */
  personaSuffix: string;
  webUrl: string;
  apiUrl: string;
  outputRoot: string;
  runId: string;
  startedAt: string;
  /** 是否跑 judge。`--no-judge` 时跳过（离线跑 UI 流程用）。 */
  useJudge: boolean;
  llmModel: string;
  /** `--help`：打印用法后退出 0。**不是错误**，不该走异常路径。 */
  help: boolean;
}

/**
 * 用法文本。
 *
 * `pnpm --filter <pkg> <script>` 里的 `<script>` 必须是 package.json 里的名字（这里是
 * `eval`）。写成 `pnpm --filter @starmap/eval run -- ...` 会报
 * `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` —— `run` 是 pnpm 的内建子命令，不是我们的
 * script，`--` 还会被当成一个字面量参数传给下游。这个坑写过一次就别再写。
 */
export const USAGE = [
  '用法：pnpm --filter @starmap/eval eval [选项]',
  '',
  '  --persona P1|P2|P3|all   跑哪一档（默认 all，串行）',
  '  --base-url URL           前端地址（默认 http://localhost:5173）',
  '  --api-url URL            后端地址（默认 http://127.0.0.1:3001/api/v1）',
  '  --output DIR             产物根目录（默认 .scratch/eval）',
  '  --model NAME             judge 模型（默认取 LLM_MODEL 或 deepseek-v4.1-flash）',
  '  --no-judge               跳过层③（离线跑 UI 流程时用）',
  '  --help                   打印这段文字后退出 0',
  '',
  '前置：PostgreSQL 起着、pnpm db:migrate 跑过、.env 里有 LLM_API_KEY。',
  '只跑 judge 自检（约 20 秒）：pnpm --filter @starmap/eval gold',
].join('\n');

const PERSONA_SUFFIX: Record<Exclude<PersonaSelector, 'all'>, string> = {
  P1: 'novice',
  P2: 'grad',
  P3: 'engineer',
};

/** run-id：时间戳 + persona，可排序、可读、不撞。 */
export function makeRunId(persona: PersonaSelector, now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${persona.toLowerCase()}`;
}

/**
 * 解析参数。
 *
 * 未知参数**直接抛错**而不是忽略：一个打错的 `--persona P4` 被静默忽略会
 * 让整次运行跑的是默认档，而报告上写着 P4 —— 那种错误只能靠人眼发现。
 */
export function parseArgs(argv: readonly string[], defaultWebUrl = DEFAULT_WEB_URL, defaultApiUrl = DEFAULT_API_URL): CliOptions {
  let persona: PersonaSelector = 'all';
  let webUrl = defaultWebUrl;
  let apiUrl = defaultApiUrl;
  let outputRoot = '.scratch/eval';
  let useJudge = true;
  let llmModel = process.env['LLM_MODEL'] ?? DEFAULT_LLM_MODEL;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    const takeValue = (name: string): string => {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`参数 ${name} 需要一个值`);
      }
      index += 1;
      return value;
    };

    if (argument === '--persona') {
      const raw = takeValue('--persona');
      const normalized = raw.toUpperCase();
      if (normalized === 'ALL') persona = 'all';
      else if (normalized === 'P1' || normalized === 'P2' || normalized === 'P3') persona = normalized;
      else throw new Error(`--persona 只接受 P1 / P2 / P3 / all，收到「${raw}」`);
    } else if (argument === '--base-url') {
      webUrl = takeValue('--base-url').replace(/\/$/, '');
    } else if (argument === '--api-url') {
      apiUrl = takeValue('--api-url').replace(/\/$/, '');
    } else if (argument === '--output') {
      outputRoot = takeValue('--output');
    } else if (argument === '--model') {
      llmModel = takeValue('--model');
    } else if (argument === '--no-judge') {
      useJudge = false;
    } else if (argument === '--help' || argument === '-h') {
      /*
       * 打印用法然后退出 0 —— 不是抛错。
       *
       * 原来这里 `throw`，于是 `--help` 走 catch 分支，打出一段 Node 堆栈 + 
       * 「这是工具自身的 bug」，退出码 2。一个来问“怎么用”的人看到的是一份崩溃报告。
       * 帮助不是异常。
       */
      help = true;
    } else {
      throw new Error(`不认识的参数「${argument}」—— 打错的参数会被静默忽略成默认值，所以这里直接拒绝`);
    }
  }

  const now = new Date();
  return {
    persona,
    personaSuffix: persona === 'all' ? 'all' : PERSONA_SUFFIX[persona],
    webUrl,
    apiUrl,
    outputRoot,
    runId: makeRunId(persona, now),
    startedAt: now.toISOString(),
    useJudge,
    llmModel,
    help,
  };
}
