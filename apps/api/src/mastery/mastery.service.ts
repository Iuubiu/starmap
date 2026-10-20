import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { MasteryView } from '@starmap/api-contract';
import { deriveState, type MasterySnapshot } from '@starmap/engine';
import { DatabaseService } from '../db/database.service.js';
import { aggregateSnapshots, groupByMicroKp, snapshotOf } from './evidence.js';
import {
  findKnowledgePoint,
  loadEvidence,
  loadLeafDescendants,
  type Runner,
} from './repository.js';

/**
 * 掌握度的时间粒度：一天（UTC 日界）。
 *
 * ## 为什么不是毫秒
 *
 * `current` 按半衰期连续衰减，毫秒级的时间差会让同一个知识点在两次相邻请求
 * 里得到 0.8312… 与 0.8311… 两个数。界面上四舍五入后看不出差别，但它有两个
 * 真实代价：
 *
 * 1. **票 05 验收第 7 条要求「同一串作答输入输出确定可重复」**。如果评估时刻
 *    取自时钟，两次读就不是同一组输入，那条要求只能在单元测试里对
 *    `replayMastery` 断言，端到端永远测不了。
 * 2. 「刷新一下掉了 0.01%」是学习者真实会注意到的抖动，而它不带任何信息 ——
 *    半衰期以天计，一天之内的变化小于显示精度。
 *
 * 所以评估时刻统一截断到 UTC 日界。代价是「今天做的题，今天之内 current 不会
 * 衰减」—— 那正好也是我们想表达的：记忆衰减是按天发生的事。
 */
export const MASTERY_TIME_GRANULARITY_MS = 86_400_000;

/** 把 ISO 时刻截断到 UTC 日界。坏时间戳原样返回（不猜）。 */
export function floorToGranularity(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(Math.floor(ms / MASTERY_TIME_GRANULARITY_MS) * MASTERY_TIME_GRANULARITY_MS).toISOString();
}

/**
 * 掌握度读路径。
 *
 * ## 为什么不读 `app.mastery` 里的 `current` 列
 *
 * 那一列记的是「上次作答那一刻的 current」。`current` 会随时间持续变小，
 * 昨天写下的 0.83 今天可能应该显示 0.79 —— 直接读列等于把「上次算的时候」
 * 当成「现在」。所以这里每次都从 `attempts` 重放：数据量是「一个知识点
 * 的作答历史」，通常几十行，代价可以忽略；换来的是**任何时刻读到的数都
 * 与此刻一致**，不会出现「刷新一下掉了两个百分点」这种无法解释的现象。
 *
 * `app.mastery` 行仍然要写（票 05 验收要求同事务更新），它服务于批量统计
 * 与出题计划；但不是展示的真源。
 *
 * ## 非叶节点
 *
 * `ADR-0004` 要求父节点颜色由叶子按证据量加权聚合，且**只读派生、不落库**。
 * 这里的实现是「递归取叶子 → 逐个重放 → 加权平均」，不写任何一行。
 */
@Injectable()
export class MasteryService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** 池上的执行器。读路径不开事务。 */
  private get runner(): Runner {
    return (sql, params) => this.db.query(sql, params ?? []);
  }

  /**
   * 数据库侧的当前时刻。
   *
   * 用库的 `now()` 而不是 Node 的 `Date.now()`：多实例部署时进程时钟可能
   * 差几秒，而「同一响应里的所有数字共享同一时刻」这件事不该取决于哪台机器
   * 接了这次请求。
   */
  async now(): Promise<string> {
    return this.db.now();
  }

  /**
   * 一个知识点的双字段掌握度。
   *
   * `evaluatedAt` 由调用方（控制器）传入，测试因此可以断言具体数值而不是
   * 「比刚才小一点」。生产路径传数据库的 `now()`，让同一响应里的所有数字
   * 共享同一个时刻。
   */
  async view(microKpId: string, evaluatedAt: string): Promise<MasteryView> {
    const at = floorToGranularity(evaluatedAt);
    const point = await findKnowledgePoint(this.runner, microKpId);
    if (!point) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `知识点不存在: ${microKpId}`,
      });
    }

    if (point.is_leaf) {
      const snapshot = await this.leafSnapshot(point.id, at);
      return this.toView(point.id, point.name, true, 0, snapshot);
    }

    const leafIds = await loadLeafDescendants(this.runner, point.id);
    const rows = await loadEvidence(this.runner, leafIds);
    const grouped = groupByMicroKp(rows);
    const snapshots: MasterySnapshot[] = leafIds.map((id) =>
      snapshotOf(grouped.get(id) ?? [], at),
    );
    const aggregate = aggregateSnapshots(snapshots);

    // 父节点的五态由聚合值派生，**不是**把孩子的 state 投票。投票会让
    // 「20 个孩子各做一次」看起来和「一个孩子做过 20 次」一样，而那两件事
    // 对「这一章学会了没有」的回答完全不同。
    const state = deriveState(aggregate.attemptCount, aggregate.evidenceSufficient, aggregate.current ?? 0);

    return {
      microKpId: point.id,
      name: point.name,
      isLeaf: false,
      state,
      achieved: aggregate.evidenceSufficient ? aggregate.achieved : null,
      current: aggregate.evidenceSufficient ? aggregate.current : null,
      attemptCount: aggregate.attemptCount,
      variantCount: aggregate.variantCount,
      evidenceSufficient: aggregate.evidenceSufficient,
      // 父节点没有单一半衰期：不同叶子可能事实/概念/综合混着。给 concept 的
      // 30 天只是「量级参考」，真正的衰减在每片叶子上各按各的算了。
      halfLifeDays: 30,
      lastEvidenceAt: null,
      aggregatedLeafCount: leafIds.length,
    };
  }

  /** 一个叶节点的快照。写路径在同一事务里也会调用它。 */
  async leafSnapshot(microKpId: string, evaluatedAt: string, run?: Runner): Promise<MasterySnapshot> {
    const runner = run ?? this.runner;
    const rows = await loadEvidence(runner, [microKpId]);
    return snapshotOf(groupByMicroKp(rows).get(microKpId) ?? [], evaluatedAt);
  }

  /**
   * 快照 → 对外形状。
   *
   * 两个百分比只在证据充足时给出（`null` 否则）。这不是「前端记得处理 null」，
   * 而是**接口层不给数字**：spec.md:259 要求「低于门槛显示『证据不足』不给
   * 数字」，任何界面失误都不该有机会把 62.4% 摆到学习者眼前，让他据此决定
   * 要不要复习。
   */
  toView(
    microKpId: string,
    name: string,
    isLeaf: boolean,
    aggregatedLeafCount: number,
    snapshot: MasterySnapshot,
  ): MasteryView {
    const sufficient = snapshot.evidenceSufficient;
    return {
      microKpId,
      name,
      isLeaf,
      state: snapshot.state,
      achieved: sufficient ? snapshot.achieved : null,
      current: sufficient ? snapshot.current : null,
      attemptCount: snapshot.attemptCount,
      variantCount: snapshot.variantCount,
      evidenceSufficient: sufficient,
      halfLifeDays: snapshot.halfLifeDays,
      lastEvidenceAt: snapshot.lastEvidenceAt,
      aggregatedLeafCount,
    };
  }
}
