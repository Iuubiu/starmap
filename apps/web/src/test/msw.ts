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

  /**
   * 知识点解锁状态（票 06）。
   *
   * 默认「已解锁」：绝大多数页面用例不关心锁，只关心掌握度与关卡列表。要测
   * 「为什么还没解锁」的用例用 `server.use(...)` 覆盖这一条，不要改默认值 ——
   * 默认改成未解锁会让所有详情页用例同时冒出一张障碍卡，断言全乱。
   */
  http.get('*/api/v1/nodes/:id/unlock', ({ params }) => {
    if (params.id === 'kp-missing') {
      return HttpResponse.json({ code: 'NOT_FOUND', message: '知识点不存在' }, { status: 404 });
    }
    return HttpResponse.json({
      microKpId: params.id,
      unlocked: true,
      blockers: [],
    });
  }),

  /**
   * 复验队列（票 07）。
   *
   * 默认**空队列**：绝大多数页面用例不关心复验，而空队列是正常状态（没到期的
   * 日子本来就没有复验）。要测复验页的队列渲染请用 `server.use(...)` 覆盖。
   */
  http.get('*/api/v1/review/queue', () => HttpResponse.json({ due: [] })),

  /** 一轮复验的题单/结果（票 07）。默认 404，让「没有这一轮」有明确表现。 */
  http.get('*/api/v1/review/rounds/:roundId', ({ params }) => {
    if (params.roundId === 'round-1') {
      return HttpResponse.json({
        round: {
          roundId: 'round-1',
          itemCount: 1,
          createdAt: '2026-10-21T00:00:00.000Z',
          completedAt: null,
          verdict: null,
          correctCount: null,
        },
        items: [
          {
            ordinal: 1,
            itemId: 'i-review-1',
            microKpId: 'kp-bool',
            microKpName: '布尔代数基本运算',
            variantGroup: 'vg-absorb',
            stem: '吸收律：A + AB 等于什么？',
            options: ['A', 'B', 'AB', 'A+B'],
            explainCorrect: '吸收律把 AB 一项吸收掉了，所以只剩 A。',
            explainWrong: '再看一遍吸收律：A + AB = A(1+B) = A。',
            misconceptionTags: ['把或运算当成算术加法'],
          },
        ],
        outcomes: [],
        mastery: [],
      });
    }
    return HttpResponse.json({ code: 'NOT_FOUND', message: '复验会话不存在' }, { status: 404 });
  }),

  http.post('*/api/v1/review/rounds', () =>
    HttpResponse.json(
      { code: 'CONFLICT', message: '这些知识点目前都没有可复验的题目' },
      { status: 409 },
    ),
  ),

  http.post('*/api/v1/review/rounds/:roundId/complete', async ({ params }) =>
    HttpResponse.json({
      round: {
        roundId: params.roundId,
        itemCount: 0,
        createdAt: '2026-10-21T00:00:00.000Z',
        completedAt: '2026-10-21T00:05:00.000Z',
        verdict: 'passed',
        correctCount: 0,
      },
      outcomes: [],
      mastery: [],
    }),
  ),

  /**
   * 知识图谱（票 03 / 票 13）。
   *
   * 三个节点覆盖三种不同的读数路径，缺一个就测不到对应的显示规则：
   * - `kp-bool`：有证据，percent 有值（在学 / 显示百分比）；
   * - `kp-kmap`：证据不足，percent 是 **null**（必须显示「证据不足」，不是 0%）；
   * - `kp-review`：到了复验期（`reviewDueAt` 在过去），前端纯函数应判成「需复验」。
   *
   * `recommendedIds` 与下面的 `/recommendations` 首条一致：两处指向同一批，
   * 正是票 13 验收第 5 条要的形状；若谁改了其中一边，地图徽标会立刻对不上。
   */
  http.get('*/api/v1/graph', () =>
    HttpResponse.json({
      nodes: [
        {
          microKpId: 'kp-bool',
          name: '布尔代数基本运算',
          state: 'familiar',
          percent: 0.66,
          depth: 1,
          moduleId: 'm-digital',
          moduleName: '数字逻辑',
          moduleOrdinal: 1,
          ordinal: 1,
          reviewDueAt: null,
        },
        {
          microKpId: 'kp-kmap',
          name: '卡诺图化简',
          state: 'unseen',
          percent: null,
          depth: 1,
          moduleId: 'm-digital',
          moduleName: '数字逻辑',
          moduleOrdinal: 1,
          ordinal: 2,
          reviewDueAt: null,
        },
        {
          microKpId: 'kp-review',
          name: '组合逻辑竞争冒险',
          state: 'proficient',
          percent: 0.82,
          depth: 1,
          moduleId: 'm-digital',
          moduleName: '数字逻辑',
          moduleOrdinal: 1,
          ordinal: 3,
          // 已经过期：`toDisplayStatus(node, new Date())` 会把它判成 review
          reviewDueAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      edges: [
        { from: 'kp-bool', to: 'kp-kmap', kind: 'prereq' },
        { from: 'kp-kmap', to: 'kp-review', kind: 'prereq' },
      ],
      recommendedIds: ['kp-bool'],
    }),
  ),

  /**
   * 今日推荐 + 摘要（票 13）。
   *
   * 默认给 `blocked_by_prereq` —— 验收第 2 条点名的就是这一种（「你在 A 卡住，
   * A 依赖 B，B 你只有 32%」）。facts 里的数字是**原值**（0.32），不是 "32%"：
   * 拼中文是前端 `board/reason.ts` 的事。
   *
   * 其它 kind 的渲染由 `board/reason.test.ts` 逐条覆盖，不必在这里堆五份数据。
   */
  http.get('*/api/v1/recommendations', () =>
    HttpResponse.json({
      generatedAt: '2026-10-20T04:00:00.000Z',
      recommendations: [
        {
          microKpId: 'kp-bool',
          name: '布尔代数基本运算',
          moduleName: '数字逻辑',
          reason: {
            kind: 'blocked_by_prereq',
            facts: [
              { type: 'current', value: 0.66 },
              { type: 'attempts', value: 12 },
              { type: 'unblocks', microKpId: 'kp-kmap', name: '卡诺图化简', current: 0.32 },
            ],
          },
        },
      ],
      summary: {
        available: true,
        answered: 7,
        knowledgePoints: 2,
        newlyMastered: 1,
      },
    }),
  ),

  /**
   * 改道（票 13 验收第 3 条）。
   *
   * 这里只回 `{ok:true}` 并且**不改上面的推荐列表**：真实服务端的「记住」表现
   * 为下次查询里那条不再出现（由 api 集成测试断言，那里有库）。组件测试要验证
   * 的是「请求发对了、成功后界面收起了选择器」，把列表也一起模拟会在测试里
   * 重建一遍服务端行为，反而测不出前端有没有真的失效缓存。
   */
  http.post('*/api/v1/recommendations/redirect', async ({ request }) => {
    const body = (await request.json()) as { recommended?: string; chosen?: string };
    if (!body.recommended || !body.chosen) {
      return HttpResponse.json(
        { code: 'VALIDATION_FAILED', message: '请求体不合法' },
        { status: 400 },
      );
    }
    return HttpResponse.json({ ok: true });
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
  /**
   * 票 12：三档渲染参数。四个端点全只读，默认全是 P1 档。
   *
   * 默认给 P1 而不是「没定级」的 fallback：P1 是**参数完整**的一档，所有
   * 消费方都能从它拿到六维参数与首轮计划。给 fallback 虽然也合法，但会让
   * 「测试里看到的档位」与「真实新用户看到的」不一致 —— 而 fallback 的语义
   * 是「还没定级」，那是票 11 的场景。
   *
   * 需要 P2/P3 的用例自己 `server.use()` 覆盖（同 skills 桩的约定）。
   */
  http.get('*/api/v1/tier', () =>
    HttpResponse.json({
      tier: 'P1',
      source: 'placement',
      params: {
        tier: 'P1',
        firstRoundShape: 'worked_example',
        ladder: { start: 1, cap: 3 },
        sessionNewKpLimit: 2,
        feedbackTiming: 'step_immediate',
        attemptsPerItem: 2,
        masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
      },
      label: '完整样例',
      description: '先完整看一遍样例，再自己动手。',
    }),
  ),

  http.get('*/api/v1/tier/levels/:levelId/plan', ({ params }) =>
    HttpResponse.json({
      levelId: params.levelId,
      microKpId: 'kp-bool',
      tier: 'P1',
      source: 'placement',
      params: {
        tier: 'P1',
        firstRoundShape: 'worked_example',
        ladder: { start: 1, cap: 3 },
        sessionNewKpLimit: 2,
        feedbackTiming: 'step_immediate',
        attemptsPerItem: 2,
        masteryRule: { consecutiveCorrect: 2, requiresTransferItem: true },
      },
      firstRound: { shape: 'worked_example', startStepIndex: 0, cardMode: 'all', fadedCardId: null },
      masteryProgress: {
        consecutiveCorrect: 0,
        hasTransferItem: false,
        satisfied: false,
        missing: ['还差连续答对 2 次', '还没做过迁移题'],
      },
    }),
  ),

  http.get('*/api/v1/tier/changes', () => HttpResponse.json({ items: [] })),

  http.get('*/api/v1/tier/session-plan', () =>
    HttpResponse.json({
      tier: 'P1',
      source: 'placement',
      limit: 2,
      items: [
        { microKpId: 'kp-bool', name: '布尔代数基本运算', hasLevel: true },
        { microKpId: 'kp-kmap', name: '卡诺图化简', hasLevel: false },
      ],
      deferred: 0,
    }),
  ),
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
