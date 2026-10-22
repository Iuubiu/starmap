/**
 * 第一层：确定性断言。
 *
 * 三件事必须成立，否则整层白做：
 *  ① 先跑、最便宜 —— 全部是 HTTP GET 与纯函数调用，没有一个 LLM 调用；
 *  ② judge 永不碰能算出来的东西 —— 任何"这条 percent 是 null 还是 0"的问题
 *     都必须在这里用代码判完，不许进第三层；
 *  ③ 失败要带数字 —— evidence 写的是实际观察到的值，不是模板句。
 *
 * 票 20 要求的三条不变量（见 `.scratch/lit/ux-eval-methods.md` 与票 20 原文）：
 *  A. 证据不足必须 percent:null，而不是 0；
 *  B. 门控未达门槛必须 undetermined，而不是通过；
 *  C. 同一 chunk 在两个知识点下，门控结论可以相反。
 */

import { ApiClient, fetchAllPages } from './client.ts';
import type { CheckResult } from './types.ts';
/* 直接 import engine 的**源文件**而不是 `@starmap/engine`：
   该包的 main 是 ./dist/index.js，而 src 里没有 index.ts（只有四个模块），
   dist 构建后也没有 index.js —— 也就是说 `import '@starmap/engine'` 现在
   会 module-not-found。补一个 index.ts 属于 level-dev 的泳道，本任务不越界。
   这里用相对路径跨包引用，代价是 tools/eval 的 tsconfig 会把这几个源文件
   一起类型检查（无副作用）。等 engine 有了 barrel 再换回包名。 */
import { evaluateExitGate, GATE_RULES } from '../../../../packages/engine/src/gating.ts';
import { filterChunks, gateTierFor } from '../../../../packages/engine/src/retrieval-gate.ts';

interface NodeState {
  microKpId: string;
  name: string;
  state: string;
  percent: number | null;
  depth: number;
}

interface NodeListBody {
  items: NodeState[];
  nextCursor: string | null;
}

interface LevelSummary {
  levelId: string;
  microKpId: string;
  title: string;
  itemCount: number;
  kind: string;
}

interface NodeDetailBody {
  node: NodeState;
  levels: LevelSummary[];
  reasons: string[];
}

function extractNodeList(body: unknown): { items: NodeState[]; nextCursor: string | null } {
  const typed = body as NodeListBody;
  if (!typed || !Array.isArray(typed.items)) {
    throw new Error(`/nodes 响应缺少 items 数组：${JSON.stringify(body).slice(0, 300)}`);
  }
  return { items: typed.items, nextCursor: typed.nextCursor ?? null };
}

/** 包一层计时 + 异常收口，避免一条断言炸掉整层。 */
async function run(
  id: string,
  title: string,
  fn: () => Promise<Omit<CheckResult, 'id' | 'title' | 'durationMs'>>,
): Promise<CheckResult> {
  const started = performance.now();
  try {
    const result = await fn();
    return { id, title, ...result, durationMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      id,
      title,
      status: 'failed',
      evidence: `断言执行器抛异常：${(error as Error).message}`,
      durationMs: Math.round(performance.now() - started),
    };
  }
}

// ─────────────────────────────────────────────────────────────
// 不变量 A：证据不足必须是 null，不是 0
// ─────────────────────────────────────────────────────────────

/**
 * 为什么这条值得单独立一条断言：`percent: 0` 和 `percent: null` 在前端会
 * 渲染成完全不同的两件事（「0%」vs「证据不足」）。如果后端把没数据的知识点
 * 填成 0，用户会看到一整屏「0%」，读起来像"你什么都没学会"，而事实是
 * "还没测过"。这是把沉默的未知伪装成一个坏消息。
 */
export async function checkMasteryNullNotZero(client: ApiClient): Promise<CheckResult> {
  return run('A1.mastery-null-not-zero', '未学习/证据不足的知识点 percent 必须是 null，不能填 0', async () => {
    const { items } = await fetchAllPages<NodeState>(client, '/nodes', 100, extractNodeList);

    /* 把 percent==0 且 state 表示"没测过"的组合单独挑出来 —— 这才是违规。
       已掌握但真正考了 0 分的情况 percent===0 是合法的，不能误伤。 */
    const zeroButNoEvidence = items.filter(
      (node) => node.percent === 0 && (node.state === 'unseen' || node.state === 'unfamiliar'),
    );
    const nullCount = items.filter((node) => node.percent === null).length;
    const allNull = items.filter((node) => node.percent === null);

    /* 反向检查：percent 为 null 时 state 也应该表示"没测过"。
       如果 state 说"已掌握"却说不出百分比，那是另一种自相矛盾。 */
    const nullButClaimedMastery = allNull.filter(
      (node) => node.state === 'mastered' || node.state === 'proficient',
    );

    const problems: string[] = [];
    if (zeroButNoEvidence.length > 0) {
      const sample = zeroButNoEvidence
        .slice(0, 3)
        .map((node) => `${node.microKpId}(state=${node.state},percent=0)`)
        .join('、');
      problems.push(`${zeroButNoEvidence.length} 个知识点把"证据不足"写成了 0：${sample}`);
    }
    if (nullButClaimedMastery.length > 0) {
      const sample = nullButClaimedMastery
        .slice(0, 3)
        .map((node) => `${node.microKpId}(state=${node.state})`)
        .join('、');
      problems.push(`${nullButClaimedMastery.length} 个知识点声称已掌握却没有百分比：${sample}`);
    }

    return {
      status: problems.length === 0 ? 'passed' : 'failed',
      evidence:
        problems.length === 0
          ? `扫了 ${items.length} 个知识点：percent===null 有 ${nullCount} 个，值为 0 的 ${items.length - nullCount} 个全部属于"确实测过且得 0"或"有百分比"的情形，未发现用 0 冒充"证据不足"`
          : problems.join('；'),
      metrics: {
        nodesScanned: items.length,
        nullPercent: nullCount,
        zeroButNoEvidence: zeroButNoEvidence.length,
        nullButClaimedMastery: nullButClaimedMastery.length,
      },
    };
  });
}

/** 详情接口的 node.percent 必须与列表一致（同一个知识点两个接口不能给两个答案）。 */
export async function checkDetailPercentMatchesList(client: ApiClient): Promise<CheckResult> {
  return run('A2.detail-percent-matches-list', '详情与列表对同一知识点给出相同的 percent 与 state', async () => {
    const { items } = await fetchAllPages<NodeState>(client, '/nodes', 100, extractNodeList);
    /* 抽样而不是全量：详情接口比列表贵，20 个够代表；要全量可以改 sampleSize。 */
    const sampleSize = Math.min(20, items.length);
    const sample = items.slice(0, sampleSize);

    const mismatches: string[] = [];
    for (const node of sample) {
      const response = await client.get(`/nodes/${encodeURIComponent(node.microKpId)}`);
      if (response.status !== 200) {
        mismatches.push(`${node.microKpId}: 详情返回 ${response.status}`);
        continue;
      }
      const detail = (response.body as NodeDetailBody).node;
      if (detail.percent !== node.percent || detail.state !== node.state) {
        mismatches.push(
          `${node.microKpId}: 列表(${node.state},${node.percent}) vs 详情(${detail.state},${detail.percent})`,
        );
      }
    }

    return {
      status: mismatches.length === 0 ? 'passed' : 'failed',
      evidence:
        mismatches.length === 0
          ? `抽样 ${sampleSize} 个知识点，列表与详情的 (state, percent) 完全一致`
          : mismatches.join('；'),
      metrics: { sampled: sampleSize, mismatches: mismatches.length },
    };
  });
}

// ─────────────────────────────────────────────────────────────
// 不变量 B：门控未达门槛必须是 undetermined
// ─────────────────────────────────────────────────────────────

/**
 * 这条断言跑在 engine 的纯函数上而不是 HTTP 上：门控接口（票 06）还没落地，
 * 但判据的**唯一实现**已经在 `packages/engine/src/gating.ts` 里了。断言纯函数
 * 是最"确定性"的一种测试 —— 没有网络、没有数据库、没有 LLM，跑一百次同一个答案。
 *
 * 关键点：`insufficient_items`（题量不够）与 `below_threshold`（答对率不够）
 * 都必须是 `undetermined`/`failed`，绝不能因为"没到门槛"就放行。票 06 的原话
 * 是「门控未达门槛必须 undetermined 而非通过」，说的就是这种"没测够 = 算通过"
 * 的偷懒。
 */
export async function checkGateUndetermined(): Promise<CheckResult> {
  return run('B1.gate-undetermined-not-pass', '题量不足时门控必须 undetermined，不能因为"没测够"就放行', async () => {
    const cases: Array<{ label: string; correct: number; total: number; expect: string }> = [
      { label: '零题', correct: 0, total: 0, expect: 'undetermined' },
      { label: '题量差一题', correct: 7, total: 7, expect: 'undetermined' },
      { label: '题量刚好够但全对', correct: 8, total: 8, expect: 'passed' },
      { label: '题量够但差一题', correct: 6, total: 8, expect: 'failed' },
      { label: '全是错的', correct: 0, total: 8, expect: 'failed' },
      { label: '全对', correct: 8, total: 8, expect: 'passed' },
    ];

    const mismatches: string[] = [];
    const observed: string[] = [];
    for (const testCase of cases) {
      const verdict = evaluateExitGate(testCase.correct, testCase.total, GATE_RULES.exit);
      observed.push(`${testCase.label}→${verdict.verdict}`);
      if (verdict.verdict !== testCase.expect) {
        mismatches.push(`${testCase.label}：期望 ${testCase.expect}，实际 ${verdict.verdict}（${verdict.message}）`);
      }
      /* 额外的硬约束：verdict!=='passed' 时 passed 字段必须 false。
         见过太多实现把 verdict 和 passed 分开维护，最后两个字段打架。 */
      if (verdict.verdict !== 'passed' && verdict.passed !== false) {
        mismatches.push(`${testCase.label}：verdict=${verdict.verdict} 但 passed=${verdict.passed}（自相矛盾）`);
      }
    }

    return {
      status: mismatches.length === 0 ? 'passed' : 'failed',
      evidence:
        mismatches.length === 0
          ? `${cases.length} 个边界用例全部符合：${observed.join('、')}`
          : mismatches.join('；'),
      metrics: { cases: cases.length, mismatches: mismatches.length },
    };
  });
}

/**
 * 题量不够时必须能与"答得不好"区分开：前者是"再考几题"，后者是"回去学"。
 * 如果两者都给同一个 reason，界面就没法提示下一步该做什么。
 */
export async function checkGateDistinguishesReasons(): Promise<CheckResult> {
  return run('B2.gate-reason-distinguishable', '"题量不足"与"答对率不足"必须给出不同的 reason 与 actionable 提示', async () => {
    /* 注意：题量不足必须让 total < itemCount(8)。用 (3, 8) 构造不出来 ——
       那已经够 8 题，只是答对少，走的是 below_threshold。 */
    const insufficient = evaluateExitGate(3, 5, GATE_RULES.exit); // total 5 < 8
    const belowThreshold = evaluateExitGate(1, 8, GATE_RULES.exit); // total 够，对得少
    const noGate = evaluateExitGate(8, 8, { mode: 'none', itemCount: 0, passCount: 0 });

    const problems: string[] = [];
    if (insufficient.reason === belowThreshold.reason) {
      problems.push(`两种失败共用 reason="${insufficient.reason}"，界面无法区分"再考几题"和"回去学"`);
    }
    if (!insufficient.message || !belowThreshold.message) {
      problems.push('失败时 message 为空，用户拿不到任何提示');
    }
    if (insufficient.shortfall <= 0) {
      problems.push(`题量不足时 shortfall=${insufficient.shortfall}，应为正数（还差几题）`);
    }
    if (noGate.reason !== 'no_gate_configured') {
      problems.push(`未配置门控时 reason=${noGate.reason}，应为 no_gate_configured`);
    }

    return {
      status: problems.length === 0 ? 'passed' : 'failed',
      evidence:
        problems.length === 0
          ? `题量不足→reason=${insufficient.reason} shortfall=${insufficient.shortfall}「${insufficient.message}」；答对率不足→reason=${belowThreshold.reason} shortfall=${belowThreshold.shortfall}「${belowThreshold.message}」`
          : problems.join('；'),
      metrics: {
        insufficientShortfall: insufficient.shortfall,
        belowThresholdShortfall: belowThreshold.shortfall,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────
// 不变量 C：同一 chunk 在两个知识点下门控结论可以相反
// ─────────────────────────────────────────────────────────────

/**
 * 这条最容易实现成全放行或全拦截：只要门控逻辑写成"按知识点配置一个总开关"，
 * 同一个 chunk 在所有知识点下就是同一个结论，那它就没在"按知识点"工作。
 *
 * 判据：构造一个 chunk 集合，chunk X 是知识点 α 的答案块、不是 β 的；在
 * background 档下，α 必须拦掉 X，β 必须放行 X —— 结论相反才算通过。
 */
export async function checkGateIsPerKnowledgePoint(): Promise<CheckResult> {
  return run('C1.gate-per-knowledge-point', '同一个 chunk 在不同知识点下门控结论可以相反（不是全局开关）', async () => {
    const sharedChunk = { id: 'c-shared', kind: 'text' as const, text: '本知识点的最终答案是 662 keV。' };
    const onlyInAlpha = { id: 'c-alpha-only', kind: 'text' as const, text: 'α 特有的推导步骤。' };
    const chunks = [sharedChunk, onlyInAlpha];

    /* α 把这个 chunk 标成答案块；β 没标。两个知识点当前掌握度都低 → 都走 background。 */
    const alpha = filterChunks(chunks, new Set(['c-shared']), gateTierFor(0.1));
    const beta = filterChunks(chunks, new Set(), gateTierFor(0.1));

    const alphaIds = alpha.allowed.map((chunk) => chunk.id);
    const betaIds = beta.allowed.map((chunk) => chunk.id);
    const alphaBlocked = alpha.excluded.map((entry) => entry.id);
    const betaBlocked = beta.excluded.map((entry) => entry.id);

    const problems: string[] = [];
    if (!alphaBlocked.includes('c-shared')) {
      problems.push('α 的答案块没有被拦截 —— 门控没生效');
    }
    if (betaBlocked.includes('c-shared')) {
      problems.push('β 也拦掉了 c-shared —— 门控退化成了全局开关，不是按知识点');
    }
    if (!alphaIds.includes('c-alpha-only') || !betaIds.includes('c-alpha-only')) {
      problems.push('非答案块被误拦，门控过于激进');
    }
    /* 掌握度到 full 档时必须全放行，否则就是"学会了也不给看答案"。 */
    const mastered = filterChunks(chunks, new Set(['c-shared']), gateTierFor(0.95));
    if (mastered.allowed.length !== chunks.length) {
      problems.push(`掌握度 0.95 时仍拦截了 ${chunks.length - mastered.allowed.length} 个 chunk，学完不给看答案`);
    }

    return {
      status: problems.length === 0 ? 'passed' : 'failed',
      evidence:
        problems.length === 0
          ? `同一 chunk「c-shared」在 α 下被拦（${alphaBlocked.length} 条被拦，理由：${alpha.excluded[0]?.reason ?? 'n/a'}），在 β 下放行（${betaBlocked.length} 条被拦）；掌握度 0.95 时全放行 ${mastered.allowed.length} 条`
          : problems.join('；'),
      metrics: {
        alphaBlocked: alphaBlocked.length,
        betaBlocked: betaBlocked.length,
        chunksTotal: chunks.length,
      },
    };
  });
}

/**
 * 数据层版本：真实语料里是否真的存在被多个知识点共享的答案块。
 *
 * 如果不存在，这条断言**跳过并说明原因**，而不是判通过 —— 共享块为 0 意味着
 * "跨知识点结论相反"这件事在当前数据上根本构造不出来，门控即使实现错了也测不出。
 * 这本身是个需要报告的发现（内容管线把 chunk 按知识点切得太碎）。
 */
export async function checkSharedAnswerChunksExist(client: ApiClient): Promise<CheckResult> {
  return run('C2.real-corpus-has-shared-answer-chunks', '真实语料中存在被多个知识点共享的答案块（不变量 C 的数据前提）', async () => {
    const { items } = await fetchAllPages<NodeState>(client, '/nodes', 100, extractNodeList);
    const sampleSize = Math.min(40, items.length);
    const sample = items.slice(0, sampleSize);

    /** chunkId → 该 chunk 出现在哪些知识点的 sources 里。 */
    const chunkOwners = new Map<string, Set<string>>();
    const answerChunks = new Set<string>();
    let chunkObservations = 0;

    for (const node of sample) {
      const response = await client.get(`/nodes/${encodeURIComponent(node.microKpId)}/sources`);
      if (response.status !== 200) continue;
      const body = response.body as { chunks?: Array<{ chunkId: string; isAnswer: boolean }> };
      for (const chunk of body.chunks ?? []) {
        chunkObservations += 1;
        if (chunk.isAnswer) answerChunks.add(chunk.chunkId);
        const owners = chunkOwners.get(chunk.chunkId) ?? new Set<string>();
        owners.add(node.microKpId);
        chunkOwners.set(chunk.chunkId, owners);
      }
    }

    const shared = [...chunkOwners.entries()].filter(([, owners]) => owners.size > 1);
    const sharedAnswer = shared.filter(([chunkId]) => answerChunks.has(chunkId));

    if (sharedAnswer.length === 0) {
      return {
        status: 'skipped',
        skippedReason:
          `扫了 ${sampleSize} 个知识点、${chunkObservations} 次 chunk 引用：共享 chunk ${shared.length} 个，其中答案块 ${sharedAnswer.length} 个。` +
          '没有共享答案块时，"同一 chunk 在两个知识点下结论相反"在真实数据上无法构造 —— ' +
          '这条不变量目前只能由纯函数断言（C1）保证；等票 09 的检索接口落地后应改为对接口断言。',
        evidence: `共享 chunk ${shared.length} / 观测 ${chunkObservations}，共享答案块 ${sharedAnswer.length}`,
        metrics: {
          nodesSampled: sampleSize,
          chunkObservations,
          sharedChunks: shared.length,
          sharedAnswerChunks: sharedAnswer.length,
        },
      };
    }

    return {
      status: 'passed',
      evidence: `共享 chunk ${shared.length} 个，其中答案是 ${sharedAnswer.length} 个（如 ${sharedAnswer[0]?.[0]}）`,
      metrics: {
        nodesSampled: sampleSize,
        chunkObservations,
        sharedChunks: shared.length,
        sharedAnswerChunks: sharedAnswer.length,
      },
    };
  });
}

// ─────────────────────────────────────────────────────────────
// 门控档位本身：成绩与档位的映射必须单调，且"没数据"不能算高分
// ─────────────────────────────────────────────────────────────

/**
 * `gateTierFor(null)` 必须是 background（最低档）。如果实现成"没数据 = 全放行"，
 * 新用户第一眼就能看到所有答案 —— 这是检索门控最典型的塌房方式。
 */
export async function checkGateTierMonotonic(): Promise<CheckResult> {
  return run('B3.gate-tier-monotonic', '门控档位随掌握度单调上升，未知掌握度取最低档', async () => {
    const tierOf = (value: number | null): string => gateTierFor(value);
    const unknown = tierOf(null);
    const zero = tierOf(0);
    const mid = tierOf(0.5);
    const high = tierOf(0.8);
    const full = tierOf(1);

    const problems: string[] = [];
    if (unknown !== 'background') {
      problems.push(`未知掌握度(null) 得到 ${unknown}，应为 background（没数据不能当全放行）`);
    }
    if (!(zero === 'background' || zero === 'scaffold')) {
      problems.push(`掌握度 0 得到 ${zero}，过于宽松`);
    }
    if (mid !== 'scaffold') {
      problems.push(`掌握度 0.5 得到 ${mid}，应为 scaffold`);
    }
    if (high !== 'full' || full !== 'full') {
      problems.push(`掌握度 0.8/1.0 得到 ${high}/${full}，应为 full`);
    }

    return {
      status: problems.length === 0 ? 'passed' : 'failed',
      evidence:
        problems.length === 0
          ? `null→${unknown}, 0→${zero}, 0.5→${mid}, 0.8→${high}, 1→${full}`
          : problems.join('；'),
      metrics: { checks: 5 },
    };
  });
}

// ─────────────────────────────────────────────────────────────
// 契约形状：接口字段名与类型不能悄悄改
// ─────────────────────────────────────────────────────────────

/**
 * 第一层顺手验一下契约：这些字段名前端直接在用（`percent`、`microKpId`、
 * `state`、`nextCursor`）。改名的后果是前端静默显示空白，而不是编译错误 ——
 * 因为类型是生成的、运行时是 JSON。
 */
export async function checkContractShape(client: ApiClient): Promise<CheckResult> {
  return run('D1.contract-shape', '/nodes 与 /nodes/{id} 的关键字段名与类型未变（前端按名取值）', async () => {
    const listResponse = await client.get('/nodes?limit=3');
    const problems: string[] = [];

    if (listResponse.status !== 200) {
      problems.push(`/nodes?limit=3 返回 ${listResponse.status}`);
    } else {
      const body = listResponse.body as NodeListBody;
      if (!Array.isArray(body.items)) problems.push('/nodes 缺少 items 数组');
      if (!('nextCursor' in body)) problems.push('/nodes 缺少 nextCursor 字段');
      for (const node of body.items ?? []) {
        if (typeof node.microKpId !== 'string') problems.push(`microKpId 不是字符串：${JSON.stringify(node.microKpId)}`);
        if (typeof node.name !== 'string') problems.push(`name 不是字符串`);
        if (typeof node.state !== 'string') problems.push(`state 不是字符串`);
        if (typeof node.depth !== 'number') problems.push(`depth 不是数字`);
        if (node.percent !== null && typeof node.percent !== 'number') {
          problems.push(`percent 既不是 null 也不是数字：${JSON.stringify(node.percent)}`);
        }
        if (typeof node.percent === 'number' && (node.percent < 0 || node.percent > 1)) {
          problems.push(`percent 越界 [0,1]：${node.percent}`);
        }
        break; /* 只验第一条，字段名一致就够了 */
      }
    }

    /* 错误响应形状：前端 fetcher 依赖 { code, message } 两字段。 */
    const notFound = await client.get('/nodes/__eval_probe_does_not_exist__');
    if (notFound.status !== 404) {
      problems.push(`未知知识点应返回 404，实际 ${notFound.status}`);
    } else {
      const errorBody = notFound.body as { code?: string; message?: string };
      if (errorBody.code !== 'NOT_FOUND') problems.push(`404 的 code 是 "${errorBody.code}"，应为 NOT_FOUND`);
      if (typeof errorBody.message !== 'string' || errorBody.message.length === 0) {
        problems.push('404 缺少 message');
      }
    }

    return {
      status: problems.length === 0 ? 'passed' : 'failed',
      evidence: problems.length === 0 ? '字段名与类型、404 错误体形状均符合契约' : problems.join('；'),
      metrics: { checks: 3 },
    };
  });
}

/** 参数校验：limit 越界必须 400 且带字段级 details，不能 500 也不能静默截断。 */
export async function checkValidationErrors(client: ApiClient): Promise<CheckResult> {
  return run('D2.validation-errors', 'limit 越界返回 400 + 字段级 details，不是 500 也不是静默截断', async () => {
    const problems: string[] = [];
    const observed: string[] = [];

    for (const [limit, label] of [
      ['0', 'limit=0'],
      ['201', 'limit=201'],
      ['abc', 'limit=abc'],
    ] as const) {
      const response = await client.get(`/nodes?limit=${limit}`);
      observed.push(`${label}→${response.status}`);
      if (response.status !== 400) {
        problems.push(`${label} 返回 ${response.status}，应为 400`);
        continue;
      }
      const body = response.body as { code?: string; details?: unknown };
      if (body.code !== 'VALIDATION_FAILED') {
        problems.push(`${label} 的 code 是 "${body.code}"，应为 VALIDATION_FAILED`);
      }
      if (!body.details) {
        problems.push(`${label} 缺少 details（前端要把字段级错误指到具体输入框）`);
      }
    }

    return {
      status: problems.length === 0 ? 'passed' : 'failed',
      evidence: problems.length === 0 ? `三种越界参数均 400 + VALIDATION_FAILED + details：${observed.join('、')}` : problems.join('；'),
      metrics: { cases: 3 },
    };
  });
}

/**
 * 分页完整性：翻完后条数应等于列表接口声称的总数，且无重复、严格升序。
 * 少一条就意味着有知识点永远不出现在看板上。
 */
export async function checkPaginationIntegrity(client: ApiClient): Promise<CheckResult> {
  return run('D3.pagination-integrity', '分页翻完后无重复、按 id 严格升序、条数与单页 limit=200 一致', async () => {
    const paged = await fetchAllPages<NodeState>(client, '/nodes', 50, extractNodeList);
    const single = await client.get('/nodes?limit=200');
    const singleBody = single.body as NodeListBody;

    const ids = paged.items.map((node) => node.microKpId);
    const unique = new Set(ids);
    const problems: string[] = [];

    if (unique.size !== ids.length) {
      problems.push(`翻页结果有 ${ids.length - unique.size} 条重复`);
    }
    for (let i = 1; i < ids.length; i += 1) {
      const previous = ids[i - 1];
      const current = ids[i];
      if (previous === undefined || current === undefined) continue;
      if (previous >= current) {
        problems.push(`顺序错误：${previous} 之后出现 ${current}`);
        break;
      }
    }
    const singleCount = singleBody.items?.length ?? 0;
    if (single.status === 200 && singleCount < 200 && paged.items.length !== singleCount) {
      problems.push(`翻页共 ${paged.items.length} 条，但单页 limit=200 返回 ${singleCount} 条`);
    }

    return {
      status: problems.length === 0 ? 'passed' : 'failed',
      evidence:
        problems.length === 0
          ? `${paged.pages} 页共 ${paged.items.length} 条，无重复、严格升序，与单页拉取条数一致`
          : problems.join('；'),
      metrics: { pages: paged.pages, items: paged.items.length, unique: unique.size },
    };
  });
}
