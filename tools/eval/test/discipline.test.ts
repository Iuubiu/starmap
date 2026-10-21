/**
 * 票 20 的硬性纪律用测试锁死。
 *
 * 这些测试的价值不在于"覆盖代码"，而在于**它们会拦住人的嘴**：
 * 报告模板里出现"可用性达标"、persona 被悄悄改了却没重跑区分度、
 * judge 被问到确定性问题 —— 都是写文章时最容易顺手犯的错，
 * 而它们在评审时几乎看不出来（句子读起来很顺）。
 */

import { describe, expect, it } from 'vitest';
import { loadAllPersonas, checkDistinctiveness, MIN_RELATIVE_GAP, DISTINCTIVENESS_DIMENSIONS } from '../src/personas/index.ts';
import { checkPersonaCoherence } from '../src/personas/schema.ts';
import { renderReport } from '../src/report/render.ts';
import { scanForbiddenClaims, ReportSchema, STAGE_IDS, type Report } from '../src/report/schema.ts';
import { checkJudgeDiscipline, JudgeVerdictSchema, JudgeMetaSchema } from '../src/layer3/judge.ts';
import { resolveTarget, type TargetCandidate } from '../src/layer2/resolve.ts';
import { parseAgentAction } from '../src/layer2/action.ts';

const personas = loadAllPersonas();

function fixtureReport(overrides: Partial<Report> = {}): Report {
  return {
    meta: {
      runId: 'run-fixture',
      appVersion: '0.1.0',
      llmModel: 'fixture-model',
      modelTemperature: 0,
      startedAt: '2026-10-20T00:00:00.000Z',
      durationS: 120,
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
        scenarioId: 'first-level',
        outcome: 'partial',
        stageReached: 'S4',
        stageDurations: { S0: 1.2, S1: 3.4 },
        turnsPerStage: { S0: 1, S1: 2 },
        artifacts: [{ type: 'level_card', turn: 2, schemaOk: false, missingFields: ['expected_answer_spec'] }],
        friction: {
          rageClicks: 0,
          deadClicks: 1,
          uTurns: 2,
          inputClears: 1,
          refreshLoops: 0,
          hintRequests: 2,
          formSkips: 0,
          locatorFailures: 1,
          abandonmentTurn: null,
        },
        failures: {
          F1: { occurrences: 0, firstTurn: null, evidence: [] },
          F2: { occurrences: 1, firstTurn: 3, evidence: ['连续两次「不知道」后系统仍追问'] },
          F3: { occurrences: 0, firstTurn: null, evidence: [] },
          F4: { occurrences: 0, firstTurn: null, evidence: [] },
          F5: { occurrences: 0, firstTurn: null, evidence: [] },
          F6: { occurrences: 0, firstTurn: null, evidence: [] },
          F7: { occurrences: 0, firstTurn: null, evidence: [] },
          F8: { occurrences: 1, firstTurn: 3, evidence: [] },
        },
        quotes: [{ turn: 3, text: '你就直说吧' }],
        // 分母分开记：3 题答对认了 2 题；2 题答错只认出 1 题 ——
        // 合并成 3/5 = 60% 会掩盖"答错那侧在漏水"这件事。
        recognition: { correctTotal: 3, correctRecognized: 2, wrongTotal: 2, wrongRecognized: 1 },
        leakRate: { L1: 0.1, L2: 0.2, L3: 0.5, samples: { L1: 5, L2: 5, L3: 4 } },
        scoringConsistency: { fleissKappa: 0.83, cv: 0.02, nReplays: 5 },
        stall: { maxStall: 3, stalls: [2, 3], stallsOver2: 1 },
        paasSeries: [7, 8],
        unsampled: [],
      },
    ],
    judgeScores: [],
    judgeMeta: { model: 'fixture-model', promptVersion: 'v0', samples: 1, temperature: 0, agreementWithHumanKappa: null },
    topBlockers: [{ stage: 'S2', element: '关卡卡 · 缺失字段', description: '关卡卡没有 expected_answer_spec，导致追问表单无法生成', severity: 'blocker' }],
    suggestedFixes: [{ blockerRef: 0, hypothesis: '在关卡卡渲染前用 schema 校验一次，缺字段就不下发', effort: 'small' }],
    unknownItems: ['judge 与真人评分的一致性：无数据'],
    ...overrides,
  };
}

describe('persona 纪律', () => {
  it('三个 persona 都能加载，且彼此 id/tier 不重复', () => {
    expect(personas.length).toBe(3);
    expect(new Set(personas.map((persona) => persona.id)).size).toBe(3);
    expect(new Set(personas.map((persona) => persona.tier)).size).toBe(3);
  });

  it('每个 persona 的典型误解都标了「设计假设」且不带文献支撑', () => {
    for (const persona of personas) {
      expect(persona.provenance.isDesignAssumption).toBe(true);
      for (const misconception of persona.misconceptions) {
        expect(misconception.isDesignAssumption).toBe(true);
        /* 误解必须写清「为什么听起来合理」和「什么能纠正它」——
           只写 belief 的话，读者无法判断这是不是凭空捏的。 */
        expect(misconception.whyPlausible.length).toBeGreaterThanOrEqual(4);
        expect(misconception.whatWouldCorrectIt.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('三项区分度指标两两相对差 ≥20%（防 persona 坍缩）', () => {
    const violations = checkDistinctiveness(personas);
    expect(violations).toEqual([]);
    /* 同时把实际数值钉住，防止有人调参后"刚好达标"却没重跑这条测试。 */
    const values = DISTINCTIVENESS_DIMENSIONS.map((dimension) =>
      personas.map((persona) => persona.distinctiveness[dimension]),
    );
    for (const row of values) {
      for (let i = 0; i < row.length; i += 1) {
        for (let j = i + 1; j < row.length; j += 1) {
          const a = row[i] as number;
          const b = row[j] as number;
          const gap = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
          expect(gap).toBeGreaterThanOrEqual(MIN_RELATIVE_GAP);
        }
      }
    }
  });

  it('跨字段无矛盾（追问容忍轮数、术语密度、首轮长度区间等）', () => {
    for (const persona of personas) {
      expect(checkPersonaCoherence(persona)).toEqual([]);
    }
  });

  it('行为规则是可执行的，不是形容词', () => {
    for (const persona of personas) {
      const rules = [
        persona.behaviorParams.patience.rule,
        persona.behaviorParams.probeTolerance.rule,
        persona.behaviorParams.abandonCondition.rule,
        persona.behaviorParams.stuckHandling.rule,
      ];
      for (const rule of rules) {
        /* 要么给出数字（"3 轮""8 轮"），要么给出具体台词（带引号）。 */
        expect(/[0-9]|「|『|"/.test(rule)).toBe(true);
      }
    }
  });
});

describe('报告纪律', () => {
  it('报告模板渲染后不含任何越界说法', () => {
    const markdown = renderReport(fixtureReport());
    expect(scanForbiddenClaims(markdown)).toEqual([]);
  });

  it('措辞守卫真的能拦住越界说法（守卫自身有效）', () => {
    /* 反向验证：如果守卫对下面这些句子无反应，那它就是个摆设。 */
    expect(scanForbiddenClaims('结论：本产品可用性已达标。').length).toBeGreaterThan(0);
    expect(scanForbiddenClaims('与真人评分高度一致').length).toBeGreaterThan(0);
    expect(scanForbiddenClaims('未发现明显问题').length).toBeGreaterThan(0);
    expect(scanForbiddenClaims('风险可控，可以发布').length).toBeGreaterThan(0);
  });

  it('报告首页三块顺序固定：结论 → 证据等级 → 覆盖范围', () => {
    const markdown = renderReport(fixtureReport());
    const conclusion = markdown.indexOf('## 结论');
    const evidence = markdown.indexOf('## 证据等级');
    const coverage = markdown.indexOf('## 覆盖范围');
    expect(conclusion).toBeGreaterThan(-1);
    expect(evidence).toBeGreaterThan(conclusion);
    expect(coverage).toBeGreaterThan(evidence);
  });

  it('证据等级固定写「假设生成」，且结构上不能宣称达标', () => {
    expect(ReportSchema.safeParse({ ...fixtureReport(), discipline: { ...fixtureReport().discipline, evidenceLevel: '已验收' } }).success).toBe(false);
    expect(
      ReportSchema.safeParse({ ...fixtureReport(), discipline: { ...fixtureReport().discipline, claimsUsabilityPassed: true } }).success,
    ).toBe(false);
    expect(scanForbiddenClaims(renderReport(fixtureReport())).length).toBe(0);
  });

  it('agreement_with_human_kappa 只能是 null', () => {
    expect(JudgeMetaSchema.safeParse({ model: 'm', promptVersion: 'v', samples: 1, temperature: 0, agreementWithHumanKappa: null }).success).toBe(true);
    expect(JudgeMetaSchema.safeParse({ model: 'm', promptVersion: 'v', samples: 1, temperature: 0, agreementWithHumanKappa: 0.81 }).success).toBe(false);
  });

  it('漏斗矩阵：每个 persona 一行、十级阶段各一列', () => {
    const markdown = renderReport(fixtureReport());
    const headerRow = markdown.split('\n').find((line) => line.startsWith('| persona |'));
    expect(headerRow).toBeDefined();
    for (const stage of STAGE_IDS) expect(headerRow).toContain(stage);
  });

  it('典型误解在设计假设这一点上写进报告正文，而不是只写在配置文件里', () => {
    const markdown = renderReport(fixtureReport());
    expect(markdown).toContain('设计假设');
    expect(markdown).toMatch(/无文献支撑/);
  });

  it('落盘的 docs/eval-report.md 模板同样受措辞守卫约束', async () => {
    /* 只测渲染器是不够的：模板是手写的另一份文本，同样是"会被人读到的报告"，
       而且它是唯一一份现在就已经在仓库里的评估结论类文档。 */
    const { readFile } = await import('node:fs/promises');
    const path = new URL('../../../docs/eval-report.md', import.meta.url);
    const markdown = await readFile(path, 'utf8');
    expect(scanForbiddenClaims(markdown)).toEqual([]);
    expect(markdown).toContain('假设生成');
    expect(markdown).toContain('agreement_with_human_kappa');
    expect(markdown).toContain('无文献支撑');
  });
});

describe('可算数字的失败判据', () => {
  it('答对识别率与答错识别率分开报，不合并成一个数字', () => {
    const markdown = renderReport(fixtureReport());
    // fixture：答对 2/3、答错 1/2 —— 两个不同的比率必须各自出现。
    expect(markdown).toContain('答对识别率：67%（3 题）');
    expect(markdown).toContain('答错识别率：50%（2 题）');
    // 合并成 3/5 = 60% 会掩盖"答错那侧在漏水"，所以 60% 不该是这两行的值。
    expect(markdown).not.toContain('识别率：60%');
  });

  it('分母为 0 时识别率是「无样本」而不是 0%', () => {
    /* 与 percent: null 同一条纪律：没测出来 ≠ 测出来是 0。 */
    const report = fixtureReport();
    report.journeys[0]!.recognition = { correctTotal: 0, correctRecognized: 0, wrongTotal: 2, wrongRecognized: 2 };
    const markdown = renderReport(report);
    expect(markdown).toContain('答对识别率：无样本（0 题）');
    expect(markdown).not.toContain('答对识别率：0%');
    expect(markdown).toContain('答错识别率：100%（2 题）');
  });

  it('泄露答案率按 L1/L2/L3 分别报，样本不足 3 次时拒绝给比率', () => {
    const report = fixtureReport();
    report.journeys[0]!.leakRate = { L1: 0, L2: 0, L3: 1, samples: { L1: 10, L2: 10, L3: 2 } };
    const markdown = renderReport(report);
    expect(markdown).toContain('L1 0%（10 次）');
    // L3 只有 2 次观察，100% 会误导读者。
    expect(markdown).toContain('L3 样本不足（2 次）');
    expect(markdown).not.toContain('L3 100%');
  });

  it('未做重放时写「未测 ≠ 稳定」，不写 κ = 1', () => {
    const report = fixtureReport();
    report.journeys[0]!.scoringConsistency = { fleissKappa: null, cv: null, nReplays: 0 };
    const markdown = renderReport(report);
    expect(markdown).toContain('判分漂移：**未做重放**（未测 ≠ 稳定）');
    expect(markdown).not.toContain('Fleiss κ = 1');
  });

  it('过度追问记分布，并单独报长度 ≥3 的次数', () => {
    const markdown = renderReport(fixtureReport());
    expect(markdown).toContain('最长停滞 3 轮');
    expect(markdown).toContain('长度 ≥3 的停滞 1 次');
    expect(markdown).toContain('各次长度 2、3');
  });
});

describe('judge 纪律', () => {
  it('judge 输出必须带理由与原文引用', () => {
    const ok = JudgeVerdictSchema.safeParse({
      scores: [{ dimension: 'clarity', score: 4, rationale: '句子较短且没有嵌套从句', evidenceQuote: '这门课的重点是…' }],
    });
    expect(ok.success).toBe(true);
    const noQuote = JudgeVerdictSchema.safeParse({
      scores: [{ dimension: 'clarity', score: 4, rationale: '句子较短且没有嵌套从句', evidenceQuote: '' }],
    });
    expect(noQuote.success).toBe(false);
  });

  it('评了未授权维度会被纪律检查抓出来', () => {
    const verdict = { scores: [{ dimension: 'tone' as const, score: 3, rationale: '语气偏冷，缺少回应', evidenceQuote: '请重试' }], needsHumanReview: [] };
    expect(checkJudgeDiscipline(verdict, ['clarity'])).toHaveLength(1);
    expect(checkJudgeDiscipline(verdict, ['tone'])).toHaveLength(0);
  });
});

describe('target_hint 解析器', () => {
  const candidates: TargetCandidate[] = [
    { index: 0, role: 'tab', name: '看板', tag: 'button', x: 20, y: 10, width: 80, height: 32, disabled: false, visible: true },
    { index: 1, role: 'button', name: '数字技术的发展及其应用，未学习，证据不足', tag: 'button', x: 20, y: 200, width: 300, height: 90, disabled: false, visible: true },
    { index: 2, role: 'button', name: '模拟信号和数字信号，未学习，证据不足', tag: 'button', x: 340, y: 200, width: 300, height: 90, disabled: false, visible: true },
  ];

  it('引号原文能命中', () => {
    const result = resolveTarget('顶部写着「看板」的标签', candidates, { viewportWidth: 1440, viewportHeight: 900 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target.name).toBe('看板');
  });

  it('序号能消歧同分候选', () => {
    const result = resolveTarget('第一张知识点卡片', candidates, { viewportWidth: 1440, viewportHeight: 900 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target.index).toBe(1);
  });

  it('页面上不存在的东西必须报 locator_failure，不能被角色词蒙到', () => {
    const result = resolveTarget('根本不存在的「学习进度导出」按钮', candidates, { viewportWidth: 1440, viewportHeight: 900 });
    expect(result.ok).toBe(false);
  });

  it('名字命中但两个候选同名同分时报歧义，而不是随便挑一个', () => {
    const twins: TargetCandidate[] = [
      { index: 0, role: 'button', name: '下一步', tag: 'button', x: 10, y: 10, width: 80, height: 32, disabled: false, visible: true },
      { index: 1, role: 'button', name: '下一步', tag: 'button', x: 10, y: 500, width: 80, height: 32, disabled: false, visible: true },
    ];
    const result = resolveTarget('点「下一步」', twins, { viewportWidth: 1440, viewportHeight: 900 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/多个元素|同分/);
  });
});

describe('动作协议解析', () => {
  it('容忍 markdown 围栏与前后废话', () => {
    const raw = '我看看……\n```json\n{"action":"click","target_hint":"看板","text":"","felt":{"effort":6,"confusion":2,"frustration":1},"note":"先进去看看"}\n```';
    const parsed = parseAgentAction(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.action) expect(parsed.action.action).toBe('click');
  });

  it('乱说时给出协议错误而不是塞一个默认动作', () => {
    const parsed = parseAgentAction('我觉得这个页面还行');
    expect(parsed.ok).toBe(false);
  });
});
