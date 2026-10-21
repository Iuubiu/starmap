/**
 * 把 Report 渲染成 markdown。
 *
 * 渲染器只有一条铁律：**它不产生结论，只排列已经算出来的事实**。
 * 任何"综上，体验良好"之类的句子都不该出现在这里 —— 需要判断的地方，
 * 这里输出的是一句话加一个指向证据的路径。
 *
 * 首页三块是固定的：结论 / 证据等级 / 覆盖范围。顺序不能改，因为读者在
 * 三秒内就会决定要不要往下看，而这三块决定了他会不会误读后面所有数字。
 */

import {
  buildFunnelMatrix,
  JUDGE_DIMENSION_LABEL,
  STAGES,
  STAGE_IDS,
  FAILURE_IDS,
  FAILURE_LABEL,
  recognitionRates,
  type Report,
  type StageId,
} from './schema.ts';

const YES = '✓';
const NO = '·';

/**
 * 本版旅程里有对应阶段的那几级漏斗。
 *
 * S2（关卡卡产出）与 S5（追问表单）需要真跑 agent 回合才能产出结构化产物卡与
 * 追问表单，本版旅程没有接入 —— 所以它们不在这个数组里。
 *
 * **这个数组存在的唯一目的，是让报告不说谎。** `stageReached` 是按旅程阶段算的，
 * 拿它去和全部十级漏斗比，就会把「没测」写成「没走到」：S2/S5 永远不可能被
 * 到达，于是结论栏会稳定地写「最先掉队的位置是 S2」。那是一句读数错误 ——
 * 它会让人去查一个不存在的产品缺陷，而真正的结论是「这两级没测」。
 */
const COVERED_STAGE_IDS: readonly StageId[] = ['S0', 'S1', 'S3', 'S4', 'S6', 'S7', 'S8'];

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function sectionHeader(report: Report): string[] {
  const journeys = report.journeys;
  /* **「没走到」有两种原因，不能合并成一句「掉队」。**
     漏斗按 stageReached 算到达，但 S2（关卡卡产出）与 S5（追问表单）在本版工具里
     **压根没有对应的旅程阶段**，所以任何 persona 的 stageReached 都不可能 ≥ S2。
     若直接写「最先掉队的位置是 S2/S5」，读起来像产品在这两级卡住了，实际是工具
     没测。COVERED_STAGES 记的是旅程里真正有的阶段；扫描时只看这一段，
     未接入的阶段在结论里单独说。 */
  const covered = STAGE_IDS.filter((id) => COVERED_STAGE_IDS.includes(id));
  const reachedCounts = covered.map((id) => ({
    id,
    stage: STAGES.find((stage) => stage.id === id),
    count: journeys.filter((journey) => {
      const last = journey.stageReached;
      return STAGE_IDS.indexOf(last) >= STAGE_IDS.indexOf(id);
    }).length,
  }));
  const worst = reachedCounts.find((entry) => entry.count < journeys.length);
  const uncovered = STAGE_IDS.filter((id) => !COVERED_STAGE_IDS.includes(id));

  return [
    '# StarMap 模拟学习者评估报告',
    '',
    `> run_id \`${report.meta.runId}\` · app ${report.meta.appVersion} · model \`${report.meta.llmModel}\` (temp ${report.meta.modelTemperature}) · ${report.meta.startedAt} · 耗时 ${report.meta.durationS.toFixed(0)}s`,
    '',
    '## 结论',
    '',
    `- ${journeys.length} 个模拟学习者走完/中断了旅程：${journeys.map((j) => `${j.personaId}=${j.outcome}`).join('，')}。`,
    worst
      ? `- 在本次覆盖的范围内，最先没走到的位置是 **${worst.id} ${worst.stage?.label ?? ''}**（只有 ${worst.count}/${journeys.length} 个 persona 走到）。`
      : `- ${journeys.length} 个 persona 都走到了本版工具覆盖的最后一阶段（${covered[covered.length - 1]}）；这不说明体验好，只说明这次没测出阻塞。`,
    uncovered.length > 0
      ? `- **${uncovered.join(' / ')} 本次未接入旅程**，漏斗里它们是空的。空不等于通过 —— 这几级本次没有任何结论。`
      : '',
    report.topBlockers.length > 0
      ? `- 阻塞项 ${report.topBlockers.length} 条，最严重的是「${report.topBlockers[0]?.element ?? ''}」（${report.topBlockers[0]?.stage ?? ''}）。详见下文。`
      : '- 未记录阻塞项。**这是探测不足的信号，不是界面没问题的证据。**',
    '',
    '## 证据等级',
    '',
    `**${report.discipline.evidenceLevel}** —— 参与者是 LLM 扮演的模拟学习者，不是真人。`,
    '',
    '这类数据能做什么、不能做什么，说清楚：',
    '',
    `- 能：${YES} 找出"界面上真的点不动"的位置（locator_failure 数量是硬事实）、${YES} 暴露流程断裂、${YES} 生成待验证的假设。`,
    `  - "硬事实"的口径：每条 locator_failure 都是在 **\`waitForSettled\` 之后仍然不存在**才算数。`
      + `页面加载期间先让出 150ms、再等所有 \`role=progressbar\` 消失（上限 20 秒），然后才问"在不在"。`
      + `不这么做的话，"h1 已渲染但内容还在 pending"会被读成"元素不存在"，报告里就会出现一条不成立的 blocker。`
      + `（实测过：定级页 t=572ms 时 h1 已可见、按钮还没挂上，原写法在那里就判了红。）`,
    `- 不能：${NO} 证明可用性达标；${NO} 预测真人满意度；${NO} 替代真实学习者测试。`,
    `- 未校准项：judge 与真人评分的一致性 κ = \`${String(report.judgeMeta.agreementWithHumanKappa)}\`（${report.judgeMeta.samples} 次采样，prompt \`${report.judgeMeta.promptVersion}\`）。`,
    `- 本报告**不宣称可用性达标**（结构上已锁死：claimsUsabilityPassed = false）。`,
    '',
    '## 覆盖范围',
    '',
    `- 阶段轴 S0–S9 共 ${STAGES.length} 级，实际覆盖到第 ${STAGES.findIndex((s) => s.id === (journeys[0]?.stageReached ?? 'S0')) + 1} 级。`,
    `- 典型误解为**设计假设**（misconceptionsAreDesignAssumptions = ${String(report.discipline.misconceptionsAreDesignAssumptions)}），无文献支撑，上线前须请核电子学教师复核。`,
    `- persona 区分度自检：${report.discipline.distinctivenessChecked ? '已执行' : '**未执行**'}${
      report.discipline.distinctivenessViolations.length > 0 ? `，${report.discipline.distinctivenessViolations.length} 项不达标` : ''
    }。`,
    `- 未覆盖/无结论的条目见文末「未知与缺口」。`,
    '',
  ];
}

function distinctivenessSection(report: Report): string[] {
  const lines: string[] = ['## persona 区分度', ''];
  if (!report.discipline.distinctivenessChecked) {
    lines.push('未执行区分度自检 —— 本次报告无法排除三个 persona 实际是同一个人的可能。', '');
    return lines;
  }
  lines.push(
    '三项硬指标（首轮输入长度 / 追问容忍轮数 / 术语密度）两两相对差须 ≥20%，否则 persona 坍缩：',
    '',
  );
  if (report.discipline.distinctivenessViolations.length === 0) {
    lines.push('- 三项全部达标。', '');
  } else {
    for (const violation of report.discipline.distinctivenessViolations) lines.push(`- ✗ ${violation}`);
    lines.push('');
  }
  return lines;
}

function funnelSection(report: Report): string[] {
  const { stages, rows } = buildFunnelMatrix(report);
  const lines: string[] = ['## 阶段漏斗矩阵', '', '竖着看每一列 = 该阶段的产品问题；横着看每一行 = 某个 persona 的适配问题。', ''];

  const header = ['persona', ...stages.map((stage) => `${stage.id}`)];
  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    /* 未接入的级用 `未测` 而不是 `·`。两者在旧版里长得一样，但意思差很远：
       `·` 读作「没走到」= 产品在这一级卡住了；`未测` 读作「工具没接」= 没有结论。 */
    const cells = row.cells.map((cell, index) => {
      const stageId = stages[index]?.id;
      if (stageId !== undefined && !COVERED_STAGE_IDS.includes(stageId)) return '未测';
      return cell === 'reached' ? YES : NO;
    });
    lines.push(`| ${row.tier} ${row.personaId} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('> `未测` = 本版旅程没有对应的阶段，不是「没走到」，也不是「通过」。');
  lines.push('');
  lines.push('阶段定义：');
  lines.push('');
  for (const stage of stages) lines.push(`- **${stage.id} ${stage.label}** — ${stage.detail}`);
  lines.push('');
  return lines;
}

function journeySection(report: Report): string[] {
  const lines: string[] = ['## 逐 persona 明细', ''];
  for (const journey of report.journeys) {
    lines.push(`### ${journey.tier} · ${journey.personaId} · 场景 ${journey.scenarioId}`, '');
    lines.push(`- 结局：**${journey.outcome}**，走到 **${journey.stageReached}**`);
    const friction = journey.friction;
    const unsampled = new Set(journey.unsampled);
    const mark = (field: string, value: string) => (unsampled.has(field) ? '未采集' : value);
    lines.push(
      `- 摩擦：找不到目标 ${friction.locatorFailures} 次 · 死点 ${mark('deadClicks', `${friction.deadClicks} 次`)} · 狂点 ${mark(
        'rageClicks',
        `${friction.rageClicks} 次`,
      )} · ` +
        `清空输入 ${mark('inputClears', `${friction.inputClears} 次`)} · 刷新循环 ${mark('refreshLoops', `${friction.refreshLoops} 次`)} · ` +
        `跳过表单 ${mark('formSkips', `${friction.formSkips} 次`)} · 放弃于第 ${friction.abandonmentTurn ?? '—'} 轮`,
    );
    if (unsampled.size > 0) {
      lines.push(
        '  - **「未采集」不是 0。** 本版旅程是确定性阶段脚本，不模拟狂点/空输入/刷新循环，'
          + '那几个计数恒为 0 是因为没数，不是数出来是 0。',
      );
    }
    if (journey.artifacts.length > 0) {
      lines.push('- 产物校验：');
      for (const artifact of journey.artifacts) {
        const status = artifact.schemaOk ? `${YES} 合法` : `✗ 缺字段：${artifact.missingFields.join('、') || '未知'}`;
        lines.push(`  - ${artifact.type}（第 ${artifact.turn} 轮）：${status}`);
      }
    }
    const fired = FAILURE_IDS.filter((id) => (journey.failures[id]?.occurrences ?? 0) > 0);
    if (fired.length > 0) {
      lines.push('- 失败模式：');
      for (const id of fired) {
        const entry = journey.failures[id];
        if (!entry) continue;
        lines.push(`  - **${id} ${FAILURE_LABEL[id]}** ×${entry.occurrences}（首次第 ${entry.firstTurn ?? '—'} 轮）`);
        for (const evidence of entry.evidence.slice(0, 3)) lines.push(`    - ${evidence}`);
      }
    } else {
      lines.push('- 失败模式：无记录（覆盖不足时也会显示无，注意区分）。');
    }
    if (journey.quotes.length > 0) {
      lines.push('- 学生原话：');
      for (const quote of journey.quotes) lines.push(`  > 「${quote.text}」（第 ${quote.turn} 轮）`);
    }
    lines.push('');
    lines.push(...scoringFactsSection(journey));
  }
  return lines;
}

/** 三个"能算出数字"的失败判据：识别率分母分开、泄露按等级、漂移有 κ。 */
function scoringFactsSection(journey: Report['journeys'][number]): string[] {
  const lines: string[] = [];
  const { correct, wrong } = recognitionRates(journey.recognition);
  const fmt = (value: number | null, total: number) => (value === null ? `无样本（0 题）` : `${pct(value)}（${total} 题）`);

  lines.push(
    `- 答对识别率：${fmt(correct, journey.recognition.correctTotal)}` +
      `　答错识别率：${fmt(wrong, journey.recognition.wrongTotal)}`,
  );
  lines.push(
    '  - 两行必须分开看：模型倾向肯定正确、对错误给模糊反馈。合并成一个"识别准确率"，' +
      '两种偏差会互相抵消，看起来及格实则一侧在漏水。答错识别只算**明确判错**，' +
      '「再想想」「差一点」这类模糊反馈不计入。',
  );

  const leak = journey.leakRate;
  const leakCell = (value: number | null, samples: number) =>
    value === null ? '未测' : samples < 3 ? `样本不足（${samples} 次）` : `${pct(value)}（${samples} 次）`;
  lines.push(
    `- 泄露答案率：L1 ${leakCell(leak.L1, leak.samples.L1)} · L2 ${leakCell(leak.L2, leak.samples.L2)} · L3 ${leakCell(leak.L3, leak.samples.L3)}`,
  );
  lines.push('  - L3（三级施压）那一格才是重点：那是"学生明着要答案，系统还守不守得住"。少于 3 次观察的比率不要引用。');

  const drift = journey.scoringConsistency;
  if (drift.nReplays === 0) {
    lines.push('- 判分漂移：**未做重放**（未测 ≠ 稳定）。');
  } else {
    const kappa = drift.fleissKappa === null ? 'null' : drift.fleissKappa.toFixed(2);
    const cv = drift.cv === null ? 'null' : drift.cv.toFixed(3);
    lines.push(`- 判分漂移：重放 ${drift.nReplays} 次 · Fleiss κ = ${kappa}（达标线 ≥0.8）· 连续量表 CV = ${cv}（达标线 ≤0.05）`);
    lines.push('  - 只报原始一致率是不够的：5 次全一样可能只是题目太简单，κ 扣掉随机一致的基线。');
  }

  const stall = journey.stall;
  if (stall.stalls.length === 0) {
    lines.push('- 过度追问：无停滞记录（覆盖不足时也会显示无，注意区分）。');
  } else {
    const lengths = stall.stalls.join('、');
    lines.push(
      `- 过度追问：最长停滞 ${stall.maxStall} 轮 · 长度 ≥3 的停滞 ${stall.stallsOver2} 次（达标线 ≤1）· 各次长度 ${lengths}`,
    );
    lines.push('  - 记分布而不是平均值：平均值会把「每次卡 2 轮」和「一次卡 10 轮」抹平，后者才是学生放弃的真实原因。');
  }

  lines.push('');
  return lines;
}

function judgeSection(report: Report): string[] {
  const lines: string[] = ['## 主观维度（judge）', ''];
  if (report.judgeScores.length === 0) {
    lines.push('本次未产生 judge 评分（层③ 未接真模型时属预期）。', '');
    return lines;
  }
  lines.push('| persona | 维度 | 得分 |', '| --- | --- | --- |');
  for (const score of report.judgeScores) {
    lines.push(`| ${score.personaId} | ${JUDGE_DIMENSION_LABEL[score.dimension]} | ${score.score.toFixed(1)} / 5 |`);
  }
  lines.push('', 'judge 只评这四维；判分正确性、门控结论、答案泄漏等**确定性事实不在此列**，见层①。', '');
  return lines;
}

function blockerSection(report: Report): string[] {
  const lines: string[] = ['## 阻塞项与建议', ''];
  if (report.topBlockers.length === 0) {
    lines.push('无阻塞项记录。', '');
    return lines;
  }
  lines.push('| # | 阶段 | 界面位置 | 问题 | 严重度 |', '| --- | --- | --- | --- | --- |');
  report.topBlockers.forEach((blocker, index) => {
    lines.push(`| ${index} | ${blocker.stage} | ${blocker.element} | ${blocker.description} | ${blocker.severity} |`);
  });
  lines.push('');
  if (report.suggestedFixes.length > 0) {
    lines.push('建议（**均为假设，未验证**）：');
    lines.push('');
    for (const fix of report.suggestedFixes) {
      lines.push(`- 针对 #${fix.blockerRef}：${fix.hypothesis}（工作量 ${fix.effort}）`);
    }
    lines.push('');
  }
  return lines;
}

function footerSection(report: Report): string[] {
  const lines: string[] = ['## 未知与缺口', ''];
  if (report.unknownItems.length === 0) {
    lines.push('本次未记录缺口 —— 这通常意味着没有去找，而不是没有。', '');
  } else {
    for (const item of report.unknownItems) lines.push(`- ${item}`);
    lines.push('');
  }
  lines.push(
    '## 免责声明',
    '',
    '1. **证据等级**：参与者是 LLM 扮演的模拟学习者，结论属**假设生成**，不能替代真实学习者测试。',
    '2. **方差**：合成用户的方差显著小于真人（NN/g 的 mode collapse 结论）。本报告的"一致性好"**不能**当作可信度证据。',
    '3. **未校准**：judge 未经人工标注校准前只作趋势参考；`agreement_with_human_kappa` 无值即写 `null`，不要填估算值。',
    '',
  );
  return lines;
}

export function renderReport(report: Report): string {
  return [
    ...sectionHeader(report),
    ...distinctivenessSection(report),
    ...funnelSection(report),
    ...journeySection(report),
    ...judgeSection(report),
    ...blockerSection(report),
    ...footerSection(report),
  ].join('\n');
}

/** 供测试用：从 0 到 1 的覆盖率，报告里没算这个数是因为它容易被误读成"进度"。 */
export function stageCoverage(report: Report): number {
  const index = STAGES.findIndex((stage) => stage.id === (report.journeys[0]?.stageReached ?? 'S0'));
  return index < 0 ? 0 : (index + 1) / STAGES.length;
}

export { pct };
