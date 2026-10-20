/**
 * 浏览器侧的会话标识。
 *
 * ## 为什么放在 localStorage 而不是 React state
 *
 * 票 08 的验收是「产物卡有名字、持久、可回看（**同会话内**）」。卡片本身
 * 存在服务端（`app.agent_turns`），前端只有会话 id。会话 id 若只活在内存里，
 * 刷新一次就换了一个会话，学习日志凭空清空 —— 恰好把「持久」这条验收做没了。
 *
 * ## 为什么不放在 URL
 *
 * URL 里的 sessionId 会被复制粘贴传播出去。学习日志是私人的东西，不该因为
 * 分享一个链接就被别人看见。localStorage 是「这个浏览器」的边界，与产品
 * 定位（单机学习工作站）一致。
 *
 * ## 为什么 id 前缀是 `ses-`
 *
 * 服务端 `app.sessions.id` 是裸 text 主键，没有格式约束。加前缀是为了在
 * 日志和数据库里一眼能认出「这是浏览器生成的会话」而不是别的什么东西。
 */

const STORAGE_KEY = 'starmap.session';

/**
 * 生成一个会话 id。
 *
 * 用 `crypto.randomUUID()` 而不是 `Math.random()`：后者在同一个进程里
 * 生成的序列是可预测的，两个标签页同时打开有碰撞风险，而会话 id 碰撞
 * 会让两个人的学习日志混在一起 —— 这是那种「测试永远碰不到、上线就发生」
 * 的问题。
 */
function newSessionId(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `ses-${random}`;
}

/** 读当前会话 id，没有就建一个并写回。 */
export function currentSessionId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.trim() !== '') return existing;
    const created = newSessionId();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // 隐私模式 / 存储被禁用时 getItem 会抛。此时退化成「每次渲染一个新会话」，
    // 功能不完整但页面不能白屏 —— 学习日志仍然能在本次挂载内工作。
    return newSessionId();
  }
}

/** 换一个会话（页面上「开新会话」用它）。 */
export function resetSessionId(): string {
  const created = newSessionId();
  try {
    window.localStorage.setItem(STORAGE_KEY, created);
  } catch {
    /* 同上：写不进去就只在内存里用 */
  }
  return created;
}
