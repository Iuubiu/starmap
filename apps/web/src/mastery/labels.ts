/**
 * 掌握状态的中文词表 —— **前端唯一一份**。
 *
 * ## 为什么需要这个文件
 *
 * 在它之前，同一套五态在 `apps/web/src` 里有四五份各自维护的映射：
 * `agent/ArtifactCard.tsx`、`level/MasteryMeter.tsx`、`graph/status.ts`、
 * `pages/DashboardPage.tsx`、`pages/NodeDetailPage.tsx`。结果是它们真的分叉了：
 *
 *   - `attempted` 在 `ArtifactCard` 是「试过」，在其余处是「刚接触」；
 *   - 三份写了 `unfamiliar: '刚接触'` 这个键，而 `unfamiliar` **不在契约枚举里**
 *     —— 它是死代码，只会让下一个人以为后端会发这个值；
 *   - `DashboardPage` 与 `NodeDetailPage` 的表里**缺 `attempted`**，于是后端真发
 *     `attempted` 时，页面上显示的是英文原值 `attempted`。这类 bug 只在恰好
 *     遇到那个状态时才出现，单测很容易漏。
 *
 * ## 为什么类型是 `Record<MasteryState, string>` 而不是 `Record<string, string>`
 *
 * 这是本文件存在的**技术**理由，不是风格问题。`MasteryState` 是契约枚举推导出的
 * 有限联合，`Record<MasteryState, …>` 会强制这张表覆盖每一个取值：
 *
 *   - 后端新增第六个状态 → 契约重新生成 → 这里 typecheck **直接红**，缺哪个一目了然；
 *   - 换成 `Record<string, string>` 则一切照常编译，运行时页面悄悄露出英文原值。
 *
 * 前者是编译期的一次提醒，后者是用户看到的一次故障。所以别把它放宽成 `string`。
 *
 * ## 为什么 `attempted` 用「刚接触」
 *
 * 五个值要读成同一条阶梯：未学习 → 刚接触 → 已熟悉 → 已熟练 → 已掌握。
 * 五个词都是**状态**，词性一致。「试过」描述的是一个动作（做过题），混进阶梯里
 * 读不出它是同一把尺子上的第几格。
 *
 * ## 谁改这个文件
 *
 * 共享面，归 integrator。加一个新状态是改契约的人顺带改这里（typecheck 会提醒他），
 * 而不是每个页面各加一行。
 */
import type { MasteryState } from '@starmap/api-contract';

/**
 * 五态 → 中文。顺序按阶梯从低到高写，读代码时能看出量级关系。
 *
 * 注意键的顺序参与 `Object.keys()`，而 `mastery/labels.test.ts` 会把它排序后
 * 与契约枚举比对 —— 顺序本身不参与断言，但不能因此随便写。
 */
export const MASTERY_STATE_LABEL: Record<MasteryState, string> = {
  unseen: '未学习',
  attempted: '刚接触',
  familiar: '已熟悉',
  proficient: '已熟练',
  mastered: '已掌握',
};

/**
 * 取中文标签。
 *
 * 存在的理由不是「防御脏数据」—— 参数类型是 `MasteryState`，索引必然命中，
 * 兜底在这里就是死代码。它存在的理由是**调用点的可读性**：页面里写
 * `masteryLabel(node.state)` 比 `MASTERY_STATE_LABEL[node.state]` 少一层方括号，
 * 而且将来若要加日志（「收到了枚举外的状态」）只有一个地方要改。
 *
 * **不要**在调用点再写 `?? node.state` 之类的兜底：那会让「后端发了个枚举外的值」
 * 这件事静默降级成「页面上显示一个英文单词」，谁也不报警。真要处理未知取值，
 * 就在这一个函数里处理。
 */
export function masteryLabel(state: MasteryState): string {
  return MASTERY_STATE_LABEL[state];
}
