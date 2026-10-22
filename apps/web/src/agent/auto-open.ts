/**
 * 对话里「该练了」的关卡自动弹出（票 69 / 72）。
 *
 * ## 为什么这件事必须离开组件
 *
 * 「弹不弹」有六七个输入：这是第几张卡、这张卡是不是同一次会话里已经弹过的、
 * 学习者三秒内是不是按过 Esc、输入框里有没有还没发出去的字、t68 的浮层有没有
 * 挂载完。把这些写成 JSX 里的 `if`，它就只活在浏览器里，单测只能靠 `render`
 * 碰运气；而这条链路恰恰是「零点击进入关卡」的唯一入口，判错了只有两种结局：
 * 学生正打字时被抢焦点，或者他刚说「这次不练」又被弹第二次。
 *
 * 所以这一层分两半：
 *
 * - **纯的**：`shouldAutoOpen` / `markOpened` / `closeAutoOpenedLevel`
 *   —— 输入是 `(artifact, state)`，输出是判定与新状态，没有 `Date.now()`、
 *   没有 DOM。单测把 4 类产物、3 秒窗口两侧、草稿在/不在都钉死。
 * - **不纯的**：`offerAutoOpen` / `registerLevelOpener` 这些薄壳，只负责读会话 id、
 *   读输入框、调已经注册的 opener。
 *
 * ## 为什么对话里没有「进入关卡」按钮
 *
 * 用户的原话是：关卡别再跳整页，判定该练了就直接浮出来，对话里不要「打开」。
 * 一个按钮等于把「去做」这一步退回给学习者的记忆（他得记得刚才那张卡说的是
 * 哪个点），也等于承认系统不知道他该不该现在练。所以 `ArtifactCard` 的关卡卡
 * 只留事实（时长、题量、第一步），入口由这里在判定成立时自动打开。
 *
 * 主动使用（关卡市场、复验、地图节点、深链 `/level/:id`）不受影响：那四条是
 * 学习者自己找上门的，仍然走整页路由。浮层只接管「对话里冒出来」这一种。
 *
 * ## 「该练了」这个信号从哪来（票 72 收成一条）
 *
 * 票 69 曾按「产物带『现在开始练』动作」判定；契约 `LevelCardArtifactSchema`
 * 没有 `actions` 字段，于是又退化成看 `lv-ai-` 前缀（按需生成关卡）。那条兜底
 * 留下一个空洞：**手工关卡与既有 `level_card` 既不弹、也没有按钮**（按钮在 69
 * 里删掉了），学习者拿到一张有标题、有理由、没有入口的卡。
 *
 * 票 72 把判定收成一条：**任何 `level_card` 都自动弹**，不再区分来源。理由不是
 * 省事 —— 这张卡出现在对话里的唯一理由就是「这个点现在值得练」，系统既然替
 * 学习者做了这个判断，就不该再让他自己找入口。「生成 / 手工」是服务端的账，
 * 不该漏到「弹不弹」上。
 *
 * 去重与撤销仍然按关卡算：同一会话同一张关卡只自动弹一次（`openedLevelIds`），
 * 3 秒内关掉 = 这次不练（`dismissedLevelIds`）。**手动重开是另一条路**：关卡卡
 * 本体可点（`ArtifactCard.tsx` 的 `role=button`），点它调 `openLevelFromCard` 走
 * 同一个已注册的 opener —— 撤销的是「自动」，不是「可进入」。
 *
 * ## 3 秒撤销窗口
 *
 * 浮层弹出来挡在屏幕正中，学习者可能只是「看一眼，现在不想练」。两种关闭
 * 意图必须分开：
 *
 * - **3 秒内**按 Esc / 点遮罩 = 「这次不练」：该关卡本会话不再自动弹（再弹
 *   就是不听人话）。
 * - **超过 3 秒**关闭 = 「下次再说」：他在里面看过内容了，只是还没准备开始，
 *   后续仍可再弹。
 *
 * 时间由关闭方（t68 的浮层）在关闭时调 `notifyAutoOpenClosed(levelId)` 报上来，
 * 这一层用「打开时刻」算出意图。**关闭事件必须报**，否则该关卡在本会话里一直
 * 被记成「还开着」，不会再弹 —— 这是刻意的保守方向：宁可少弹，不重复打扰。
 *
 * ## 为什么草稿要挡住弹出
 *
 * 最气人的打断不是弹窗本身，是弹窗把正在打的字吞掉、或者抢走焦点。输入框里
 * 有未提交内容时，触发先挂起（`pending`），等草稿空了（提交或清空）再弹。
 * 草稿在 DOM 里（`HomePage` 的 textarea 不属于本票 inScope），所以这里按
 * `aria-label` 读它的值 —— 这是本模块与首页之间唯一的耦合点，写在一个常量里。
 *
 * ## 为什么 prefers-reduced-motion 下仍然弹
 *
 * reduce 降级的是**动画**，不是交互。学习者要的是「现在该练这个点」，把它
 * 变成「不弹了」等于用无障碍偏好换掉功能。浮层的动画降级归 t68 的样式层。
 */
import { useEffect } from 'react';
import type { AgentTurnResponseArtifact } from '../api/generated/model';
import { currentSessionId } from './session';

/** 撤销窗口：窗口内关闭 = 这次不练；窗口外关闭 = 下次再说。 */
export const UNDO_WINDOW_MS = 3000;

/**
 * 首页输入框的定位方式。
 *
 * `HomePage` 在本票 outOfScope 里（ui-lead 正在改页面），所以既不能给它加
 * `data-draft` 也不能把草稿提到 context。用它的 aria-label 读值：改文案的人
 * 只有同时改这里，才不会静默丢掉「草稿挡住弹出」这条行为 —— 而下面
 * `auto-open.test.ts` 里有一条用例渲染了同名 textarea 守着。
 */
export const COMPOSER_TEXTAREA_SELECTOR = 'textarea[aria-label="这一轮想说的话"]';

export type AutoOpenReason =
  | 'open'
  | 'not_level_card'
  | 'already_opened'
  | 'dismissed'
  | 'draft'
  | 'no_opener'
  | 'already_offered';

export interface AutoOpenDecision {
  readonly open: boolean;
  readonly reason: AutoOpenReason;
}

/**
 * 判定用到的全部状态。
 *
 * 全部字段只读、可序列化：单测直接 `createAutoOpenState({...})` 造夹具，不需要
 * 渲染组件，也不需要等 3 秒真实时间过去（时间由调用方以 `nowMs` 传进来）。
 */
export interface AutoOpenState {
  readonly sessionId: string;
  /** 已经自动弹过、还「开着」的关卡（关闭后按意图移除或拉黑）。 */
  readonly openedLevelIds: readonly string[];
  /** 每张关卡被弹出来的时刻，用来算 3 秒窗口。 */
  readonly openedAtMs: Readonly<Record<string, number>>;
  /** 3 秒内被关掉 = 这次不练，本会话不再自动弹。 */
  readonly dismissedLevelIds: readonly string[];
  /**
   * 已经处理过的卡 id。
   *
   * 阻止「同一张卡重渲一次又弹一次」：React 的 effect 每次渲染都会跑，刷新后
   * 从日志恢复的同一张卡也会再挂载一次。按 cardId 记账比按组件挂载次数可靠。
   */
  readonly offeredCardIds: readonly string[];
  /** 输入框里当前未提交的草稿（`''` 表示没有）。 */
  readonly draftText: string;
  /** t68 的浮层是否已经注册了 opener。没注册就退化为不弹。 */
  readonly hasOpener: boolean;
  /**
   * 系统的 reduce 偏好。**不参与判定**：它只影响浮层动画，不影响弹不弹。
   * 留在 state 里是为了让「reduce 下仍然弹」这条验收能在纯函数上被钉住。
   */
  readonly reducedMotion: boolean;
}

/** 关闭浮层的两种意图。 */
export type CloseIntent = 'this_time' | 'later';

export interface AutoOpenOutcome {
  readonly opened: boolean;
  readonly reason: AutoOpenReason;
  readonly levelId?: string;
}

export function createAutoOpenState(overrides: Partial<AutoOpenState> = {}): AutoOpenState {
  return {
    sessionId: overrides.sessionId ?? 'ses-unknown',
    openedLevelIds: overrides.openedLevelIds ?? [],
    openedAtMs: overrides.openedAtMs ?? {},
    dismissedLevelIds: overrides.dismissedLevelIds ?? [],
    offeredCardIds: overrides.offeredCardIds ?? [],
    draftText: overrides.draftText ?? '',
    hasOpener: overrides.hasOpener ?? false,
    reducedMotion: overrides.reducedMotion ?? false,
  };
}

/* ------------------------------------------------------------------ *
 * 纯函数：判定
 * ------------------------------------------------------------------ */

/** 纯判定：这张产物现在该不该弹出。 */
export function shouldAutoOpen(
  artifact: AgentTurnResponseArtifact,
  state: AutoOpenState,
): boolean {
  return evaluateAutoOpen(artifact, state).open;
}

/** 与 `shouldAutoOpen` 相同，但把「为什么」也带出来（单测与日志都用得上）。 */
export function evaluateAutoOpen(
  artifact: AgentTurnResponseArtifact,
  state: AutoOpenState,
): AutoOpenDecision {
  // 生成类型里 artifact 可空；空产物与「不是关卡卡」同样处理。
  if (artifact === null || artifact.kind !== 'level_card') {
    return { open: false, reason: 'not_level_card' };
  }
  // 票 72：任何 level_card 都算「该练了」，不再看动作、也不再看关卡来源。
  const levelId = artifact.levelId;
  if (state.dismissedLevelIds.includes(levelId)) {
    return { open: false, reason: 'dismissed' };
  }
  if (state.openedLevelIds.includes(levelId)) {
    return { open: false, reason: 'already_opened' };
  }
  if (state.draftText.trim() !== '') {
    return { open: false, reason: 'draft' };
  }
  if (!state.hasOpener) {
    return { open: false, reason: 'no_opener' };
  }
  // reducedMotion 刻意不参与：见文件头「为什么 reduce 下仍然弹」。
  return { open: true, reason: 'open' };
}

/* ------------------------------------------------------------------ *
 * 纯函数：状态迁移
 * ------------------------------------------------------------------ */

/** 记下「这张关卡已经弹出来了」。 */
export function markOpened(state: AutoOpenState, levelId: string, atMs: number): AutoOpenState {
  if (state.openedLevelIds.includes(levelId)) return state;
  return {
    ...state,
    openedLevelIds: [...state.openedLevelIds, levelId],
    openedAtMs: { ...state.openedAtMs, [levelId]: atMs },
  };
}

/** 记下「这张卡已经处理过」，防止同一张卡重渲又弹。 */
export function markOffered(state: AutoOpenState, cardId: string): AutoOpenState {
  if (state.offeredCardIds.includes(cardId)) return state;
  return { ...state, offeredCardIds: [...state.offeredCardIds, cardId] };
}

/**
 * 浮层关闭：按「打开到关闭」的间隔算意图。
 *
 * - `< UNDO_WINDOW_MS`：`this_time`，关卡进黑名单，本会话不再自动弹；
 * - `>= UNDO_WINDOW_MS`：`later`，关卡从「开着」里移除但可再次弹。
 *
 * 边界取 `<`：恰好 3 秒算「下次再说」—— 一个真的在浮层里待满三秒的人已经
 * 看过内容了，把他当成「误触」是不合理的。
 */
export function closeAutoOpenedLevel(
  state: AutoOpenState,
  levelId: string,
  closedAtMs: number,
  openedAtMs: number | undefined = state.openedAtMs[levelId],
): { readonly state: AutoOpenState; readonly intent: CloseIntent } {
  const openedAt = openedAtMs;
  const withinWindow =
    typeof openedAt === 'number' && Number.isFinite(openedAt)
      ? closedAtMs - openedAt < UNDO_WINDOW_MS
      : false;

  const openedLevelIds = state.openedLevelIds.filter((id) => id !== levelId);
  const openedAtMsNext: Record<string, number> = {};
  for (const [key, value] of Object.entries(state.openedAtMs)) {
    if (key !== levelId) openedAtMsNext[key] = value;
  }

  if (withinWindow) {
    return {
      intent: 'this_time',
      state: {
        ...state,
        openedLevelIds,
        openedAtMs: openedAtMsNext,
        dismissedLevelIds: state.dismissedLevelIds.includes(levelId)
          ? state.dismissedLevelIds
          : [...state.dismissedLevelIds, levelId],
      },
    };
  }

  return {
    intent: 'later',
    state: { ...state, openedLevelIds, openedAtMs: openedAtMsNext },
  };
}

/** 换会话：所有「本会话不再弹」的记忆清零。 */
export function forSession(state: AutoOpenState, nextSessionId: string): AutoOpenState {
  if (state.sessionId === nextSessionId) return state;
  return createAutoOpenState({
    sessionId: nextSessionId,
    hasOpener: state.hasOpener,
    reducedMotion: state.reducedMotion,
  });
}

/* ------------------------------------------------------------------ *
 * 不纯的薄壳：会话、DOM、已注册的 opener
 * ------------------------------------------------------------------ */

export type LevelOpener = (levelId: string) => void;

let registeredOpener: LevelOpener | null = null;
let pendingArtifact: AgentTurnResponseArtifact | null = null;
let store: AutoOpenState = createAutoOpenState({
  sessionId: safeSessionId(),
});

function safeSessionId(): string {
  try {
    return currentSessionId();
  } catch {
    return 'ses-unknown';
  }
}

/** 当前状态快照（诊断 / 单测用）。 */
export function getAutoOpenState(): AutoOpenState {
  return store;
}

/**
 * t68 的浮层在挂载时注册自己的 `openLevel`，卸载时传 `null`。
 *
 * 这一层不认识浮层、不认识路由：没注册就只是「这次不弹」，不报错、不跳页。
 * 注册晚于触发也没关系 —— 触发发生在 effect 的微任务里，同一 commit 里其它
 * 组件（浮层通常挂在 App 根）的注册 effect 会先跑完。
 */
export function registerLevelOpener(opener: LevelOpener | null): void {
  registeredOpener = opener;
  store = { ...store, hasOpener: opener !== null };
  // 注册之前因草稿挂起的那张：草稿若已清空，现在可以补弹了。
  if (opener !== null) flushPendingAutoOpen();
}

/** 读输入框里未提交的草稿；没有输入框（别的页面）时当作没有草稿。 */
export function readComposerDraft(doc?: Document): string {
  const target = doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!target) return '';
  const element = target.querySelector<HTMLTextAreaElement>(COMPOSER_TEXTAREA_SELECTOR);
  return element?.value ?? '';
}

/** 系统的 reduce 偏好；拿不到就当没有（仍然弹）。 */
export function prefersReducedMotion(win?: Window): boolean {
  const target = win ?? (typeof window === 'undefined' ? undefined : window);
  const query = target?.matchMedia?.('(prefers-reduced-motion: reduce)');
  return query?.matches ?? false;
}

export interface OfferOptions {
  readonly nowMs?: number;
  readonly draftText?: string;
  readonly reducedMotion?: boolean;
}

function openNow(
  artifact: AgentTurnResponseArtifact & { levelId: string },
  nowMs: number,
): AutoOpenOutcome {
  registeredOpener?.(artifact.levelId);
  store = markOffered(markOpened(store, artifact.levelId, nowMs), artifact.cardId);
  pendingArtifact = null;
  return { opened: true, reason: 'open', levelId: artifact.levelId };
}

/**
 * 一张产物到达客户端时的触发入口。
 *
 * 组件在每次渲染时都可以调它：同一张卡（`cardId` 相同）第二次进来会被
 * `offeredCardIds` 直接挡掉，不会弹第二次。
 */
export function offerAutoOpen(
  artifact: AgentTurnResponseArtifact,
  options: OfferOptions = {},
): AutoOpenOutcome {
  store = forSession(store, safeSessionId());
  if (options.draftText !== undefined) store = { ...store, draftText: options.draftText };
  if (options.reducedMotion !== undefined) {
    store = { ...store, reducedMotion: options.reducedMotion };
  }

  const decision = evaluateAutoOpen(artifact, store);
  if (artifact === null || artifact.kind !== 'level_card') {
    // 不是关卡卡：前一张还没轮到的挂起也一并作废（新卡已经替换了旧卡）。
    pendingArtifact = null;
    return { opened: false, reason: decision.reason };
  }

  const levelId = artifact.levelId;
  const pendingCardId = pendingArtifact?.cardId;
  if (store.offeredCardIds.includes(artifact.cardId) && pendingCardId !== artifact.cardId) {
    return { opened: false, reason: 'already_offered', levelId };
  }

  if (decision.reason === 'draft') {
    // 不吞掉正在打的字：挂起，等草稿空了再弹。
    pendingArtifact = artifact;
    return { opened: false, reason: 'draft', levelId };
  }

  if (!decision.open) {
    pendingArtifact = null;
    store = markOffered(store, artifact.cardId);
    return { opened: false, reason: decision.reason, levelId };
  }

  return openNow({ ...artifact, levelId } as AgentTurnResponseArtifact & { levelId: string }, options.nowMs ?? Date.now());
}

/**
 * 草稿清空后补弹挂起的那张。
 *
 * 组件每次渲染都会调一次：`HomePage` 在提交成功后会清空 `utterance`，重新
 * 渲染时这里就读到空草稿，于是浮层在「字已经发出去」之后才出现，不抢输入。
 */
export function flushPendingAutoOpen(options: OfferOptions = {}): AutoOpenOutcome | null {
  store = forSession(store, safeSessionId());
  if (options.draftText !== undefined) store = { ...store, draftText: options.draftText };
  if (options.reducedMotion !== undefined) {
    store = { ...store, reducedMotion: options.reducedMotion };
  }
  if (pendingArtifact === null || pendingArtifact.kind !== 'level_card') return null;

  const decision = evaluateAutoOpen(pendingArtifact, store);
  if (!decision.open) return null;

  const artifact = pendingArtifact;
  const levelId = artifact.levelId;
  return openNow(
    { ...artifact, levelId } as AgentTurnResponseArtifact & { levelId: string },
    options.nowMs ?? Date.now(),
  );
}

/**
 * 浮层关闭时由浮层调用（t68）。
 *
 * 返回 `'this_time'` 表示这次不练（本会话不再弹），`'later'` 表示下次再说。
 */
export function notifyAutoOpenClosed(levelId: string, closedAtMs: number = Date.now()): CloseIntent {
  const { state, intent } = closeAutoOpenedLevel(store, levelId, closedAtMs);
  store = state;
  return intent;
}

/** 手动重开的结果：要么交给浮层打开了，要么压根没有浮层（静默）。 */
export type ManualOpenResult = 'opened' | 'no_opener';

/**
 * 卡片本体被点（或 Enter / Space）时重新打开浮层（票 72）。
 *
 * 撤销的是「自动」，不是「可进入」：`this_time` 关掉的关卡只是不再自动弹，
 * 学习者自己再点卡，仍然要能进去。所以这里**不看** `dismissedLevelIds`，
 * 只用同一个已注册的 opener —— 不新增第二条进入路径。
 *
 * 打开时刻照记（`markOpened`），这样浮层再关闭时 3 秒窗口仍然算得准。
 * 浮层没注册时返回 `'no_opener'`：不报错、不跳页，点上去就是没反应（退化成
 * 「系统还不能弹」而不是「跳到别处」）。
 */
export function openLevelFromCard(levelId: string, nowMs: number = Date.now()): ManualOpenResult {
  store = forSession(store, safeSessionId());
  if (registeredOpener === null) return 'no_opener';
  store = markOpened(store, levelId, nowMs);
  registeredOpener(levelId);
  return 'opened';
}

/** 清空全部记忆（开新会话 / 单测用）。 */
export function resetAutoOpenState(sessionId: string = safeSessionId()): void {  store = createAutoOpenState({ sessionId });
  pendingArtifact = null;
}

/**
 * 关卡卡挂上自动弹出的钩子。
 *
 * 每次渲染都会跑：第一次把卡交给 `offerAutoOpen`，之后每次尝试补弹挂起的那张
 * （草稿提交/清空后）。打开发生在微任务里 —— 那是这一帧所有 effect 都跑完
 * 之后的时刻，t68 的浮层此时一定已经注册好 opener 了。
 */
export function useAutoOpenLevel(artifact: AgentTurnResponseArtifact): void {
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      const env: OfferOptions = {
        draftText: readComposerDraft(),
        reducedMotion: prefersReducedMotion(),
      };
      offerAutoOpen(artifact, env);
      flushPendingAutoOpen(env);
    });
    return () => {
      alive = false;
    };
  });
}
