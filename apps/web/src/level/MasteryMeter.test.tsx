/**
 * 双字段掌握度组件的测试（票 05 验收 5）。
 *
 * ## 为什么这个文件必须存在
 *
 * `MasteryMeter.tsx` 的注释里写着「`MasteryMeter.test.tsx` 有一条用例锁住它们，
 * 改动时两边会同时红」—— 而此前那个文件并不存在。注释里的这句承诺比没有更糟：
 * 下一个人会以为门槛值有守卫，于是放心去改。
 *
 * ## 这里钉的是哪三件事
 *
 * 1. **证据不足时一个百分号都不出现**。不是「不显示 0%」，而是整个子树里
 *    不存在 `%` —— 只要有一个 62% 漏出来，学习者就会据此决定要不要复习。
 *    所以断言写成 `container.textContent` 不含 `%`，而不是找某个具体字符串。
 * 2. **门槛常量与 engine 同源**。前端不 import engine（浏览器侧只该拿契约
 *    生成的类型），所以 8 / 3 是在组件里重述的。重述就会漂移，这里直接读
 *    engine 源码里的 `MASTERY_MIN_ATTEMPTS` / `MASTERY_MIN_VARIANTS` 比对。
 * 3. **两个百分比各管一件事**：achieved 与 current 必须是两个不同的数，且
 *    各自带着自己的说明文字 —— 合成一个数或只显示一个，都会在某处骗人。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import type { MasteryView } from '../api/queries';
import { MIN_ATTEMPTS, MIN_VARIANTS, MasteryMeter } from './MasteryMeter';

/**
 * 一份**证据足够**的视图。`achieved > current` 是刻意的：它就是「上个月学会了、
 * 这周还没复习」那张脸，正是双字段存在的理由。
 */
const view = (over: Partial<MasteryView> = {}): MasteryView => ({
  microKpId: 'kp-bool',
  name: '逻辑代数基本律',
  isLeaf: true,
  state: 'proficient',
  achieved: 0.93,
  current: 0.74,
  attemptCount: 12,
  variantCount: 3,
  evidenceSufficient: true,
  halfLifeDays: 30,
  lastEvidenceAt: '2026-10-01T00:00:00.000Z',
  aggregatedLeafCount: 1,
  ...over,
});

const renderMeter = (payload: MasteryView | null | undefined) =>
  render(
    <FluentProvider theme={webLightTheme}>
      <MasteryMeter view={payload} />
    </FluentProvider>,
  );

describe('MasteryMeter', () => {
  it('证据充足时双栏显示两个具体百分比，且它们来自两个字段', () => {
    const { container } = renderMeter(view());

    expect(screen.getByText('历史最高（不回落，用于解锁）')).toBeInTheDocument();
    expect(screen.getByText('当前熟练度（会随时间回落，用于推荐）')).toBeInTheDocument();
    expect(screen.getByText('93%')).toBeInTheDocument();
    expect(screen.getByText('74%')).toBeInTheDocument();
    // 两个数必须不同，否则「双栏」只是把同一个数写了两遍
    expect(container.textContent).not.toContain('74%74%');
  });

  it('状态用中文标签，不把枚举值当标签露出来', () => {
    renderMeter(view({ state: 'mastered' }));
    expect(screen.getByText('已掌握')).toBeInTheDocument();
    expect(screen.queryByText('mastered')).not.toBeInTheDocument();
  });

  it('证据不足时整棵子树里没有任何百分号 —— 不是「显示 0%」，是一个数字都不给', () => {
    renderMeter(
      view({
        achieved: null,
        current: null,
        evidenceSufficient: false,
        state: 'attempted',
        attemptCount: 2,
        variantCount: 1,
      }),
    );

    expect(screen.getByText('证据不足')).toBeInTheDocument();
    // 关键断言：不能有任何**作为数值展示的百分比**。
    //
    // 用什么判定：找「整个元素的文字恰好是一个百分数」的节点（`93%`、`0%`
    // 这种）—— 那才是渲染成一个数给学习者看的形状。不用 `textContent`
    // 搜 `%`：这段文案本身要解释「它不是 0%，是还不知道」，那个 0% 是被
    // 否定的引用，不是估值；禁掉它就等于禁止我们讲清楚为什么不给数字。
    expect(screen.queryAllByText(/^\d+%$/)).toHaveLength(0);
    // 「不知道」要说清楚，别让人以为是系统算错了
    expect(screen.getByText(/它不是 0%，是还不知道/)).toBeInTheDocument();
  });

  it('证据不足时讲清楚还差多少：差几次作答、几个变式都算得出来', () => {
    renderMeter(
      view({
        achieved: null,
        current: null,
        evidenceSufficient: false,
        attemptCount: 2,
        variantCount: 1,
      }),
    );
    // 2 次作答 / 1 个变式，离 8 / 3 分别差 6 与 2
    expect(
      screen.getByText(new RegExp(`还差再 ${MIN_ATTEMPTS - 2} 次作答、再 ${MIN_VARIANTS - 1} 个不同变式`)),
    ).toBeInTheDocument();
  });

  it('只缺一样时只提那一样，不把已经够的那项也列出来', () => {
    renderMeter(
      view({
        achieved: null,
        current: null,
        evidenceSufficient: false,
        attemptCount: MIN_ATTEMPTS,
        variantCount: 1,
      }),
    );
    expect(screen.getByText(/还差再 2 个不同变式/)).toBeInTheDocument();
    expect(screen.queryByText(/再 0 次作答/)).not.toBeInTheDocument();
  });

  /**
   * 门槛常量与 engine 同源。
   *
   * 读源码而不是 import：`apps/web` 不依赖 `@starmap/engine`（依赖边界守卫
   * 也不允许它绕道），而这两个数字必须与内核一致 —— 门控、复验、定级三条
   * 下游票都会引用它们，前端把 8 写成 10 会让「还差几次」永远算不对。
   *
   * 与 `flow.test.ts` 读 `content/levels/*.spec.json` 是同一个手法：用真实的
   * 另一份文件当断言对象，而不是把期望值手抄一遍。
   */
  it('门槛常量（8 次作答 / 3 个变式）与 engine 内核一致', () => {
    const masterPath = resolve(process.cwd(), '..', '..', 'packages', 'engine', 'src', 'mastery.ts');
    const source = readFileSync(masterPath, 'utf8');

    const engineAttempts = /export const MASTERY_MIN_ATTEMPTS = (\d+);/.exec(source)?.[1];
    const engineVariants = /export const MASTERY_MIN_VARIANTS = (\d+);/.exec(source)?.[1];

    // 正则没匹配到就等于「这条测试什么都没验证」，必须先失败
    expect(engineAttempts).toBeDefined();
    expect(engineVariants).toBeDefined();
    expect(Number(engineAttempts)).toBe(MIN_ATTEMPTS);
    expect(Number(engineVariants)).toBe(MIN_VARIANTS);
  });

  it('接口还没回时给「还没算出来」，不预先给 0%', () => {
    renderMeter(undefined);
    expect(screen.getByText(/掌握度还没算出来/)).toBeInTheDocument();
    expect(screen.queryAllByText(/^\d+%$/)).toHaveLength(0);
  });

  it('非叶节点明说这是聚合出来的只读值，库里不存它', () => {
    renderMeter(view({ isLeaf: false, aggregatedLeafCount: 4 }));
    expect(screen.getByText(/4 个叶子知识点按证据量加权聚合出来的只读值/)).toBeInTheDocument();
    expect(screen.getByText(/库里不存它/)).toBeInTheDocument();
  });

  it('叶子节点不提聚合，免得读者以为这个数还是拼出来的', () => {
    renderMeter(view({ isLeaf: true }));
    expect(screen.queryByText(/叶子知识点按证据量加权/)).not.toBeInTheDocument();
  });

  it('脚注把多源信息摊开：作答次数、变式数（同组只算一个）、半衰期', () => {
    renderMeter(view());
    expect(screen.getByText(/12 次作答/)).toBeInTheDocument();
    expect(screen.getByText(/3 个不同变式（平行题同组只算一个）/)).toBeInTheDocument();
    expect(screen.getByText(/半衰期 30 天/)).toBeInTheDocument();
  });
});
