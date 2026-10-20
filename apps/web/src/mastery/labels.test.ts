/**
 * 掌握状态词表与契约真源的防漂移断言。
 *
 * ## 这里到底在防什么
 *
 * `mastery/labels.ts` 的 `MASTERY_STATE_LABEL` 是 `Record<MasteryState, string>`，
 * 所以后端新增状态时 typecheck 会红 —— **前提是契约重新生成过**。但存在一条
 * 静默路径：有人手改了 `packages/api-contract/src/domains/graph.ts` 的枚举，
 * 却忘了跑 `pnpm contract:gen`，于是 `apps/web/src/api/generated/model` 里还是
 * 旧的五态，typecheck 依旧绿，页面在收到新状态时露出英文原值。
 *
 * 所以这里直接从**契约包源码**（而不是生成物）取枚举，与前端词表比对。生成物与
 * 源码之间的一致性由 `pnpm contract:check` 负责，两者合起来才闭环：
 *
 *   - contract:check  → 源码改了必须重新生成
 *   - 本测试          → 生成物（进而词表）必须跟着源码
 *
 * ## 为什么用 `MasteryStateSchema.options` 而不是手抄一份期望值
 *
 * 手抄的期望值只能证明「今天这两份手抄的东西一样」。从 schema 读 options 才能
 * 证明「词表与唯一真源同源」—— 后者才是这条测试的名字里「契约真源」的意思。
 */
import { describe, expect, it } from 'vitest';
import { MasteryStateSchema } from '@starmap/api-contract';
import { MASTERY_STATE_LABEL, masteryLabel } from './labels';

const CONTRACT_STATES = MasteryStateSchema.options;

describe('掌握状态词表与契约枚举一致', () => {
  it('键集合与契约枚举完全相同（多一个或少一个都算漂移）', () => {
    // 排序后比：键的顺序不影响渲染，但集合必须一致。
    // `toEqual` 对数组做逐项比较，长度不同立即失败，所以「少一个」也会被抓到。
    expect(Object.keys(MASTERY_STATE_LABEL).sort()).toEqual([...CONTRACT_STATES].sort());
  });

  it('每个状态都有非空中文标签，没有把枚举值当标签用', () => {
    for (const state of CONTRACT_STATES) {
      const label = masteryLabel(state);
      expect(label.length).toBeGreaterThan(0);
      // 标签等于枚举值意味着「漏翻译」，而这类 bug 在页面上看起来只是"英文"，
      // 很容易被当成设计选择放过。
      expect(label).not.toBe(state);
      // 至少含一个汉字，防止有人填了 'attempted'、'n/a' 之类的占位。
      expect(label).toMatch(/[\u4e00-\u9fa5]/);
    }
  });

  it('attempted 用「刚接触」，不是「试过」', () => {
    // 单独钉住这条：它曾经在两个文件里写法不同（`试过` vs `刚接触`），
    // 是全套词表分叉的实际起因。写死一个期望值，是为了让"改文案"变成
    // 一次有意识的动作，而不是某个文件顺手改一下。
    expect(masteryLabel('attempted')).toBe('刚接触');
  });

  it('`unfamiliar` 不在契约里 —— 词表里若有这个键就是死代码回来了', () => {
    // 历史上三份词表都写了 `unfamiliar: '刚接触'`，注释还说是"历史遗留"。
    // 但在 `Record<MasteryState, string>` 下它根本编译不过，所以这条断言
    // 防的是有人为了"兼容"把它加回来 —— 后端从不发这个值，加了也永远不命中。
    expect(CONTRACT_STATES).not.toContain('unfamiliar');
    expect(Object.keys(MASTERY_STATE_LABEL)).not.toContain('unfamiliar');
  });
});
