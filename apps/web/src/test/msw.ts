import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * MSW 打桩层：让组件测试跑在**真实的 fetch** 上。
 *
 * 与「mock 掉 query hook」的分工：
 * - mock query hook → 测渲染决策（NodeDetailPage.test.tsx 用这个）
 * - MSW → 测「请求发出去了、形状对了、错误被正确翻译成 UI 状态」
 *
 * 两者都要有。只 mock hook 会漏掉「URL 拼错」「错误码没映射」这类真实故障。
 */
export const handlers = [
  http.get('*/api/v1/health', () =>
    HttpResponse.json({
      status: 'ok',
      dbNow: '2026-10-20T04:00:00.000Z',
      version: '0.1.0',
    }),
  ),

  http.get('*/api/v1/nodes', () =>
    HttpResponse.json({
      items: [
        { microKpId: 'kp-bool', name: '布尔代数基本运算', state: 'familiar', percent: 0.66, depth: 1 },
        { microKpId: 'kp-kmap', name: '卡诺图化简', state: 'unseen', percent: null, depth: 1 },
      ],
      nextCursor: null,
    }),
  ),

  http.get('*/api/v1/content/stats', () =>
    HttpResponse.json({
      sources: [
        {
          id: 'digital-kanghua-5e',
          title: '电子技术基础·数字部分（康华光 第5版）',
          kind: 'book',
          chunkCount: 3032,
          answerChunkCount: 481,
          pageFrom: 2,
          pageTo: 536,
        },
      ],
      knowledgePoints: { total: 215, leaves: 165 },
      chunks: { total: 3032, byKind: { text: 2178, formula: 795, table: 59 } },
      answers: 481,
      edges: { total: 52, withEvidence: 52 },
    }),
  ),

  http.get('*/api/v1/nodes/:id/sources', ({ params }) => {
    if (params.id === 'kp-missing') {
      return HttpResponse.json({ code: 'NOT_FOUND', message: '知识点不存在' }, { status: 404 });
    }
    return HttpResponse.json({
      microKpId: params.id,
      name: '布尔代数基本运算',
      pages: [12, 13],
      chunks: [
        {
          chunkId: 'ck-1',
          kind: 'text',
          page: 12,
          isAnswer: false,
          excerpt: '逻辑代数的基本运算有三种：与、或、非。',
        },
        {
          chunkId: 'ck-2',
          kind: 'formula',
          page: 13,
          isAnswer: true,
          excerpt: 'A + A·B = A',
        },
      ],
    });
  }),

  http.get('*/api/v1/nodes/:id', ({ params }) => {
    if (params.id === 'kp-missing') {
      return HttpResponse.json({ code: 'NOT_FOUND', message: '知识点不存在' }, { status: 404 });
    }
    return HttpResponse.json({
      node: {
        microKpId: params.id,
        name: '布尔代数基本运算',
        state: 'familiar',
        percent: 0.66,
        depth: 1,
      },
      levels: [
        {
          levelId: 'lv-1',
          microKpId: params.id,
          title: '布尔代数的三条基本律',
          itemCount: 1,
          kind: 'teach',
        },
      ],
      reasons: ['已建立基础，还没有稳定，适合做变式练习。'],
    });
  }),

  /**
   * 掌握度（票 05）：双字段，`achieved` 不衰减、`current` 会衰减。
   *
   * 详情页的掌握度卡片读这里，**不读** `/nodes/:id` 里的 `percent` —— 那份是
   * 上一次作答那一刻写下的快照，会随时间变旧。默认样本让 `current` 与
   * `/nodes/:id` 的 `percent` 都是 0.66，这样「两处一致」不会掩盖读数源的错误；
   * 要验证「以 mastery 为准」的用例请用 `server.use(...)` 把两边改成不一致。
   */
  http.get('*/api/v1/mastery/:microKpId', ({ params }) => {
    if (params.microKpId === 'kp-missing') {
      return HttpResponse.json({ code: 'NOT_FOUND', message: '知识点不存在' }, { status: 404 });
    }
    return HttpResponse.json({
      microKpId: params.microKpId,
      name: '布尔代数基本运算',
      isLeaf: true,
      state: 'familiar',
      achieved: 0.72,
      current: 0.66,
      attemptCount: 12,
      variantCount: 3,
      evidenceSufficient: true,
      halfLifeDays: 30,
      lastEvidenceAt: '2026-10-19T00:00:00.000Z',
      aggregatedLeafCount: 0,
    });
  }),

  // -------------------------------------------------------------------------
  // 票 08：结构化回合
  // -------------------------------------------------------------------------

  /**
   * 提交一轮。
   *
   * 默认给一张**关卡卡**（最普通的一种）。要测降级、追问等分支时，用
   * `server.use(...)` 在单个测试里覆盖这条 —— 不要在这里堆一堆按输入分叉
   * 的 if：那会让「默认行为」本身变成需要读代码才知道的东西。
   */
  http.post('*/api/v1/agent/turns', async ({ request }) => {
    const body = (await request.json()) as { utterance?: string };
    return HttpResponse.json(makeTurn({ utterance: body.utterance ?? '' }));
  }),

  http.get('*/api/v1/agent/turns/:turnId/evidence', ({ params }) =>
    HttpResponse.json({
      turnId: params.turnId,
      microKpId: 'kp-bool',
      gateTier: 'scaffold',
      items: [
        {
          chunkId: 'ck-1',
          sourceId: 'digital-kanghua-5e',
          sourceTitle: '电子技术基础·数字部分（康华光 第5版）',
          page: 12,
          kind: 'text',
          snippet: '逻辑代数的基本运算有三种：与、或、非。',
          score: 12.345,
          isAnswerChunk: false,
          allowed: true,
          tier: 'scaffold',
          exclusionReason: null,
        },
        {
          chunkId: 'ck-2',
          sourceId: 'digital-kanghua-5e',
          sourceTitle: '电子技术基础·数字部分（康华光 第5版）',
          page: 13,
          kind: 'formula',
          snippet: 'A + A·B = A',
          score: 9.1,
          isAnswerChunk: true,
          allowed: false,
          tier: 'scaffold',
          exclusionReason: '该切片是当前知识点的答案块，会直接给出结论',
        },
      ],
    }),
  ),

  http.get('*/api/v1/agent/turns/:turnId', ({ params }) =>
    HttpResponse.json(makeTurn({ turnId: params.turnId as string, utterance: '回看的那一句' })),
  ),

  http.get('*/api/v1/agent/turns', ({ request }) => {
    const sessionId = new URL(request.url).searchParams.get('sessionId') ?? '';
    return HttpResponse.json({
      sessionId,
      items: [
        {
          turnId: 'turn-1',
          sessionId,
          utterance: '布尔代数的吸收律怎么理解',
          artifactKind: 'level_card',
          cardTitle: '关卡：布尔代数的三条基本律',
          degraded: false,
          createdAt: '2026-10-20T04:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
  }),

  // -------------------------------------------------------------------------
  // 票 09：检索调试器
  // -------------------------------------------------------------------------

  http.get('*/api/v1/agent/retrieval/debug', ({ request }) => {
    const url = new URL(request.url);
    return HttpResponse.json({
      query: url.searchParams.get('query') ?? '',
      microKpId: url.searchParams.get('microKpId') ?? 'kp-bool',
      current: 0.66,
      gateTier: 'scaffold',
      totalMatched: 2,
      answerChunkCount: 1,
      excludedCount: 1,
      hits: [
        {
          chunkId: 'ck-1',
          microKpId: 'kp-bool',
          score: 12.345,
          snippet: '逻辑代数的基本运算有三种：与、或、非。',
          kind: 'text',
          page: 12,
          sourceTitle: '电子技术基础·数字部分（康华光 第5版）',
          isAnswerChunk: false,
          allowed: true,
          tier: 'scaffold',
          exclusionReason: null,
        },
        {
          chunkId: 'ck-2',
          microKpId: 'kp-bool',
          score: 9.1,
          snippet: 'A + A·B = A',
          kind: 'formula',
          page: 13,
          sourceTitle: '电子技术基础·数字部分（康华光 第5版）',
          isAnswerChunk: true,
          allowed: false,
          tier: 'scaffold',
          exclusionReason: '该切片是当前知识点的答案块，会直接给出结论',
        },
      ],
    });
  }),

  http.get('*/api/v1/agent/retrieval/bands', ({ request }) => {
    const url = new URL(request.url);
    return HttpResponse.json({
      query: url.searchParams.get('query') ?? '',
      microKpId: url.searchParams.get('microKpId') ?? 'kp-bool',
      answerChunkIds: ['ck-2'],
      bands: [
        { current: 0.2, gateTier: 'background', allowedIds: ['ck-1'], excludedIds: ['ck-2'] },
        { current: 0.55, gateTier: 'scaffold', allowedIds: ['ck-1'], excludedIds: ['ck-2'] },
        { current: 0.85, gateTier: 'full', allowedIds: ['ck-1'], excludedIds: ['ck-2'] },
      ],
    });
  }),

  // -------------------------------------------------------------------------
  // 票 10：苏格拉底追问
  // -------------------------------------------------------------------------

  http.post('*/api/v1/agent/probes', async ({ request }) => {
    const body = (await request.json()) as { microKpId?: string; tier?: string };
    return HttpResponse.json({
      probeId: 'pr-test',
      microKpId: body.microKpId ?? 'kp-bool',
      tier: body.tier ?? 'P1',
      ladder: emptyLadder(1, 3),
      turns: 0,
      askedQuestions: [],
    });
  }),

  http.post('*/api/v1/agent/probes/:probeId/replies', ({ params }) =>
    HttpResponse.json({
      probeId: params.probeId,
      microKpId: 'kp-bool',
      tier: 'P1',
      replyKind: 'partial',
      action: 'hint',
      actionReason: '部分正确，给下一级提示',
      question: '这条定律里，哪个量是多余的？',
      ladder: { ...emptyLadder(2, 3), maxLevelUsed: 2 },
      judge: { passed: true, reasons: [], questionCount: 1 },
      fallbackApplied: false,
      createdAt: '2026-10-20T04:00:00.000Z',
    }),
  ),

  http.get('*/api/v1/agent/probes/metrics', () =>
    HttpResponse.json({
      turns: 4,
      violations: 1,
      violationRate: 0.25,
      reasonCounts: { leaks_formula: 1 },
    }),
  ),

  http.get('*/api/v1/agent/probes/:probeId', ({ params }) =>
    HttpResponse.json({
      probeId: params.probeId,
      microKpId: 'kp-bool',
      tier: 'P1',
      ladder: emptyLadder(1, 3),
      turns: 0,
      askedQuestions: [],
    }),
  ),

  // -------------------------------------------------------------------------
  // 票 15：技能库
  // -------------------------------------------------------------------------

  http.get('*/api/v1/agent/skills/system-preview', () =>
    HttpResponse.json({
      systemMessage: '基础提示词\n\n### socratic-tutor（v1.0.0）\n用苏格拉底式追问。',
      includedSkills: ['socratic-tutor'],
      excludedSkills: ['question-author'],
    }),
  ),

  http.get('*/api/v1/agent/skills/:name', ({ params }) =>
    HttpResponse.json({
      skill: {
        name: params.name,
        directoryName: params.name,
        description: '当学习者卡住或直接要答案时，用苏格拉底式追问把他往前推一步。',
        version: '1.0.0',
        triggerScenarios: ['学生说不会', '学生直接要答案'],
        enabled: true,
        referenceCount: 1,
        instructions: '一轮只问一个问题。不要给最终数值。',
        references: [
          { name: 'phrasing.md', sizeBytes: 2247, preview: '一级：先问这个概念里有哪些量。' },
        ],
        validation: { valid: true, errors: [], warnings: [] },
      },
    }),
  ),

  http.get('*/api/v1/agent/skills', () =>
    HttpResponse.json({
      directory: 'apps/api/src/mastra/skills',
      enabledCount: 1,
      disabledCount: 1,
      items: [
        {
          name: 'socratic-tutor',
          directoryName: 'socratic-tutor',
          description: '当学习者卡住或直接要答案时，用苏格拉底式追问把他往前推一步。',
          version: '1.0.0',
          triggerScenarios: ['学生说不会', '学生直接要答案'],
          enabled: true,
          referenceCount: 1,
        },
        {
          name: 'question-author',
          directoryName: 'question-author',
          description: '为微知识点出题，并校验已有题目是否可用。',
          version: '1.0.0',
          triggerScenarios: ['出题', '校验题目'],
          enabled: false,
          referenceCount: 1,
        },
      ],
    }),
  ),

  http.patch('*/api/v1/agent/skills/:name', async ({ params, request }) => {
    const body = (await request.json()) as { enabled?: boolean };
    return HttpResponse.json({
      skill: {
        name: params.name,
        directoryName: params.name,
        description: '当学习者卡住或直接要答案时，用苏格拉底式追问把他往前推一步。',
        version: '1.0.0',
        triggerScenarios: ['学生说不会'],
        enabled: body.enabled ?? false,
        referenceCount: 1,
        instructions: '一轮只问一个问题。',
        references: [],
        validation: { valid: true, errors: [], warnings: [] },
      },
    });
  }),
];

export const server = setupServer(...handlers);

/** 一个完整的阶梯快照，省得每个 handler 都抄一遍（抄漏字段会让契约校验失焦）。 */
function emptyLadder(level: number, cap: number) {
  return {
    level,
    cap,
    maxLevelUsed: level,
    consecutiveUnknown: 0,
    consecutiveWrong: 0,
    noProgress: 0,
    exited: false,
  };
}

/**
 * 一张关卡卡的完整响应。
 *
 * 单独提成函数是因为「提交」和「回看」两条 handler 返回同一种形状；
 * 抄两遍的话，改契约时只会改到其中一处，另一处悄悄漂移。
 */
function makeTurn(overrides: { turnId?: string; utterance?: string } = {}) {
  return {
    turnId: overrides.turnId ?? 'turn-1',
    sessionId: 'ses-test',
    artifact: {
      kind: 'level_card',
      cardId: overrides.turnId ?? 'turn-1',
      createdAt: '2026-10-20T04:00:00.000Z',
      title: '布尔代数的三条基本律',
      rationale: '你已经有基本概念，可以进关卡做变式练习。',
      levelId: 'lv-bool-1',
      microKpId: 'kp-bool',
      tier: 'P1',
      estimatedMinutes: 15,
      itemCount: 3,
      firstStepKind: 'guide',
    },
    errorCard: null,
    degraded: false,
    retryCount: 0,
    visibleResponse: '我给你准备了一张关卡，先看一遍引导再开始。',
    visibleResponseKind: 'statement',
    languageCheck: { ok: true, offenders: [] },
    actions: [
      { kind: 'retry', label: '再来一张', enabled: true },
      { kind: 'show_evidence', label: '看依据', enabled: true },
    ],
    createdAt: '2026-10-20T04:00:00.000Z',
  };
}
