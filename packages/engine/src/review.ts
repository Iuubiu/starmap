/**
 * 复验排期内核。纯函数，无 IO、无时钟、无定时器。
 *
 * ## 为什么排期不是后台任务
 *
 * ADR-0003 把「追问循环」放在 engine 而不是 Mastra Workflow，理由是交互主路径
 * 上的状态机必须能被单测穷举。复验排期是同一类东西的另一个例子，而且更极端：
 *
 * - **排期是一个存下来的时刻，不是一个待触发的闹钟。** `app.mastery.next_review_at`
 *   写一行时间戳，读的时候用 `<= now` 比一下就知道到期没有。进程崩了、重启了、
 *   部署到三个实例上，结论都一样 —— 不需要谁「记得」去推进它。
 * - 反过来，cron / Workflow 定时任务是**有状态的**：它要知道上次跑到哪、漏跑
 *   怎么补、多实例怎么只跑一次。这三件事每一个都会在生产上出错，而错法是
 *   「某人的复验没排上」或「同一批复验排了两遍」，两者都很难被发现。
 * - 代价是「到期」这件事只在有人查询时才有意义。这对学习工作站完全成立：
 *   没有人在看的时候，复验不需要发生。
 *
 * 于是这个文件里没有任何 `Date.now()`：`now` 是参数，`completedAt` 是参数。
 * 同一串输入永远得出同一串输出，测试可以直接断言 `2026-03-04T00:00:00.000Z`
 * 这种字面值，而不是「大概一天之后」。
 *
 * ## 间隔序列
 *
 * 1 / 3 / 7 / 21 / 60 天（spec 第 407 行）。**不做扩张式间隔**：spec 第 268 行
 * 引 Latimier 2021（扩张 vs 均一 g=0.034，不显著）—— 既然扩张没有可测收益，
 * 就用一条固定序列，行为可预期、可以对着表测。
 */

const DAY_MS = 86_400_000;

/**
 * 复验间隔序列（天）。
 *
 * 数组下标就是 `stage`：stage 0 是掌握后第 1 天那次，stage 4 是第 60 天那次。
 * 「通过则推进」= stage+1；「未通过则回到更早的间隔」= stage−1（夹到 0）。
 */
export const REVIEW_INTERVALS_DAYS: readonly number[] = [1, 3, 7, 21, 60];

/** 每次复验抽 3–5 题（票面「每次 3–5 题」）。 */
export const REVIEW_ITEMS_MIN = 3;
export const REVIEW_ITEMS_MAX = 5;

/**
 * 通过线：**答对数 ≥ ⌈题数 × 0.8⌉**。
 *
 * 为什么不写死「错一题以内」：3 题时错一题就是 67%，那不是「还记得」，是
 * 「记得一半」。0.8 的下界让 3 题全对、4 题全对、5 题错一题才通过 —— 题越少
 * 要求越严，正好抵掉「题目少所以容易蒙对」的偏差。
 *
 * 与出口门控（n=8 需 7 对 = 87.5%、n=10 需 9 对 = 90%）**不是同一把尺子**：
 * 门控决定「能不能往下走」，复验决定「还记得多少」，后者允许一点磨损。
 */
export const REVIEW_PASS_RATIO = 0.8;

/** 一次复验的排期：阶段号 + 下次到期时刻。 */
export interface ReviewSchedule {
  /** 间隔序列下标，0..REVIEW_INTERVALS_DAYS.length-1 */
  stage: number;
  /** 下次到期时刻（ISO 8601） */
  nextDueAt: string;
}

/** 池子里的一道题。只留挑题需要的两个字段。 */
export interface ReviewCandidate {
  itemId: string;
  variantGroup: string;
}

/** ISO → 毫秒；坏时间戳返回 NaN（**不**回落成「现在」，那会让结果依赖系统时钟）。 */
function toMillis(iso: string): number {
  return Date.parse(iso);
}

/** 把 stage 夹进 [0, 末档] 并取整。NaN / 非有限值按 0 处理。 */
function clampStage(stage: number): number {
  if (!Number.isFinite(stage)) return 0;
  const last = REVIEW_INTERVALS_DAYS.length - 1;
  const truncated = Math.trunc(stage);
  if (truncated < 0) return 0;
  if (truncated > last) return last;
  return truncated;
}

/** 阶段号 → 间隔天数。越界夹到两端，坏输入按最短间隔。 */
export function reviewIntervalDays(stage: number): number {
  const index = clampStage(stage);
  // 常量表是 readonly 数组；`noUncheckedIndexedAccess` 下取值可能是 undefined，
  // 但 clampStage 已保证下标在范围内，这里用兜底值让类型也满足。
  return REVIEW_INTERVALS_DAYS[index] ?? REVIEW_INTERVALS_DAYS[0] ?? 1;
}

/**
 * 第一次排期：被判定为「已掌握」的那一刻起第 1 天。
 *
 * 未掌握返回 `null` 而不是「排到明天」：`next_review_at` 非空就意味着图谱上会
 * 亮起「需复验」，让一个还在学的知识点显示「该复验了」是错误信息 —— 它该显示
 * 的是「在学」。
 */
export function initialReviewSchedule(
  masteredAt: string,
  state: string,
): ReviewSchedule | null {
  if (state !== 'mastered') return null;
  const ms = toMillis(masteredAt);
  if (Number.isNaN(ms)) return null;
  return { stage: 0, nextDueAt: new Date(ms + reviewIntervalDays(0) * DAY_MS).toISOString() };
}

/**
 * 一次复验做完之后，下一次排到哪天。
 *
 * - 通过：阶段 +1（到顶就停在 60 天那档，不溢出）；
 * - 未通过：阶段 −1（到 0 就停在最短的 1 天，不退成负数）。
 *
 * `completedAt` 是**这次复验完成的时刻**而不是「原定到期时刻」：排期从真正
 * 做完的那一刻起算，否则「拖了三天才做」下一次会在做完的当天就到期。
 * 坏时间戳原样回填，不编造一个日期。
 */
export function advanceReviewSchedule(input: {
  stage: number;
  passed: boolean;
  completedAt: string;
}): ReviewSchedule {
  const current = clampStage(input.stage);
  const next = input.passed ? clampStage(current + 1) : clampStage(current - 1);
  const ms = toMillis(input.completedAt);
  if (Number.isNaN(ms)) return { stage: next, nextDueAt: input.completedAt };
  return { stage: next, nextDueAt: new Date(ms + reviewIntervalDays(next) * DAY_MS).toISOString() };
}

/**
 * 到期了没有。
 *
 * 与前端 `toDisplayStatus`（`apps/web/src/graph/status.ts`）**逐字同一条规则**：
 * `nextDueAt !== null && Date.parse(nextDueAt) <= Date.parse(now)`。两边共用
 * `app.mastery.next_review_at` 这一列，比较方式也必须是同一个，否则就会出现
 * 「图谱说该复验、抽考说没有」——票 07 验收第 5 条要防的正是这件事。
 *
 * 坏日期不判到期（`NaN` 参与比较恒为 false，这里显式写出来）。
 */
export function isReviewDue(nextDueAt: string | null, now: string): boolean {
  if (nextDueAt === null) return false;
  const due = toMillis(nextDueAt);
  const at = toMillis(now);
  if (Number.isNaN(due) || Number.isNaN(at)) return false;
  return due <= at;
}

/** 逾期天数（整数，向下取整；未逾期为 0）。用于「已经拖了几天」这类提示。 */
export function overdueDays(nextDueAt: string | null, now: string): number {
  if (nextDueAt === null) return 0;
  const due = toMillis(nextDueAt);
  const at = toMillis(now);
  if (Number.isNaN(due) || Number.isNaN(at)) return 0;
  const diff = at - due;
  if (diff <= 0) return 0;
  return Math.floor(diff / DAY_MS);
}

/** 一次复验要答对几题才算通过。 */
export function reviewPassCount(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  // 用整数除法而不是 `total * 0.8`：0.8 在二进制里不精确，`5 * 0.8` 在某些
  // 运算顺序下会得到 4.000000000000001，ceil 之后变成 5 —— 一条只在五题时
  // 出现的「必须全对」规则，没有任何文档会提到它。
  return Math.ceil((Math.trunc(total) * 4) / 5);
}

/** 这次复验过了没有。0 题不算过（没有证据就不是通过）。 */
export function reviewPassed(correct: number, total: number): boolean {
  if (!Number.isFinite(total) || total <= 0) return false;
  const answered = Math.max(0, Math.min(Math.trunc(correct), Math.trunc(total)));
  return answered >= reviewPassCount(total);
}

/**
 * 从一个知识点的题目池里挑这次复验要做的题。
 *
 * 三条约束，顺序就是优先级：
 *
 * 1. **不重做原题**（票面「不能是原题重做」）。`attemptedItemIds` 是学习者在
 *    已掌握证据里做过的题；可用的新题够抽一次复验（≥3）时，做过的题**全部
 *    不选**。新题不够时才回落到旧题 —— 否则一个内容稀疏的知识点会永远没法
 *    复验，那比「复用了旧题」更糟。
 * 2. **跨变式组**（票面「从不同 variant_group 抽」）。按变式组轮转，一组出一题
 *    再回头补第二题，而不是先把某一组抽干。
 * 3. **3–5 题**。池子不足 3 题时返回现有的，不编造。
 *
 * 确定性：先按 `(variantGroup, itemId)` 排序再挑，所以同一批题无论从库里
 * 以什么顺序取出来，题单都一样 —— 复验记录要能回看「这次考了哪几题」，那串
 * 题单不该每次刷新都变。
 */
export function selectReviewItems(
  pool: readonly ReviewCandidate[],
  attemptedItemIds: readonly string[],
): ReviewCandidate[] {
  const attempted = new Set(attemptedItemIds);

  // 去重：同一道题可以被多张关卡引用（教学关的深究段 + 判定关），池子里会
  // 出现两份。复验题单里同一道题只该出现一次。
  const unique = new Map<string, ReviewCandidate>();
  for (const item of pool) {
    if (!unique.has(item.itemId)) unique.set(item.itemId, item);
  }

  const sorted = [...unique.values()].sort((a, b) => {
    if (a.variantGroup !== b.variantGroup) return a.variantGroup < b.variantGroup ? -1 : 1;
    return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
  });

  const fresh = sorted.filter((item) => !attempted.has(item.itemId));
  const candidates = fresh.length >= REVIEW_ITEMS_MIN ? fresh : sorted;

  // 按变式组排队。组内顺序：没做过的在前、题号升序；组间按组名升序。
  // 这样「先覆盖新变式」与「先给没做过的题」同时成立。
  const groups = new Map<string, ReviewCandidate[]>();
  for (const item of candidates) {
    const queue = groups.get(item.variantGroup);
    const ordered = queue
      ? [...queue, item]
      : [item];
    groups.set(item.variantGroup, ordered);
  }
  for (const [group, queue] of groups) {
    groups.set(
      group,
      [...queue].sort((a, b) => {
        const aSeen = attempted.has(a.itemId) ? 1 : 0;
        const bSeen = attempted.has(b.itemId) ? 1 : 0;
        if (aSeen !== bSeen) return aSeen - bSeen;
        return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
      }),
    );
  }

  const order = [...groups.keys()].sort();
  const picked: ReviewCandidate[] = [];
  let round = 0;
  while (picked.length < REVIEW_ITEMS_MAX) {
    let takenAny = false;
    for (const group of order) {
      if (picked.length >= REVIEW_ITEMS_MAX) break;
      const queue = groups.get(group) ?? [];
      const item = queue[round];
      if (item) {
        picked.push(item);
        takenAny = true;
      }
    }
    if (!takenAny) break;
    round += 1;
  }
  return picked;
}

/**
 * 把多个知识点的题单交错成一份复验清单。
 *
 * 票面第 1 条：「多个知识点交错出现而不是同一个连考」。三个知识点各两题时，
 * 正确顺序是 A1 B1 C1 A2 B2 而不是 A1 A2 B1 B2 C1 C2 —— 后者等于把复验拆成
 * 三段小测，学习者会在每一段内部用上下文猜答案（刚考完 A，下一题还是 A）。
 *
 * 轮转而不是洗牌：洗牌需要随机数，而那会让同一串数据每次抽出不同题单，
 * 复验记录里的「这次考了哪几题」就不再可复现。
 */
export function interleaveReviewItems<T>(groups: ReadonlyArray<readonly T[]>): T[] {
  const queues = groups.map((group) => [...group]).filter((queue) => queue.length > 0);
  const ordered: T[] = [];
  let round = 0;
  let takenAny = true;
  while (takenAny) {
    takenAny = false;
    for (const queue of queues) {
      const item = queue[round];
      if (item !== undefined) {
        ordered.push(item);
        takenAny = true;
      }
    }
    round += 1;
  }
  return ordered;
}
