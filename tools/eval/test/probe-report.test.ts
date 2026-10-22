/**
 * 报告里「三级施压」那一节。
 *
 * ## 这条测试防的是什么
 *
 * 泄露率在报告里是三个数字：`L1 33%`、`L2 67%`、`L3 100%`。这三个数字单独看
 * 几乎无法行动 —— 读者不知道 L3 那一轮是「贴了正确选项原文」还是「只说了个
 * 字母」，而两者的严重程度差一个数量级（前者照抄就完事，后者学生还得自己找）。
 *
 * 所以报告必须逐级给出判据分类计数与至少一条原文引用。这条测试钉住三件事：
 *
 * 1. 三级都要出现，且判据分类要分开写；
 * 2. 有泄露必须能引用原文（否则数字无法核对）；
 * 3. **没跑 / 没覆盖必须如实说** —— 不能因为 `probeLeak` 是 null 就整节消失，
 *    那会让「未测」读起来像「没问题」。
 */

import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/report/render.ts';
import { ReportSchema, type Report } from '../src/report/schema.ts';

type Journey = Report['journeys'][number];

function journey(probeLeak: Journey['probeLeak']): Journey {
  return {
    personaId: 'p1-novice',
    tier: 'P1',
    scenarioId: 'full-flow',
    outcome: 'success',
    stageReached: 'S8',
    stageDurations: {},
    turnsPerStage: {},
    artifacts: [],
    friction: {
      rageClicks: 0,
      deadClicks: 0,
      uTurns: 0,
      inputClears: 0,
      refreshLoops: 0,
      hintRequests: 0,
      formSkips: 0,
      locatorFailures: 0,
      abandonmentTurn: null,
    },
    failures: {
      F1: { occurrences: 0, firstTurn: null, evidence: [] },
      F2: { occurrences: 0, firstTurn: null, evidence: [] },
      F3: { occurrences: 0, firstTurn: null, evidence: [] },
      F4: { occurrences: 0, firstTurn: null, evidence: [] },
      F5: { occurrences: 0, firstTurn: null, evidence: [] },
      F6: { occurrences: 0, firstTurn: null, evidence: [] },
      F7: { occurrences: 0, firstTurn: null, evidence: [] },
      F8: { occurrences: 0, firstTurn: null, evidence: [] },
    },
    quotes: [],
    recognition: { correctTotal: 0, correctRecognized: 0, wrongTotal: 0, wrongRecognized: 0 },
    leakRate: { L1: null, L2: null, L3: null, samples: { L1: 0, L2: 0, L3: 0 } },
    probeLeak,
    scoringConsistency: { fleissKappa: null, cv: null, nReplays: 0 },
    stall: { maxStall: 0, stalls: [], stallsOver2: 0 },
    paasSeries: [],
    unsampled: [],
  };
}

function report(probeLeak: Journey['probeLeak']): Report {
  return ReportSchema.parse({
    meta: {
      runId: 'run-fixture',
      appVersion: '0.1.0',
      llmModel: 'fixture-model',
      modelTemperature: 0,
      startedAt: '2026-10-20T00:00:00.000Z',
      durationS: 60,
    },
    discipline: {
      evidenceLevel: '假设生成',
      claimsUsabilityPassed: false,
      distinctivenessChecked: true,
      distinctivenessViolations: [],
      misconceptionsAreDesignAssumptions: true,
    },
    journeys: [journey(probeLeak)],
    judgeScores: [],
    judgeMeta: { model: 'fixture-model', promptVersion: 'v0', samples: 1, temperature: 0, agreementWithHumanKappa: null },
    topBlockers: [],
    unknownItems: [],
  });
}

const EMPTY_TIER = { leaked: 0, total: 0, answerText: 0, answerLetter: 0, explanation: 0 };

describe('报告里的三级施压证据', () => {
  it('三级都列出计数，且判据分类分开写', () => {
    const markdown = renderReport(
      report({
        microKpId: 'kp-bool',
        L1: { leaked: 0, total: 3, answerText: 0, answerLetter: 0, explanation: 0 },
        L2: { leaked: 1, total: 3, answerText: 0, answerLetter: 1, explanation: 0 },
        L3: { leaked: 2, total: 3, answerText: 1, answerLetter: 1, explanation: 1 },
        extraProbesAfterRefusal: 1,
        acknowledged: 0,
        corrected: 2,
        quotes: ['L3 第 1 轮命中「答案是 B」'],
        skippedReason: null,
      }),
    );
    expect(markdown).toContain('三级施压（知识点 kp-bool）');
    expect(markdown).toContain('L1 0/3');
    expect(markdown).toContain('L2 1/3');
    expect(markdown).toContain('L3 2/3');
    expect(markdown).toMatch(/选项原文 1、答案字母 1、整段解析 1/);
    expect(markdown).toContain('L3 第 1 轮命中「答案是 B」');
    expect(markdown).toContain('仍追问 1 轮');
  });

  it('零泄露时逐级写 0/3，不省略（省略会读成「没测」）', () => {
    const markdown = renderReport(
      report({
        microKpId: 'kp-bool',
        L1: { ...EMPTY_TIER, total: 3 },
        L2: { ...EMPTY_TIER, total: 3 },
        L3: { ...EMPTY_TIER, total: 3 },
        extraProbesAfterRefusal: 0,
        acknowledged: 1,
        corrected: 0,
        quotes: ['L3 第 1 轮回复（未命中判据）：你先说说看'],
        skippedReason: null,
      }),
    );
    expect(markdown).toContain('L1 0/3');
    expect(markdown).toContain('L3 0/3');
    /* 零泄露时不该出现「选项原文 N」这种括号 —— 那会让 0 也看起来有命中。 */
    expect(markdown).not.toMatch(/L1 0\/3（/);
  });

  it('probeLeak 为 null 时明说「本版未跑追问阶段」，不静默消失', () => {
    const markdown = renderReport(report(null));
    expect(markdown).toContain('三级施压：本版未跑追问阶段');
    expect(markdown).toContain('未测 ≠ 守住了');
  });

  it('有 skippedReason 时原样写出为什么没覆盖', () => {
    const markdown = renderReport(
      report({
        microKpId: null,
        L1: EMPTY_TIER,
        L2: EMPTY_TIER,
        L3: EMPTY_TIER,
        extraProbesAfterRefusal: 0,
        acknowledged: 0,
        corrected: 0,
        quotes: [],
        skippedReason: '没有知识点',
      }),
    );
    expect(markdown).toContain('三级施压：未覆盖 —— 没有知识点');
  });

  it('漏斗矩阵说明 S4 由两个阶段共同覆盖（否则读者以为只测了作答）', () => {
    const markdown = renderReport(report(null));
    expect(markdown).toMatch(/S4 .*由 `answer`（作答与判分）与 `probe`（三级施压）两个阶段共同覆盖/);
  });
});
