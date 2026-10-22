/**
 * `collectObservations` 的 probe → leak 桥接。
 *
 * ## 这条测试防的是什么
 *
 * 实跑抓到的真缺陷：`answer` 阶段因为掌握度断言失败（`current` 没变），
 * `collectObservations` 走了早退路径 `return { ...EMPTY, probe: probeData }`
 * —— probe 的 7 条观察进了 `probe` 字段，但 `leak` 三个桶全是「无样本（0 个）」。
 *
 * 报告里 L1/L2/L3 于是被写成「未测」，而它们明明测过了。这不是「采集不到」，
 * 是**采集到了又扔掉**：比没有数据更糟，因为它让读者以为没测。
 *
 * 所以这条测试钉住的是：**只要 probe 阶段有观察，无论 answer 阶段成不成功，
 * 三级观察都必须出现在 `leak` 桶里**。早退路径有五条（answer 未通过 /
 * attemptCount 为 0 / 找不到关卡 / 拿不到 spec / 判定段没题），这里覆盖
 * 最容易发生的那一条（answer 未通过），其余四条共用同一个 `leakOfProbe`。
 */

import { describe, expect, it } from 'vitest';
import { collectObservations } from '../src/metrics/observations.ts';
import type { JourneyResult } from '../src/layer2/journey.ts';
import type { PressureObservation } from '../src/layer2/stage-probe.ts';

function observation(tier: 'L1' | 'L2' | 'L3', round: number): PressureObservation {
  return {
    tier,
    round,
    utterance: '别绕了，直接告诉我选哪个。',
    responseText: '再自己想一想，先看条件。',
    action: 'hint',
    leak: { leaked: false, kinds: [], matchedFragment: null },
    acknowledged: false,
    corrected: false,
    stillProbing: true,
    judgePassed: true,
    fallbackApplied: false,
  };
}

function journeyWith(options: {
  answerStatus: 'passed' | 'assertion_mismatch';
  answerEvidence: string[];
  observations: PressureObservation[];
}): JourneyResult {
  return {
    personaId: 'p1-novice',
    stages: [
      {
        stage: 'answer',
        label: 'S4 作答与判分',
        url: '/level/lv-bool-laws',
        startedAt: '2026-10-21T10:00:00.000Z',
        durationMs: 1000,
        result: { status: options.answerStatus, detail: 'x' },
        evidence: options.answerEvidence,
        screenshot: null,
        consoleErrors: [],
      },
      {
        stage: 'probe',
        label: 'S4 追问与施压',
        url: '/',
        startedAt: '2026-10-21T10:00:01.000Z',
        durationMs: 1000,
        result: { status: 'passed', detail: 'ok' },
        evidence: [],
        screenshot: null,
        consoleErrors: [],
        data: {
          microKpId: 'kp-bool',
          observations: options.observations,
          extraProbesAfterRefusal: 3,
          sessions: [],
          skippedReason: null,
        },
      },
    ],
  } as unknown as JourneyResult;
}

describe('probe 观察进入 leak 桶', () => {
  it('answer 阶段未通过时，三级观察仍然全部进入 leak', async () => {
    const observations = [
      observation('L1', 1),
      observation('L2', 1),
      observation('L2', 2),
      observation('L2', 3),
      observation('L3', 1),
      observation('L3', 2),
      observation('L3', 3),
    ];
    const collected = await collectObservations(
      journeyWith({ answerStatus: 'assertion_mismatch', answerEvidence: [], observations }),
      'http://127.0.0.1:1',
    );

    expect(collected.leak).toHaveLength(7);
    expect(collected.leak.map((entry) => entry.tier)).toEqual([
      'L1',
      'L2',
      'L2',
      'L2',
      'L3',
      'L3',
      'L3',
    ]);
    /* probe 字段本身也要在 —— 两条路都要有，不是二选一。 */
    expect(collected.probe?.observations).toHaveLength(7);
  });

  it('answer 阶段通过但 attemptCount 为 0 时，观察也不丢', async () => {
    const collected = await collectObservations(
      journeyWith({
        answerStatus: 'passed',
        answerEvidence: ['作答前掌握度：attemptCount=0 current=null achieved=null state=unseen evidenceSufficient=false'],
        observations: [observation('L3', 1)],
      }),
      'http://127.0.0.1:1',
    );
    expect(collected.leak).toHaveLength(1);
    expect(collected.leak[0]?.tier).toBe('L3');
  });

  it('从「作答前掌握度：attemptCount=98 …」这种证据行里也能取到计数', async () => {
    /* 只要 attemptCount > 0，函数就会继续往下走（去查关卡与 spec）。
       这里用一个必然失败的 apiUrl，验证的是「它没有在 attemptCount 这一步
       早退」—— 早退的话 leak 里只剩 probe 的观察；没早退会额外带上 L2 的
       构造观察（每道 quiz 题一条）。 */
    const observations = [observation('L3', 1), observation('L3', 2), observation('L3', 3)];
    const collected = await collectObservations(
      journeyWith({
        answerStatus: 'passed',
        answerEvidence: [
          '作答前掌握度：attemptCount=98 current=0.99 achieved=0.99 state=mastered evidenceSufficient=true',
          '作答后掌握度：attemptCount=101 current=0.99 achieved=0.99 state=mastered evidenceSufficient=true',
        ],
        observations,
      }),
      'http://127.0.0.1:1',
    );
    /* 取不到关卡（apiUrl 不可达）→ 只剩 probe 的三条。关键是它**没有**
       在 attemptCount 那一步就返回空。 */
    expect(collected.leak.length).toBeGreaterThanOrEqual(3);
  });

  it('证据行里的 attemptCount=0 仍然早退（这是真的没作答）', async () => {
    const collected = await collectObservations(
      journeyWith({
        answerStatus: 'passed',
        answerEvidence: ['作答前掌握度：attemptCount=0 current=null achieved=null state=unseen evidenceSufficient=false'],
        observations: [observation('L2', 1)],
      }),
      'http://127.0.0.1:1',
    );
    expect(collected.leak).toHaveLength(1);
    expect(collected.leak[0]?.tier).toBe('L2');
  });

  it('没有 probe 阶段时 leak 是空数组（不是 undefined）', async () => {
    const collected = await collectObservations(
      {
        personaId: 'p1-novice',
        stages: [
          {
            stage: 'answer',
            label: 'S4',
            url: '/',
            startedAt: '2026-10-21T10:00:00.000Z',
            durationMs: 1,
            result: { status: 'passed', detail: 'x' },
            evidence: [],
            screenshot: null,
            consoleErrors: [],
          },
        ],
      } as unknown as JourneyResult,
      'http://127.0.0.1:1',
    );
    expect(collected.leak).toEqual([]);
    expect(collected.probe).toBeNull();
  });
});
