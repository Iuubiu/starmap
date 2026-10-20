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
