/**
 * 第一层执行器：跑全部确定性断言，输出机器可读的 JSON 与人可读的摘要。
 *
 * 用法：
 *   node ./src/layer1/index.ts                      # 打到 stdout
 *   node ./src/layer1/index.ts --json out.json      # 同时写文件
 *   API_BASE_URL=http://host:3001/api/v1 node ./src/layer1/index.ts
 *
 * 退出码：全部 passed/skipped → 0；有 failed → 1。skipped 不算失败，
 * 但会打印出来并在覆盖率里扣分 —— 悄悄跳过是这份工具最不该有的行为。
 */

import { writeFileSync } from 'node:fs';
import { ApiClient, DEFAULT_BASE_URL } from './client.ts';
import {
  checkContractShape,
  checkDetailPercentMatchesList,
  checkGateDistinguishesReasons,
  checkGateIsPerKnowledgePoint,
  checkGateTierMonotonic,
  checkGateUndetermined,
  checkMasteryNullNotZero,
  checkPaginationIntegrity,
  checkSharedAnswerChunksExist,
  checkValidationErrors,
} from './checks.ts';
import { summarize, type SuiteResult } from './types.ts';

function parseArgs(argv: readonly string[]): { jsonPath: string | null } {
  const index = argv.indexOf('--json');
  if (index === -1) return { jsonPath: null };
  return { jsonPath: argv[index + 1] ?? 'layer1-result.json' };
}

export async function runLayer1(baseUrl: string = process.env.API_BASE_URL ?? DEFAULT_BASE_URL): Promise<SuiteResult> {
  const client = new ApiClient(baseUrl);
  const started = performance.now();
  const startedAt = new Date().toISOString();

  if (!(await client.isUp())) {
    throw new Error(
      `后端不可达：${baseUrl}/health\n` +
        '第一层要打真 API。启动方式：pnpm --filter @starmap/api dev（需 PostgreSQL）。',
    );
  }

  /* 顺序有意为之：先跑便宜且不依赖数据的纯函数断言，再跑网络与分页；
     分页最慢，放最后，这样前面挂了能更早看到。 */
  const results = [];
  results.push(await checkGateUndetermined());
  results.push(await checkGateDistinguishesReasons());
  results.push(await checkGateTierMonotonic());
  results.push(await checkGateIsPerKnowledgePoint());
  results.push(await checkMasteryNullNotZero(client));
  results.push(await checkContractShape(client));
  results.push(await checkValidationErrors(client));
  results.push(await checkPaginationIntegrity(client));
  results.push(await checkDetailPercentMatchesList(client));
  results.push(await checkSharedAnswerChunksExist(client));

  return {
    suite: 'layer1-deterministic',
    startedAt,
    durationMs: Math.round(performance.now() - started),
    baseUrl,
    results,
  };
}

const STATUS_MARK: Record<string, string> = { passed: '✓', failed: '✗', skipped: '–' };

function printSummary(suite: SuiteResult): void {
  const stats = summarize(suite);
  const lines: string[] = [
    '',
    `第一层确定性断言 · ${suite.baseUrl}`,
    '─'.repeat(72),
  ];

  for (const result of suite.results) {
    lines.push(`${STATUS_MARK[result.status] ?? '?'} ${result.id}  (${result.durationMs}ms)`);
    lines.push(`   ${result.title}`);
    lines.push(`   ${result.evidence}`);
    if (result.status === 'skipped' && result.skippedReason) {
      lines.push(`   跳过原因：${result.skippedReason}`);
    }
  }

  lines.push('─'.repeat(72));
  lines.push(
    `共 ${stats.total} 条：通过 ${stats.passed} / 失败 ${stats.failed} / 跳过 ${stats.skipped}` +
      `（执行覆盖率 ${(stats.coverageRate * 100).toFixed(0)}%，执行项通过率 ${(stats.passRateOfExecuted * 100).toFixed(0)}%）`,
  );
  lines.push(`耗时 ${suite.durationMs}ms`);
  if (stats.skipped > 0) {
    lines.push('注意：跳过的断言不计入通过率，但会拉低覆盖率 —— 报告里必须列出它们。');
  }
  lines.push('');
  console.log(lines.join('\n'));
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('/layer1/index.ts') ?? false;
if (isMain) {
  const { jsonPath } = parseArgs(process.argv.slice(2));
  runLayer1()
    .then((suite) => {
      printSummary(suite);
      if (jsonPath) {
        writeFileSync(jsonPath, `${JSON.stringify(suite, null, 2)}\n`, 'utf8');
        console.log(`结果已写入 ${jsonPath}`);
      }
      const stats = summarize(suite);
      process.exit(stats.failed > 0 ? 1 : 0);
    })
    .catch((error: unknown) => {
      console.error(`第一层执行失败：${(error as Error).message}`);
      process.exit(2);
    });
}
