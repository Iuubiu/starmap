/**
 * 掌握度取值域防漂移。
 *
 * `domains/graph.ts` 与 `domains/levels.ts` 各有一份五态枚举（不能互相 import，
 * 会形成模块环）。两份枚举分别喂着两组接口：图谱用前者、掌握度/作答用后者。
 * 它们必须逐字一致 —— 否则 `nodes` 返回 'proficient' 而 `mastery` 返回
 * 'proficient ' 之类的偏差会让前端的 `STATE_LABEL[state]` 直接落到 `undefined`
 * 上并显示成英文原值，而这类 bug 只会在某个具体页面上被看见。
 *
 * 这里把「必须一致」写成断言，而不是写成注释。
 */
import { describe, expect, it } from 'vitest';
import { MasteryStateSchema as GraphMasteryStateSchema } from './graph.js';
import { AttemptRecordSchema, MasteryViewSchema } from './levels.js';

describe('掌握度五态在两个领域文件里一致', () => {
  it('graph 与 levels 的取值域逐个相同且顺序相同', () => {
    const graphStates = GraphMasteryStateSchema.options;
    const levelStates = MasteryViewSchema.shape.state.options;
    // 用 toEqual 而不是排序后比：顺序也参与 Orval 生成的枚举常量对象
    expect(levelStates).toEqual(graphStates);
  });

  it('五态就是 spec 里那五个，没多也没少', () => {
    expect([...GraphMasteryStateSchema.options].sort()).toEqual([
      'attempted',
      'familiar',
      'mastered',
      'proficient',
      'unseen',
    ]);
  });

  it('知识类型的取值域与 engine 的半衰期表同一组', () => {
    expect([...AttemptRecordSchema.shape.knowledgeKind.options].sort()).toEqual([
      'comprehensive',
      'concept',
      'fact',
    ]);
  });
});
