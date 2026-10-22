/**
 * judge 自检的命令行入口：`pnpm --filter @starmap/eval gold`。
 *
 * ## 为什么单独一个入口
 *
 * `run.ts` 跑一次要两分钟（三档九阶段），而调 prompt、换模型、怀疑 judge
 * 判得不对的时候，人只想看那三条 gold transcript。把它抽出来，改一句 prompt
 * 就能在 20 秒内看到结果，而不是等整条旅程跑完。
 *
 * ## 退出码
 *
 * 0 = 三条全过；1 = 有判错的（此时**不要**相信任何一次正式运行里的 judge 数字，
 * 先在 `run.ts` 那份报告里它们会被标成不可信）。
 */

import { GOLD_TRANSCRIPTS, LlmJudge, runGoldCheck } from './llm-judge.ts';

const judge = new LlmJudge({});
console.log(`model=${judge.meta.model}  prompt=${judge.meta.promptVersion}  samples=${judge.meta.samples}`);

const results = await runGoldCheck(judge);
for (const result of results) {
  console.log(`${result.passed ? '✓' : '✗'} ${result.transcriptId}（${result.label}）`);
  for (const mismatch of result.mismatches) console.log(`    ${mismatch}`);
  const assessment = result.assessment;
  if (assessment) {
    console.log(
      `    ack=${String(assessment.acknowledgesCorrect)} idw=${String(assessment.identifiesWrong)} ` +
        `leak=${String(assessment.leaksAnswer)} probes=${assessment.consecutiveProbes} degraded=${String(assessment.degraded)}`,
    );
  }
}

const passed = results.filter((result) => result.passed).length;
console.log(`\n${passed}/${GOLD_TRANSCRIPTS.length} 通过`);
process.exit(passed === GOLD_TRANSCRIPTS.length ? 0 : 1);
