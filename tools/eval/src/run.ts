/**
 * 票 20 评估执行器：一条命令跑完三档 persona。
 *
 * ```
 * pnpm --filter @starmap/eval run -- --persona P1
 * pnpm --filter @starmap/eval run -- --persona all
 * ```
 *
 * ## 为什么 `--persona all` 必须串行
 *
 * 三档共享同一套数据库。并行跑会互相污染：P1 的作答会出现在 P2 的推荐里，
 * P3 的复验队列会看到 P1 留下的到期项。串行的代价是慢，不串行的代价是
 * 数据不可信 —— 而这份报告的全部价值就是可信。
 *
 * ## 退出码
 *
 * - 0：三档全部跑完，无阻塞失败。
 * - 1：有失败（三类失败任一），报告仍然写出来了 —— 失败的旅程本身就是数据。
 * - 2：跑不起来（前端不可达、judge 缺 key、gold 自检不通过）。
 *
 * ## 输出
 *
 * `.scratch/eval/<run-id>/`
 *   ├── journey-<persona>.json     旅程原始记录（含每阶段证据、截图名）
 *   ├── judge-runs-<persona>.json  每次 judge 的原始响应（解析失败也留原文）
 *   ├── gold-check.json            judge 自检结果
 *   ├── metrics.json               四类指标的机器可读形式
 *   ├── report.md                  渲染后的报告
 *   └── *.png                      各阶段截图
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAllPersonas, loadPersona, listPersonaFiles } from './personas/index.ts';
import { runJourney, summarizeJourney, type JourneyResult } from './layer2/journey.ts';
import { GOLD_TRANSCRIPTS, LlmJudge, runGoldCheck, type JudgeRunRecord } from './layer3/llm-judge.ts';
import {
  computeDrift,
  computeLeakRate,
  computeRecognition,
  computeStalls,
  failureBreakdown,
  majorityVote,
  type LeakObservation,
  type RecognitionObservation,
} from './metrics/compute.ts';
import { formatInterval, wilsonInterval } from './metrics/stats.ts';
import { renderReport } from './report/render.ts';
import { buildTopBlockers } from './report/blockers.ts';
import { ReportSchema, type Report, type StageId } from './report/schema.ts';
import { checkDistinctiveness } from './personas/index.ts';
import { DEFAULT_API_URL, DEFAULT_WEB_URL, parseArgs, USAGE, type CliOptions } from './cli.ts';
import { collectObservations } from './metrics/observations.ts';

/** 阶段名到十级漏斗的映射。`cold-start` 不是 S0 —— 见文件末尾的说明。 */
const STAGE_TO_FUNNEL: Record<string, StageId> = {
  'cold-start': 'S0',
  placement: 'S1',
  map: 'S3',
  'node-detail': 'S3',
  answer: 'S4',
  board: 'S6',
  review: 'S6',
  database: 'S7',
  skills: 'S8',
};

function funnelStage(stage: string | null): StageId {
  if (stage === null) return 'S0';
  return STAGE_TO_FUNNEL[stage] ?? 'S0';
}

interface PersonaRun {
  personaId: string;
  tier: string;
  journey: JourneyResult;
  judgeRuns: JudgeRunRecord[];
  recognition: ReturnType<typeof computeRecognition>;
  leak: ReturnType<typeof computeLeakRate>;
  drift: ReturnType<typeof computeDrift>;
  stalls: ReturnType<typeof computeStalls>;
}

async function runOne(
  personaFile: string,
  options: CliOptions,
  runDir: string,
  judge: LlmJudge | null,
): Promise<PersonaRun> {
  const persona = loadPersona(personaFile);
  const personaDir = join(runDir, 'journeys');
  mkdirSync(personaDir, { recursive: true });

  console.log(`\n▶ ${persona.tier} ${persona.displayName}（${persona.id}）开始`);
  const journey = await runJourney({
    persona,
    webUrl: options.webUrl,
    apiUrl: options.apiUrl,
    outputDir: personaDir,
  });
  console.log(summarizeJourney(journey));
  writeFileSync(join(runDir, `journey-${persona.id}.json`), JSON.stringify(journey, null, 2), 'utf8');

  /* 观察采集：把「学生答了什么 / 系统回了什么 / 客观对错 / 答案块原文」整理成
     指标要的形状。这一步是纯函数（见 observations.ts），所以它可以被单测，
     而不必起浏览器。 */
  const observations = await collectObservations(journey, options.apiUrl);
  const recognitionObservations: RecognitionObservation[] = observations.recognition;
  const leakObservations: LeakObservation[] = observations.leak;

  let judgeRuns: JudgeRunRecord[] = [];
  if (judge) {
    /* 对每条需要主观判断的观察跑 judge。票 20 要求「同一 transcript 跑 3 次
       算漂移」，所以每轮跑 `judge.meta.samples` 次。 */
    const rounds: JudgeRunRecord[][] = [];
    for (const observation of observations.judgeInputs) {
      const runs = await judge.judgeRepeated(observation, judge.meta.samples);
      rounds.push(runs);
      judgeRuns.push(...runs);
    }
    /* 把 judge 的判断回填到识别观察上：按 turn 对齐，多次采样取多数票。
       只读 `[0]` 会把另外两票丢掉 —— 详见 compute.ts 的 `majorityVote` 注释。 */
    for (const observation of recognitionObservations) {
      const roundIndex = observations.judgeInputs.findIndex((input) => input.turn === observation.turn);
      const round = roundIndex >= 0 ? rounds[roundIndex] : undefined;
      const assessed = (round ?? []).map((record) => record.assessment);
      if (assessed.length === 0 || assessed.every((entry) => entry === null)) {
        observation.judgement = null;
      } else {
        observation.judgement = {
          acknowledgesCorrect: majorityVote(assessed.map((entry) => entry?.acknowledgesCorrect ?? null)),
          identifiesWrong: majorityVote(assessed.map((entry) => entry?.identifiesWrong ?? null)),
        };
      }
    }

    const stallTurns = rounds
      .map((round, index) => {
        const assessment = round[0]?.assessment;
        if (!assessment) return null;
        return {
          turn: observations.judgeInputs[index]?.turn ?? index,
          consecutiveProbes: assessment.consecutiveProbes,
          degraded: assessment.degraded,
        };
      })
      .filter((entry): entry is { turn: number; consecutiveProbes: number; degraded: boolean } => entry !== null);
    const drift = computeDrift(rounds);
    writeFileSync(join(runDir, `judge-runs-${persona.id}.json`), JSON.stringify(judgeRuns, null, 2), 'utf8');
    return {
      personaId: persona.id,
      tier: persona.tier,
      journey,
      judgeRuns,
      recognition: computeRecognition(recognitionObservations),
      leak: computeLeakRate(leakObservations),
      drift,
      stalls: computeStalls(stallTurns),
    };
  }

  return {
    personaId: persona.id,
    tier: persona.tier,
    journey,
    judgeRuns: [],
    recognition: computeRecognition(recognitionObservations),
    leak: computeLeakRate(leakObservations),
    drift: computeDrift([]),
    stalls: computeStalls([]),
  };
}

/** 把一次运行的结果渲染成 `Report`（复用 `report/render.ts` 与它的纪律）。 */
function judgeScoresOf(runs: readonly PersonaRun[]): Report['judgeScores'] {
  /* 四维分取每档全部 judge 运行的中位数。

     为什么是中位数而不是均值：模型偶发一次离谱评分（比如把一段清楚的
     解释打 1 分）会把均值拉下去，而报告里那一个数字会显得像系统性偏低。
     中位数不被单个异常拖走。同分偶数个数时取偏低的那一半 —— 宁可保守。

     为什么是每维一个数而不是按轮次列：报告表格的空间有限，逐轮四维表会
     堆到看不清趋势；逐轮原始分在 `judge-runs-<persona>.json` 里全有。 */
  const byPersonaDimension = new Map<string, Map<string, number[]>>();
  for (const run of runs) {
    const inner = byPersonaDimension.get(run.personaId) ?? new Map<string, number[]>();
    byPersonaDimension.set(run.personaId, inner);
    for (const record of run.judgeRuns) {
      for (const entry of record.assessment?.scores ?? []) {
        const list = inner.get(entry.dimension) ?? [];
        list.push(entry.score);
        inner.set(entry.dimension, list);
      }
    }
  }

  const result: Report['judgeScores'] = [];
  for (const [personaId, dimensions] of byPersonaDimension) {
    for (const [dimension, values] of dimensions) {
      const sorted = [...values].sort((a, b) => a - b);
      const median = sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
      result.push({
        personaId,
        dimension: dimension as Report['judgeScores'][number]['dimension'],
        score: median,
      });
    }
  }
  /* 固定顺序，不然同一份数据两次渲染的表格行序不同，diff 时会误以为变了。 */
  const dimensionOrder = ['actionability', 'clarity', 'tone', 'scaffolding_fit'];
  return result.sort((a, b) => {
    if (a.personaId !== b.personaId) return a.personaId < b.personaId ? -1 : 1;
    return dimensionOrder.indexOf(a.dimension) - dimensionOrder.indexOf(b.dimension);
  });
}

function buildReport(
  runs: readonly PersonaRun[],
  options: CliOptions,
  goldPassed: boolean,
  durationS: number,
): Report {
  const personas = loadAllPersonas();
  const violations = checkDistinctiveness(personas);

  const journeys = runs.map((run) => {
    const journey = run.journey;
    const reached = funnelStage(journey.lastPassedStage);
    return {
      personaId: run.personaId,
      tier: run.tier as 'P1' | 'P2' | 'P3',
      scenarioId: 'full-flow',
      outcome:
        journey.failures.locatorFailure + journey.failures.backendError + journey.failures.assertionMismatch === 0
          ? ('success' as const)
          : journey.lastPassedStage === null
            ? ('crash' as const)
            : ('partial' as const),
      stageReached: reached,
      stageDurations: Object.fromEntries(journey.stages.map((stage) => [funnelStage(stage.stage), stage.durationMs])) as Partial<
        Record<StageId, number>
      >,
      turnsPerStage: Object.fromEntries(journey.stages.map((stage) => [funnelStage(stage.stage), 1])) as Partial<
        Record<StageId, number>
      >,
      artifacts: [],
      friction: {
        rageClicks: 0,
        deadClicks: 0,
        uTurns: 0,
        inputClears: 0,
        refreshLoops: 0,
        hintRequests: 0,
        formSkips: 0,
        locatorFailures: journey.failures.locatorFailure,
        abandonmentTurn: null,
      },
      failures: Object.fromEntries(
        ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'].map((id) => [
          id,
          { occurrences: 0, firstTurn: null, evidence: [] as string[] },
        ]),
      ) as Report['journeys'][number]['failures'],
      quotes: [],
      recognition: {
        correctTotal: run.recognition.correct.denominator,
        correctRecognized: run.recognition.correct.numerator,
        wrongTotal: run.recognition.wrong.denominator,
        wrongRecognized: run.recognition.wrong.numerator,
      },
      leakRate: {
        L1: run.leak.L1.rate.estimate,
        L2: run.leak.L2.rate.estimate,
        L3: run.leak.L3.rate.estimate,
        samples: { L1: run.leak.L1.total, L2: run.leak.L2.total, L3: run.leak.L3.total },
      },
      scoringConsistency: {
        fleissKappa: run.drift.fleissKappa,
        cv: run.drift.cv,
        nReplays: run.drift.nReplays,
      },
      stall: { maxStall: run.stalls.maxStall, stalls: run.stalls.stalls, stallsOver2: run.stalls.stallsOver2 },
      paasSeries: [],
      /* 本版旅程不模拟狂点/空输入/刷新循环 —— 那些计数恒为 0 是「没采」。
         只有 locatorFailures 是真的（来自 journey.failures）。 */
      unsampled: ['rageClicks', 'deadClicks', 'uTurns', 'inputClears', 'refreshLoops', 'formSkips'],
    };
  });

  const unknownItems: string[] = [
    'agreement_with_human_kappa：LLM 模拟用户评分与真人评分的一致性无数据（本项目的调研里也没有可引用的 r / ICC / Bland-Altman 结果）—— 这是该领域的实证空白，不是没查。',
    '核电子学「典型误解」清单是本报告自拟的设计假设，无文献支撑。',
    '「追问表单」作为脚手架卡片的实证效果：未验证。',
    '`--persona all` 串行跑三档，但三档共享同一套库：前一档留下的作答会影响后一档的推荐与复验队列。要完全隔离需要重建库，本次未做。',
  ];
  if (!goldPassed) {
    unknownItems.unshift(
      '**judge 未通过自检**（3 条 gold transcript 里有判错的）。**以下所有 judge 相关数字（识别率、漂移、四维分）不可信。**',
    );
  }
  if (runs.some((run) => run.journey.stages.some((stage) => stage.result.detail.includes('内容不足')))) {
    unknownItems.push('本次运行中 answer 阶段因内容不足未覆盖（节点没有可进入的关卡）。');
  }

  return {
    meta: {
      runId: options.runId,
      appVersion: '0.1.0',
      llmModel: options.llmModel,
      modelTemperature: 0,
      startedAt: options.startedAt,
      durationS,
    },
    discipline: {
      evidenceLevel: '假设生成',
      claimsUsabilityPassed: false,
      distinctivenessChecked: true,
      distinctivenessViolations: violations.map(
        (violation) => `${violation.dimension}: ${violation.pair.join(' vs ')} 相对差 ${(violation.gap * 100).toFixed(1)}% < 20%`,
      ),
      misconceptionsAreDesignAssumptions: true,
    },
    journeys,
    judgeScores: judgeScoresOf(runs),
    judgeMeta: {
      model: options.llmModel,
      promptVersion: 'judge-v1-2026-10',
      samples: 3,
      temperature: 0,
      agreementWithHumanKappa: null,
    },
    /* 描述由 `report/blockers.ts` 生成，不是直接 `detail.slice(0, 200)`：
       那句 detail 可能短于 schema 的 10 字下限（实测「读取推荐列表失败」8 字），
       直接塞进去会让 `ReportSchema.parse` 抛错、整份报告不落盘。 */
    topBlockers: buildTopBlockers(runs, funnelStage) as Report['topBlockers'],
    suggestedFixes: [],
    unknownItems,
  };
}

/** 把四类指标写成机器可读的 JSON（报告之外的第二份产物）。 */
function metricsJson(runs: readonly PersonaRun[]): unknown {
  return {
    generatedAt: new Date().toISOString(),
    personas: runs.map((run) => ({
      personaId: run.personaId,
      tier: run.tier,
      failures: failureBreakdown(run.journey),
      recognition: {
        correct: { ...run.recognition.correct, display: formatInterval(run.recognition.correct) },
        wrong: { ...run.recognition.wrong, display: formatInterval(run.recognition.wrong) },
        unjudged: run.recognition.unjudged,
      },
      leak: {
        L1: { ...run.leak.L1.rate, total: run.leak.L1.total, leaked: run.leak.L1.leaked, display: formatInterval(run.leak.L1.rate) },
        L2: { ...run.leak.L2.rate, total: run.leak.L2.total, leaked: run.leak.L2.leaked, display: formatInterval(run.leak.L2.rate) },
        L3: { ...run.leak.L3.rate, total: run.leak.L3.total, leaked: run.leak.L3.leaked, display: formatInterval(run.leak.L3.rate) },
        hits: run.leak.hits,
      },
      drift: run.drift,
      stalls: run.stalls,
      stages: run.journey.stages.map((stage) => ({
        stage: stage.stage,
        label: stage.label,
        status: stage.result.status,
        detail: stage.result.detail,
        evidence: stage.evidence,
        screenshot: stage.screenshot,
      })),
    })),
  };
}

/** 指标段：直接追加到报告 markdown 末尾（模板在前，数据在后）。 */
function metricsSection(runs: readonly PersonaRun[], goldPassed: boolean): string {
  const lines: string[] = ['', '---', '', '## 本次运行的四类指标（执行器产出）', ''];
  if (!goldPassed) {
    lines.push('> ⚠️ **judge 未通过 gold 自检，以下 judge 相关数字不可信。**', '');
  }
  lines.push('### 答对识别率 / 答错识别率（两个独立指标，不合并）', '');
  lines.push('| persona | 答对识别率 | 答错识别率 | judge 未判定轮数 |');
  lines.push('| --- | --- | --- | --- |');
  for (const run of runs) {
    lines.push(
      `| ${run.tier} ${run.personaId} | ${formatInterval(run.recognition.correct)} | ${formatInterval(run.recognition.wrong)} | ${run.recognition.unjudged} |`,
    );
  }
  lines.push('');
  lines.push('### 泄露答案率（确定性判据：答案块原文子串匹配，不靠 judge）', '');
  lines.push('| persona | L1（只给背景） | L2（脚手架） | L3（全量） |');
  lines.push('| --- | --- | --- | --- |');
  for (const run of runs) {
    lines.push(
      `| ${run.tier} ${run.personaId} | ${formatInterval(run.leak.L1.rate)} | ${formatInterval(run.leak.L2.rate)} | ${formatInterval(run.leak.L3.rate)} |`,
    );
  }
  const hits = runs.flatMap((run) => run.leak.hits.map((hit) => ({ persona: run.personaId, ...hit })));
  if (hits.length > 0) {
    lines.push('', '命中证据：');
    for (const hit of hits.slice(0, 10)) lines.push(`- ${hit.persona} · ${hit.tier}：命中「${hit.matchedFragment}」`);
  }
  lines.push('');
  lines.push('### 判分漂移（同一批轮次 judge 跑 3 次）', '');
  lines.push('| persona | Fleiss κ（≥0.8） | 四维均分 CV（≤0.05） | 样本轮数 | 重放次数 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const run of runs) {
    const kappa = run.drift.fleissKappa === null ? `无法计算（${run.drift.fleissReason ?? '未知'}）` : run.drift.fleissKappa.toFixed(3);
    const cv = run.drift.cv === null ? '无样本' : run.drift.cv.toFixed(3);
    lines.push(`| ${run.tier} ${run.personaId} | ${kappa} | ${cv} | ${run.drift.nSamples} | ${run.drift.nReplays} |`);
  }
  lines.push('');
  lines.push('### 过度追问分布', '');
  lines.push('| persona | 最长停滞（轮） | 长度 ≥3 的停滞次数（达标线 ≤1） | 各次长度 |');
  lines.push('| --- | --- | --- | --- |');
  for (const run of runs) {
    lines.push(
      `| ${run.tier} ${run.personaId} | ${run.stalls.maxStall} | ${run.stalls.stallsOver2} | ${run.stalls.stalls.join('、') || '无'} |`,
    );
  }
  lines.push('');
  lines.push('### 三类失败分开计数', '');
  lines.push('| persona | 找不到元素 | 后端报错 | 数字对不上 |');
  lines.push('| --- | --- | --- | --- |');
  for (const run of runs) {
    const breakdown = failureBreakdown(run.journey);
    lines.push(`| ${run.tier} ${run.personaId} | ${breakdown.locatorFailure} | ${breakdown.backendError} | ${breakdown.assertionMismatch} |`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2), DEFAULT_WEB_URL, DEFAULT_API_URL);

  /*
   * `--help` 必须在任何副作用之前退出：不建产物目录、不探活、不读 key。
   * 一个来问"怎么用"的人不该先看到一个 `.scratch/eval/<时间戳>` 空目录。
   */
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const runDir = join(options.outputRoot, options.runId);
  mkdirSync(runDir, { recursive: true });

  const started = performance.now();

  /* 前端探活：跑不动就早失败，别让人等 10 分钟才知道 5173 没起。 */
  try {
    const res = await fetch(options.webUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    console.error(
      `\n✗ 前端不可达：${options.webUrl}\n  ${(error as Error).message}\n` +
        '  下一步：pnpm --filter @starmap/web dev（另一个终端）\n' +
        `  或：确认 --base-url 指向正确的地址（当前 ${options.webUrl}）`,
    );
    return 2;
  }
  try {
    const res = await fetch(`${options.apiUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    console.error(
      `\n✗ 后端不可达：${options.apiUrl}/health\n  ${(error as Error).message}\n` +
        '  下一步：pnpm --filter @starmap/api dev（需 PostgreSQL）\n' +
        `  或：确认 --api-url 指向正确的地址（当前 ${options.apiUrl}）`,
    );
    return 2;
  }

  /* judge：没有 key 就是 2，不降级成假分数。 */
  let judge: LlmJudge | null = null;
  if (options.useJudge) {
    try {
      judge = new LlmJudge({ model: options.llmModel });
    } catch (error) {
      console.error(`\n✗ ${(error as Error).message}`);
      return 2;
    }
  }

  let goldPassed = false;
  if (judge) {
    console.log('\n▶ judge 自检（3 条 gold transcript）…');
    const gold = await runGoldCheck(judge);
    writeFileSync(join(runDir, 'gold-check.json'), JSON.stringify(gold, null, 2), 'utf8');
    for (const entry of gold) {
      console.log(`  ${entry.passed ? '✓' : '✗'} ${entry.transcriptId}（${entry.label}）${entry.passed ? '' : ` — ${entry.mismatches.join('；')}`}`);
    }
    goldPassed = gold.every((entry) => entry.passed);
    if (!goldPassed) {
      console.warn('\n⚠️ judge 未通过 gold 自检 —— 报告里所有 judge 相关数字会被标记为不可信。');
    }
  }

  const files = options.persona === 'all' ? listPersonaFiles() : [`${options.persona.toLowerCase()}-${options.personaSuffix}.json`];
  const available = listPersonaFiles();
  const selected = options.persona === 'all' ? available : available.filter((file) => file.includes(options.persona.toLowerCase()));
  const chosen = selected.length > 0 ? selected : files;

  const runs: PersonaRun[] = [];
  for (const file of chosen) {
    runs.push(await runOne(file, options, runDir, judge));
  }

  const durationS = (performance.now() - started) / 1000;
  const report = buildReport(runs, options, goldPassed, durationS);

  /* 报告校验失败时**不能什么都不写**：三档跑完花了十分钟，journey JSON 与截图
     都在盘上了，但 metrics.json 与 report.md 是这一步才产的。曾经这里直接
     `ReportSchema.parse` 抛出去，结果一条 8 个字的失败描述让整份报告不落盘。
     现在先把不依赖 schema 的 metrics.json 写掉，再把原始 report 与校验错误
     一起写到 `report-INVALID.md`，然后以退出码 2 退出 —— 工具 bug 要响，
     但不能以丢掉全部证据为代价。 */
  let parsedReport: Report;
  try {
    parsedReport = ReportSchema.parse(report);
  } catch (error) {
    const issues = (error as { issues?: Array<{ path: (string | number)[]; message: string }> }).issues ?? [];
    writeFileSync(join(runDir, 'metrics.json'), JSON.stringify(metricsJson(runs), null, 2), 'utf8');
    writeFileSync(
      join(runDir, 'report-INVALID.md'),
      [
        '# 报告未通过 schema 校验（这是评估工具自身的 bug，不是产品缺陷）',
        '',
        '## 校验错误',
        '',
        ...issues.map((issue) => `- \`${issue.path.join('.')}\`：${issue.message}`),
        '',
        '## 原始 report 对象',
        '',
        '```json',
        JSON.stringify(report, null, 2),
        '```',
        '',
      ].join('\n'),
      'utf8',
    );
    console.error(`\n✗ 报告未通过 schema 校验（工具 bug）：`);
    for (const issue of issues) console.error(`  ${issue.path.join('.')}：${issue.message}`);
    console.error(`  已保留：${join(runDir, 'metrics.json')} 与 ${join(runDir, 'report-INVALID.md')}`);
    console.error('  journey JSON 与截图不受影响。');
    return 2;
  }

  /* 报告：模板在前、数据段在后。**不覆盖模板** —— 模板里有纪律说明
     （证据等级、免责声明、阶段定义），那些是每次报告都必须带的。 */
  const metrics = metricsSection(runs, goldPassed);
  writeFileSync(join(runDir, 'metrics.json'), JSON.stringify(metricsJson(runs), null, 2), 'utf8');
  writeFileSync(join(runDir, 'report.md'), renderReport(parsedReport) + metrics, 'utf8');
  writeFileSync(join(runDir, 'report-filled.md'), renderReport(parsedReport) + metrics, 'utf8');

  const failures = runs.reduce(
    (total, run) =>
      total + run.journey.failures.locatorFailure + run.journey.failures.backendError + run.journey.failures.assertionMismatch,
    0,
  );

  console.log('\n' + '='.repeat(78));
  console.log(`run-id: ${options.runId}`);
  console.log(`产物目录: ${runDir}`);
  console.log(`  journey-<persona>.json  旅程原始记录（含每阶段证据）`);
  console.log(`  judge-runs-<persona>.json  judge 原始响应（解析失败也留原文）`);
  console.log(`  metrics.json            四类指标（机器可读）`);
  console.log(`  report.md               渲染后的报告`);
  console.log(`  journeys/*.png          各阶段截图`);
  console.log(`失败合计: ${failures}（找不到元素 ${runs.reduce((n, run) => n + run.journey.failures.locatorFailure, 0)} / 后端 ${runs.reduce((n, run) => n + run.journey.failures.backendError, 0)} / 数字对不上 ${runs.reduce((n, run) => n + run.journey.failures.assertionMismatch, 0)}）`);
  if (!goldPassed && judge) console.log('judge 自检：✗ 未通过 —— 报告里已标注相关数字不可信');
  console.log('='.repeat(78));

  if (failures > 0) {
    console.log('\n失败归因（第一处）：');
    for (const run of runs) {
      const breakdown = failureBreakdown(run.journey);
      const first = breakdown.byStage[0];
      if (first) console.log(`  ${run.personaId} 卡在 ${first.label}：${first.detail}`);
    }
    console.log(`  下一步：读 ${join(runDir, 'metrics.json')} 的 personas[].failures.byStage`);
  }

  /* gold 未通过也算失败退出：数字不可信的报告不该被当作"跑通了"。 */
  if (!goldPassed && judge) return 1;
  return failures > 0 ? 1 : 0;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('/run.ts') ?? false;
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(`\n✗ 执行器崩溃：${(error as Error).stack ?? String(error)}`);
      console.error('  这是工具自身的 bug，不是产品缺陷。请把这段堆栈贴进 issue。');
      process.exit(2);
    });
}

export { main, buildReport, metricsSection };
export type { PersonaRun };
export { GOLD_TRANSCRIPTS, wilsonInterval };
