/**
 * 「最近访问的知识点」—— 面板空态用的三个历史项。
 *
 * ## 为什么存在这里而不是后端
 *
 * 这是一个**纯本地**的导航记忆：它只影响「我打开面板时看到哪三个快捷入口」，
 * 不参与推荐、不影响掌握度。放进数据库要新增一张表、一个接口、一套迁移，
 * 而收益只是「换台机器也能看到同样的最近访问」—— 单机学习工具没有这个场景。
 *
 * ## 为什么最多存 8 条却只显示 3 条
 *
 * 显示 3 条是产品决定（空态要一眼看完，超过 3 条就开始像列表）。多存几条是
 * 为了容错：知识点会随内容重导入而消失（id 漂移），存 8 条能保证即使一半
 * 失效，空态里仍然有 3 条能点。过滤失效 id 的活由调用方做（它手里有图谱）。
 *
 * ## 为什么所有操作都吞异常
 *
 * `localStorage` 在隐私模式、被策略禁用、或存储写满时会**抛异常**，而这段
 * 代码跑在面板打开路径上 —— 让它抛出去等于「一个历史记录把命令面板弄崩」。
 * 退化成「没有最近访问」是完全可以接受的结果。
 */

export const RECENT_STORAGE_KEY = 'starmap.command.recentNodes';

/** 存储上限。比显示条数多，见文件头注释。 */
export const RECENT_STORAGE_LIMIT = 8;

/** 空态里显示几条。 */
export const RECENT_VISIBLE = 3;

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 读原始列表（最多 `RECENT_STORAGE_LIMIT` 条）。
 *
 * 任何不合形状的内容都当成空列表：这个键是本地可手改的，一个被改坏的
 * JSON 不该让面板永远打不开。
 */
export function readRecentNodes(): string[] {
  const store = storage();
  if (store === null) return [];
  let raw: string | null;
  try {
    raw = store.getItem(RECENT_STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    if (out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= RECENT_STORAGE_LIMIT) break;
  }
  return out;
}

/**
 * 记一次访问：置顶 + 去重 + 截断。
 *
 * 返回写入后的列表，调用方可以直接拿去 setState —— 这样「写」和「读」不会
 * 因为一次失败的 `setItem` 而看到两个不同的世界。
 */
export function recordRecentNode(microKpId: string): string[] {
  const id = microKpId.trim();
  if (id.length === 0) return readRecentNodes();

  const next = [id, ...readRecentNodes().filter((entry) => entry !== id)].slice(
    0,
    RECENT_STORAGE_LIMIT,
  );

  const store = storage();
  if (store !== null) {
    try {
      store.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* 配额满 / 被禁用：内存里的顺序仍然是对的，下次打开会少几条，仅此而已 */
    }
  }
  return next;
}

/** 清空。测试与「重置」入口用，产品里暂无调用点。 */
export function clearRecentNodes(): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(RECENT_STORAGE_KEY);
  } catch {
    /* 同上：清不掉不是缺陷 */
  }
}

/**
 * 从当前地址推断「用户正待在一个知识点上」。
 *
 * 面板挂在应用根部（在路由之外），拿不到 `useLocation`，而它又确实需要知道
 * 「刚才看的那个点」——否则从详情页打开面板时，那个点不在最近访问里，只有
 * 下次再点一遍才会进去。读 `window.location.pathname` 是这里唯一不需要
 * 额外上下文就能拿到的信号。
 *
 * 只认 `/map/:microKpId` 一种形状：它是知识点的**详情页**。关卡页
 * `/level/:id` 不是知识点 id，不能混进来。
 */
export function nodeIdFromPath(pathname: string): string | null {
  const match = /^\/map\/([^/?#]+)$/.exec(pathname);
  if (match === null) return null;
  const raw = match[1];
  if (raw === undefined) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
