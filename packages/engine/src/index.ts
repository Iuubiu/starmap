/**
 * @starmap/engine 的公开入口。
 *
 * 为什么要有这个文件：包的 `main` 指向 `./dist/index.js`，但 src 里一直没有
 * `index.ts` —— 于是 `import { evaluateExitGate } from '@starmap/engine'` 在
 * 运行期是 module-not-found，而**只有真跑起来才会发现**（typecheck 看到的是
 * 声明文件路径，apps/api 又恰好还没 import 过它）。
 *
 * 这是一个 barrel：只做 re-export，不放任何逻辑。
 *
 * ── 命名冲突的处理 ──────────────────────────────────────────────
 * `mastery.ts` 和 `probe.ts` 都导出 `initialState`，但签名不同：
 *   mastery.initialState(params?: BktParams): MasteryKernelState
 *   probe.initialState(): ProbeState
 * 两者是不同领域的状态机起点，**不能**在 barrel 里让其中一个冒名顶替。
 * 所以两个都加领域前缀导出，且**不提供**不带前缀的 `initialState` ——
 * 让「我到底在初始化哪个状态机」在每一个调用点都必须写清楚。
 * 包内模块之间继续用相对路径互相引用（它们不经过 barrel），不受影响。
 *
 * 归属：这个文件由 integrator 拥有（共享注册点）。各泳道新增模块后告诉我，
 * 由我加对应的导出行，避免多人同时改同一处。
 */

export * from './gating.js';
export * from './retrieval-gate.js';

/* mastery 的其他导出走 star；initialState 另起别名，见文件头。 */
export * from './mastery.js';
export { initialState as masteryInitialState } from './mastery.js';

/* probe 的导出必须逐条列出：一旦用 star，initialState 就会与上面撞名，
   而 tsc 的报错是「has already exported a member named 'initialState'」，
   信息足够但发生得很晚（构建时）。逐条列出反而把冲突消解在源头。 */
export {
  PROBE_LIMITS,
  classifyReply,
  nextProbe,
  initialState as probeInitialState,
} from './probe.js';
export type { ProbeState, ProbeAction, ProbeTransition, ReplyKind, ReplyIntent } from './probe.js';

/* 这两个模块的导出名与上面全部不冲突（Ladder* / check* / ChineseCheck / ChineseIssue…），
   所以可以走 star。新模块加进来时先确认没有同名导出，再决定用 star 还是逐条列。 */
export * from './text-guard.js';
export * from './probe-ladder.js';

/* probe-judge 同样不撞名（ProbeJudgeReason / ProbeJudgeInput / ProbeJudgeVerdict /
   judgeProbeReply）。它是纯函数、无 IO —— 追问回复的越界判定不调 LLM，
   因为「回复里有没有出现最终数值」是代码能数出来的事实，交给模型判会漂移。 */
export * from './probe-judge.js';

/* recommend 也不撞名（recommend / Recommend* / Reason* / RECOMMEND_DEFAULT_LIMIT /
   FADING_DROP / STUCK_MIN_ATTEMPTS 在这个包里都是首次出现）。
   它是纯函数推荐内核：图谱页与看板必须共享同一个 `recommend()`，否则
   「为什么给我推荐这个」在两个页面上会是两套理由。 */
export * from './recommend.js';

/* placement 同样不撞名（Placement* / SelfAssessment* / ProficiencyTier / RejudgeInput /
   priorFromSelfAssessment / initialPlacementState / tierProbabilities / placementEntropy /
   predictedCorrect / recordPlacementAnswer / posteriorStandardDeviation / placementStop /
   placementResult / selectPlacementItem / shouldRejudge 在这个包里都是首次出现）。
   它是票 11 的初始定级内核：自适应选题 + 停止判据都是纯函数，可以穷举测试；
   放在 engine 而不是 controller 里，是因为「什么时候该停」是教学策略，不是 HTTP 逻辑。 */
export * from './placement.js';

/* review 同样不撞名（REVIEW_* / Review* / initialReviewSchedule / advanceReviewSchedule /
   reviewIntervalDays / isReviewDue / overdueDays / reviewPass* / selectReviewItems /
   interleaveReviewItems 在这个包里都是首次出现；placement.ts 只有 PlacementReviewItem，
   是「定级结果里的逐题复核项」，与这里的复验排期不是一回事）。
   它是票 07 的复验排期内核：排期是一个**存下来的时刻**，不是一个待触发的闹钟 ——
   进程崩了、重启了、部署到三个实例上，「到期没有」用 `<= now` 比一下都得同一个答案，
   不需要谁记得去推进它。所以这个文件里没有 Date.now()，now 是参数。 */
export * from './review.js';

/* tier 不撞名（TierParams / TierMasteryRule / MasteryRuleRecord / MasteryRuleProgress /
   FirstRoundShape / FirstRoundPlan / FirstRoundStepShape / FeedbackTiming / TIER_PARAMS /
   TIER_LABEL / FIRST_ROUND_DESCRIPTION / tierParams / planFirstRound / masteryRuleProgress /
   showsFeedbackImmediately 在这个包里都是首次出现；probe-ladder.ts 的 TIER_LADDER 仍是
   阶梯数值的唯一真源，tier.ts 只是引用它，不重复导出）。
   它是票 12 的六维渲染参数真源：参数要同时驱动界面与策略，放前端后端读不到、放数据库
   每次改数字都要迁移，而且「P2 的阶梯上限是 4」会与 probe-ladder 变成两份。 */
export * from './tier.js';

/* glossary 不撞名（GlossaryEntry / QueryExpansion / ExpandedQuery / expandQuery 在这个包里
   都是首次出现）。它是「中文 query → 英文语料」的术语桥：15 本英文教材入库后英文书占了
   大半个叶节点池，而 BM25 是纯字面匹配 —— 中文 query 对英文正文零命中，学生看到地图上
   有节点、搜出来却是空的。词表来自各书 toc.json 的 name/nameOriginal 副产品
   （content/glossary.json），引擎侧只做最长匹配展开，**不读文件**：读文件是 api 层
   glossary-store 的事，engine 仍然可以是纯函数。 */
export * from './glossary.js';
