/**
 * 展示时区：「用户看见的今天」按哪个时区切。
 *
 * ## 为什么这是一个配置项，而不是「恰好落在 UTC」
 *
 * 看板说「今天答了 261 题」，这句话是对人说的。「今天」必须指**用户所在地
 * 的那一天**。此前 `recommend.service.ts` 的 `dayStart()` 把「今天」定义成
 * UTC 日界（`${iso.slice(0, 10)}T00:00:00.000Z`），于是 Asia/Shanghai 的用户
 * 在本地 00:00–08:00 之间看到的题数包含了昨天下午那一段 —— 实测 262 对 105。
 * 每天有 8 小时这句话是错的。
 *
 * 当时的理由（不用 SQL 的 `date_trunc('day', now())`）本身是对的：那个函数的
 * 结果取决于**连接会话的 TimeZone**，换个部署环境或换个连接池实现就飘了。
 * 但它推出的是「不要用会话时区」，不是「必须用 UTC」—— 显式配置的时区同样
 * 确定、同样可重复，且不依赖任何连接状态。
 *
 * ## 与掌握度回放日界的关系（**两个不同的边界，不能合并**）
 *
 * · 本文件：**展示**边界。「今天答了几题」「今天新掌握几个」用它。
 * · `mastery/mastery.service.ts` 的 `floorToGranularity`：**回放**边界，保持
 *   UTC 日界不动。它是纯内部计算边界，票 05 验收第 7 条（同一串作答输入输出
 *   确定可重复）依赖它，改它会破坏已经写进测试与文档的确定性。
 *
 * 合并它们会同时坏掉两件事：用展示时区做回放，会让「同一天内刷新两次得到
 * 不同 `current`」重新出现（跨时区用户尤其明显）；用 UTC 做展示，就是本缺陷。
 */

/** 默认展示时区：本项目的使用者与内容都在中文语境下。 */
export const DEFAULT_DISPLAY_TIMEZONE = 'Asia/Shanghai';

/**
 * 环境变量名。
 *
 * 用 `STARMAP_` 前缀而不是 `APP_` / `TZ`：本仓已有的自定义变量都是这个前缀
 * （`STARMAP_GLOSSARY_PATH`、`STARMAP_SKILLS_DIR`），而 `TZ` 是 libc 的保留
 * 变量，改它会影响整个进程的 `Date` 行为 —— 那会把「展示边界」变成「全局
 * 时钟」，正是这次要避免的耦合。
 */
export const DISPLAY_TIMEZONE_ENV = 'STARMAP_DISPLAY_TIMEZONE';

/** 已验证过的时区名（`Intl` 构造有成本，校验结果可以复用）。 */
const validated = new Set<string>();

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;

  if (!validated.has(timeZone)) {
    try {
      // 只是探一下合法性；真正的 formatter 在下面建（带 hourCycle）。
      new Intl.DateTimeFormat('en-US', { timeZone });
    } catch {
      throw new Error(
        `${DISPLAY_TIMEZONE_ENV} 不是合法的 IANA 时区：${JSON.stringify(timeZone)}。` +
          `例：Asia/Shanghai、UTC、Europe/Berlin。`,
      );
    }
    validated.add(timeZone);
  }

  // `hourCycle: 'h23'`：默认的 `h24` 会把午夜报成 "24" 时，`Date.UTC(y, m, d, 24)`
  // 会悄悄进位成第二天零点 —— 那会让「本地零点」整体偏一天。
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  formatters.set(timeZone, created);
  return created;
}

/** 把某个时刻在 `timeZone` 下的「墙上时钟」读成一组数字。 */
function wallClock(
  ms: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const picked: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') picked[part.type] = Number(part.value);
  }
  return {
    year: picked.year ?? 1970,
    month: picked.month ?? 1,
    day: picked.day ?? 1,
    hour: picked.hour ?? 0,
    minute: picked.minute ?? 0,
    second: picked.second ?? 0,
  };
}

/**
 * 读配置。空串/空白视为未配置（`cp .env.example .env` 后忘填不该炸）。
 *
 * 非法时区**抛错**而不是静默回落到 UTC：静默回落会让「今天」重新变成错的
 * 那个值，而且没有任何迹象 —— 与「证据不足不给 0%」同一条原则，配置错了就
 * 说配置错了。
 */
export function resolveDisplayTimezone(
  raw: string | undefined = process.env[DISPLAY_TIMEZONE_ENV],
): string {
  const value = raw?.trim();
  if (value === undefined || value === '') return DEFAULT_DISPLAY_TIMEZONE;
  // 提前触发校验（`formatterFor` 内部会抛带变量名的错）。
  formatterFor(value);
  return value;
}

/**
 * `atIso` 所在那一天（按 `timeZone`）的零点，返回 ISO/UTC 字符串。
 *
 * 输出是**绝对时刻**（带 `Z`），所以可以直接拼进 `WHERE created_at >= $1`。
 * 它不是「本地 00:00 的字面量」—— 本地零点在 UTC 里通常是前一天 16:00。
 *
 * 算法：先取 `atIso` 在目标时区下的年月日，把它当作 UTC 零点当初始猜测，再
 * 用「该时刻在目标时区被读成什么」反解偏移，迭代到不动点。两三次必然收敛
 * （夏令时切换日会多迭代一次）。**已知边界**：极少数时区在本地零点整切换
 * 夏令时（如 America/Santiago），那一「天」的零点不存在，本函数会落到切换
 * 后的第一个时刻 —— 对「今天答了几题」这类按天统计足够，且这类时区不是本
 * 项目默认值。
 */
export function startOfDisplayDay(atIso: string, timeZone?: string): string {
  const ms = Date.parse(atIso);
  if (Number.isNaN(ms)) {
    throw new Error(
      `不是合法的时刻：${JSON.stringify(atIso)}（期望 ISO 8601，如 2026-10-21T21:00:00.000Z）`,
    );
  }
  const zone = timeZone ?? resolveDisplayTimezone();
  const { year, month, day } = wallClock(ms, zone);

  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let i = 0; i < 4; i += 1) {
    const wall = wallClock(guess, zone);
    const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    // 偏移 = 本地墙上时钟 - 真实 UTC 时刻。上海 = +8h。
    const offset = asUtc - guess;
    const next = target - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess).toISOString();
}
