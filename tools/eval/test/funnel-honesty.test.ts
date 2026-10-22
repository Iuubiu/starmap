/**
 * 报告不能把「没测」写成「没走到」。
 *
 * 这条测试防的是一个真实的读数错误：`stageReached` 按旅程阶段算，而漏斗是十级。
 * S2（关卡卡产出）与 S5（追问表单）在本版工具里没有对应的旅程阶段，所以任何
 * persona 的 stageReached 都不可能 ≥ S2。旧版渲染器直接拿它扫描全部十级，
 * 于是结论栏**稳定地**写「最先掉队的位置是 S2」—— 一句永远成立、且永远错的读数。
 *
 * 后果不是排版难看：读报告的人会去查一个不存在的产品缺陷，而真正的结论是
 * 「这两级没测」。在评估报告里，「没测」被写成「坏了」是最容易发生的失真。
 */

import { describe, expect, it } from 'vitest';
import { renderReport } from '../src/report/render.ts';
import { ReportSchema, type Report } from '../src/report/schema.ts';

function report(overrides: { stageReached?: string } = {}): Report {
  const base = {
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
    journeys: [
      {
        personaId: 'p1-novice',
        tier: 'P1',
        scenarioId: 'full-flow',
        outcome: 'success',
        stageReached: overrides.stageReached ?? 'S8',
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
        probeLeak: null,
        scoringConsistency: { fleissKappa: null, cv: null, nReplays: 0 },
        stall: { maxStall: 0, stalls: [], stallsOver2: 0 },
        paasSeries: [],
        unsampled: [],
      },
    ],
    judgeScores: [],
    judgeMeta: { model: 'fixture-model', promptVersion: 'v0', samples: 1, temperature: 0, agreementWithHumanKappa: null },
    topBlockers: [],
    unknownItems: [],
  };
  return ReportSchema.parse(base);
}

describe('漏斗矩阵区分「没测」与「没走到」', () => {
  it('未接入的阶段标 未测，不标 ·', () => {
    const markdown = renderReport(report());
    const row = markdown.split('\n').find((line) => line.startsWith('| P1 p1-novice |'));
    expect(row).toBeDefined();
    const cells = (row ?? '').split('|').map((cell) => cell.trim()).filter(Boolean);
    /* cells = [persona, S0..S9] */
    expect(cells[1]).toBe('✓'); // S0 走到
    expect(cells[3]).toBe('未测'); // S2 没接
    expect(cells[6]).toBe('未测'); // S5 没接
    expect(cells[10]).toBe('未测'); // S9 没接
  });

  it('结论不说「最先掉队的位置是 S2」', () => {
    const markdown = renderReport(report());
    expect(markdown).not.toMatch(/最先掉队的位置是 \*\*S2/);
    expect(markdown).not.toMatch(/最先掉队的位置是 \*\*S5/);
    expect(markdown).not.toMatch(/最先掉队的位置是 \*\*S9/);
  });

  it('结论明确说未接入的阶段本次没有结论', () => {
    const markdown = renderReport(report());
    expect(markdown).toMatch(/S2 \/ S5 \/ S9 本次未接入旅程/);
    expect(markdown).toMatch(/空不等于通过/);
  });

  it('真卡在 S4 时仍然报 S4（保护没被改坏）', () => {
    const markdown = renderReport(report({ stageReached: 'S4' }));
    expect(markdown).toMatch(/最先没走到的位置是 \*\*S6/);
  });

  it('全走完时不谎称「走到最后一阶段」', () => {
    const markdown = renderReport(report({ stageReached: 'S8' }));
    expect(markdown).toMatch(/都走到了本版工具覆盖的最后一阶段（S8）/);
    expect(markdown).not.toMatch(/三个 persona 都走到了最后一阶段/);
  });
});
