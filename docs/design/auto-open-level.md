# 对话中自动弹出关卡：交互规格

本文件定义「学习者在对话里问到一个知识点，系统判定该练了，关卡自己浮出来」这条链路的交互规格。
**它是 t68（浮层与镜头）与 t69（触发判定）的共同契约**，也是后来人改这两处时的唯一依据。

行文沿用 `docs/architecture.md` 与 `docs/adr/` 的格式：先给结论，再给理由，最后给取舍代价。
术语以根 `GLOSSARY.md` 为准（**关卡**、**回合**、**会话**、**微知识点**）。

---

## 0. 结论先行

1. **对话里没有「进入关卡」按钮。** 关卡要么由系统在判定成立时自动浮出，要么由学习者从四条主动路径整页进入。二者互不重叠。
2. **自动弹出只接管一种情形**：这一轮产出的 `level_card` 带「现在开始练」这个动作（或它本身是按需当场生成的关卡）。其余三种产物卡、以及所有普通关卡卡都不弹。
3. **弹出与不弹的判定必须是纯函数。** 它决定「正在打字的人会不会被抢焦点」，这种判断不能只活在 JSX 的 `if` 里。
4. **3 秒撤销窗口分开两种关闭意图**：「这次不练」与「下次再说」。这不是同一个防抖的两侧，而是两个不同的产品决定（§2.3）。
5. **reduce 降级的是动画，不是交互。** 浮层照弹、遮罩照暗、模糊照在，只是不播动画且 rAF 调用为 0。

---

## 1. 两种进入模式

### 1.1 边界

| | 对话内自动弹出 | 主动使用 |
| --- | --- | --- |
| 形态 | 浮层（`role=dialog`），**URL 不变**，页面不卸载 | 整页路由，URL 变化，`LevelPage` 全屏 |
| 谁发起 | 系统（`shouldAutoOpen` 判定成立） | 学习者（点了某个入口） |
| 有几次点击 | 0 | ≥1 |
| 关闭后回到哪 | 原页面原地，焦点回锚点 | 浏览器返回 / 页面内返回按钮 |
| 可分享 / 可刷新 | **不能**（URL 没变） | 能（`/level/:levelId` 可直接打开） |
| 可并排看对话 | 能（对话与日志仍在浮层背后可见） | 不能（整页替换） |
| 归谁实现 | t68 的 `LevelOverlay` + t69 的 `auto-open.ts` | 既有路由，本设计**不改** |

**判据一句话**：*这次进入是不是学习者自己找上门的？* 是 → 整页；否（系统替他决定）→ 浮层。

### 1.2 四条主动路径为什么保持整页

| 路径 | 入口代码 | 为什么保持整页 |
| --- | --- | --- |
| **关卡市场** | `apps/web/src/pages/MarketPage.tsx:252` `onRestart={() => navigate('/level/' + levelId)}` | 学习者是在**浏览自己的作品集**，目标可能是「再练一遍」也可能是「编辑」（`:253` 走 `/market/author/...`）。市场页本身是要停留、要对比多个关卡的地方；用浮层盖住它，等于把人赶出他正在挑东西的货架。 |
| **复验** | `apps/web/src/pages/ReviewPage.tsx:306` `detail.items.map(...)` 内联渲染 `QuestionView` | 复验是**跨知识点的交错卷**，不属于任何单个关卡，因此它连 `/level/:levelId` 都不是——它是自己的一页 `/review`（`routes.tsx:54`）。浮层的容器语义是「一个关卡」，塞一份交错卷进去，标题该写哪个知识点就答不上来。 |
| **地图节点** | `apps/web/src/pages/MapPage.tsx:668` → `/map/:microKpId` → `NodeDetailPage.tsx:353` 进关卡 | 地图是**全屏画布**，它的价值在视野本身。浮层会在画布上盖一层模糊，而学习者刚做完的恰恰是「在图上看清这个点的位置」。t68 的镜头转场（地图 ↔ 关卡连续缩放）本来就是为这条路径设计的，用浮层会把这层空间感删掉。 |
| **深链** | `apps/web/src/routes.tsx:51` `{ path: 'level/:levelId', element: <LevelPage /> }` | 深链是**唯一能分享、能收藏、能刷新还原**的关卡入口。浮层不写 URL（t68 验收第 1 条：URL 不变）。若把深链也改成浮层，`/level/:levelId` 就失去意义，而「把这一关发给同学」这件事在本产品里虽然用得少，却是**调试与内容校对**离不开的路径。 |

补充一条**第五条路径**，同样保持整页：批量生成结果页 `apps/web/src/pages/GenerationPage.tsx:263` `onOpen={(levelId) => navigate('/level/' + levelId)}`。理由与市场同：那是一张结果清单，学习者在逐条核对生成质量，不是在「被推荐」。

**结论**：浮层只接管「系统替学习者决定」这一种。四条（实际五条）主动路径不改一行代码。

---

## 2. 时序

### 2.1 一次自动弹出的完整时序

```
学习者        HomePage / TurnLog      auto-open.ts              LevelOverlay (t68)      服务端
  │                  │                     │                          │                   │
  │ 提交这一轮 ─────►│                     │                          │                   │
  │                  │ POST /agent/turns ──┼──────────────────────────┼──────────────────►│
  │                  │◄── 回合响应 ────────┼──────────────────────────┼───────────────────│
  │                  │   artifact.kind='level_card'                   │                   │
  │                  │                     │                          │                   │
  │                  │ 渲染 ArtifactCard   │                          │                   │
  │                  │ LevelCard mount ───►│ useAutoOpenLevel         │                   │
  │                  │                     │ queueMicrotask           │                   │
  │                  │                     │ ① practiceCue()          │                   │
  │                  │                     │ ② evaluateAutoOpen()     │                   │
  │                  │                     │    七条否决（§3）         │                   │
  │                  │                     │ ③ markOpened(nowMs)      │                   │
  │                  │                     │ ④ opener(levelId) ──────►│ openLevel()       │
  │                  │                     │                          │ 遮罩 + 弹出动画    │
  │◄── 浮层可见，焦点移入面板 ─────────────┼──────────────────────────│                   │
  │                  │                     │                          │                   │
  │ ╔════════════════════════════════════════════════════════════════════════════════╗
  │ ║ 撤销窗口 0 ≤ t < 3000ms（自 openedAt 起算）                                    ║
  │ ║   Esc / 点遮罩 / 面板内关闭 → closeLevel()                                     ║
  │ ║   → notifyAutoOpenClosed(levelId, closedAtMs)                                 ║
  │ ║   → closedAt - openedAt < 3000 ? 'this_time' : 'later'                        ║
  │ ╚════════════════════════════════════════════════════════════════════════════════╝
  │                  │                     │◄─────────────────────────│ 收回动画（quick）  │
  │                  │                     │                          │ 遮罩最后撤         │
  │◄── 焦点归还锚点 ─┼─────────────────────┼──────────────────────────│                   │
  │                  │                     │                          │                   │
  │ 作答（浮层内）───┼─────────────────────┼── POST /attempts ────────┼──────────────────►│
  │                  │                     │◄── mastery ──────────────┼───────────────────│
  │                  │ invalidateQueries(mastery / gate / recommendations)               │
  │                  │ 卡片留在 TurnLog（可回看，不随浮层关闭消失）                        │
```

**「状态回填对话」具体指四件事**（关闭之后）：

1. **卡片不消失**：`apps/web/src/agent/TurnLog.tsx:115` 仍按轮次渲染这张卡，它是可回看的事实记录。
2. **掌握度与门控刷新**：`apps/web/src/api/queries/levels.ts:107`（mastery）与 `:185`（gate）在作答结算后失效重取。
3. **推荐刷新**：`apps/web/src/api/queries/graph.ts:94` 失效 recommendations 与 graph —— 否则关掉浮层后看板还挂着「推荐你练刚才那一关」。
4. **自动弹出的会话记忆更新**：`openedLevelIds` 移除该关卡、`openedAtMs` 清掉该条目、按意图决定是否进 `dismissedLevelIds`。

### 2.2 3 秒窗口落在哪一段

窗口**只覆盖「浮层从可见到被关闭」这一段**，不覆盖作答过程。

- 起点：`markOpened(state, levelId, nowMs)` 记录的时刻，即 opener 被调用的那一瞬间（`apps/web/src/agent/auto-open.ts:270`）。
- 终点：浮层关闭回调 `notifyAutoOpenClosed(levelId, closedAtMs)`（`apps/web/src/agent/auto-open.ts:486`）。
- 判定：`closedAtMs - openedAtMs < UNDO_WINDOW_MS`（`apps/web/src/agent/auto-open.ts:85`，值 `3000`）。
- **边界取 `<`**：恰好 3000ms 算「下次再说」。一个真在浮层里待满三秒的人已经看过内容，把他当成误触不合理（`apps/web/src/agent/auto-open.test.tsx:213` 钉着这条边界）。

**为什么是「从打开起算」而不是「从最后一次交互起算」**：后者的含义是「3 秒内没有操作 = 误触」，那会把「正在读第一段讲解」的人算成误触。前者的含义是「3 秒内关掉 = 我没打算进来」，读得久的人自然落在窗口外，这正是我们要的。

### 2.3 「这次不练」与「下次再说」是两个决定

| | 窗口内关闭（`< 3000ms`） | 窗口外关闭（`≥ 3000ms`） |
| --- | --- | --- |
| 意图 | 这次不练（多半是手滑，或现在确实不想练） | 下次再说（看过了，还没准备开始） |
| 本会话是否再自动弹 | **否**，该关卡进 `dismissedLevelIds` | **是**，但受 §3 情形 ② 约束（不连弹） |
| 依据 | 窗口太短会把「我手滑了」当成「我不想学」——学习者要按两次 Esc 才摆脱一个弹窗，是很具体的挫败 | 窗口太长会让「我认真看过了，暂时不学」在几轮之后又被推一次——那是不听人话 |

**这两条是不同产品决定，不是同一个防抖的两侧。** 防抖的语义是「把连续的同一种意图合并成一次」；这里的语义是「**从同一个动作里读出两种相反的意图**」，并且两种意图导出的状态不同。

> **与 §3 情形 ② 的关系（必须一起读）**：「下次再说」的「后续」**不等于「下一轮」**。同一关卡在紧接着的下一轮又产出 `level_card` 时仍然不弹（§3 ②），至少隔一轮之后才可能再弹。否则「下次再说」退化成「每轮都弹一次」。

---

## 3. 不该弹的七种情形

判定入口是 `evaluateAutoOpen(artifact, state)`（`apps/web/src/agent/auto-open.ts:236`），返回 `AutoOpenReason`。

| # | 情形 | 判定依据 | 理由 | 落地状态 |
| --- | --- | --- | --- | --- |
| ① | 不带「现在开始练」动作的 `level_card` | `practiceCue()` 返 `null` → `no_practice_cue` | 普通（种子）关卡卡只是**推荐**，不是**命令**。它出现在对话里是为了让人「决定去不去做」，替他把浮层推上来，等于替他做了决定。 | ✅ `apps/web/src/agent/auto-open.ts:217` |
| ② | 连续两轮同一关卡 | 需比对「上一轮自动弹过的 levelId」 | 同一关连着弹两次，第二次没有任何新信息。学习者会以为系统卡住了，或者以为刚才那次没生效。 | ⚠️ **未覆盖**，见 §3.1 |
| ③ | 同一关卡本会话已弹过 | `openedLevelIds`（还开着）/ `dismissedLevelIds`（窗口内关过）→ `already_opened` / `dismissed` | 会话内重复打扰是最容易让人关掉整个页面的行为。 | ✅ `apps/web/src/agent/auto-open.ts:250`（dismissed）、`:253`（already_opened） |
| ④ | 输入框有未提交草稿 | `draftText.trim() !== ''` → `draft`，并**挂起**该卡 | 最气人的打断不是弹窗本身，是弹窗吞掉正在打的字或抢走焦点。挂起而非丢弃：草稿提交或清空后补弹。 | ✅ `apps/web/src/agent/auto-open.ts:256`、挂起 `:443`、补弹 `:462` |
| ⑤ | 浮层已经开着 | 需比对「当前是否有浮层」 | 两个浮层叠在一起，学习者会不知道该关哪一个；若新关卡顶掉旧关卡，他刚读到一半的讲解就消失了。 | ⚠️ **未覆盖**，见 §3.1 |
| ⑥ | 走的是主动使用路径 | 结构保证：`useAutoOpenLevel` 只在 `ArtifactCard` 里调用（`apps/web/src/agent/ArtifactCard.tsx:213`），而 `ArtifactCard` 只被 `HomePage` 渲染（`apps/web/src/pages/HomePage.tsx:54`） | 市场 / 复验 / 地图 / 深链根本不渲染 `ArtifactCard`，判定无从触发。这是**结构**保证，不是运行时判断——多一条 `if` 就多一处将来会漏的地方。 | ✅ 结构性保证 |
| ⑦ | opener 未注册 | `hasOpener === false` → `no_opener` | t68 的浮层还没挂载、或已被卸载（例如切到别的路由）。此时**退化为不弹**：不报错、不跳页、不 fallback 成整页跳转——后者会把「浮层坏了」变成一个更难查的行为变化。 | ✅ `apps/web/src/agent/auto-open.ts:259`、`:374` |

### 3.1 两处尚未落地的缺口（给 t69）

这两条是**规格已定、实现未跟上**，记在这里是为了不让它们被当成「已经做过了」：

- **② 连续两轮同一关卡**：当前只按 `levelId` 去重「还开着的」与「本会话拉黑的」，没有「上一轮自动弹过谁」的记账。若学习者在窗口外关闭（`later`），下一轮同一关卡再产出 `level_card` 时会再弹。
  最小补法：在 `AutoOpenState` 增加 `lastAutoOpenedLevelId: string | null`，`markOpened` 时写入，`evaluateAutoOpen` 中若 `artifact.levelId === lastAutoOpenedLevelId` 且尚未产生新的学习者回合，则返 `already_offered`。
- **⑤ 浮层已开着**：`openedLevelIds` 记录的是「本会话弹过哪些」，不是「此刻哪一个开着」。若 A 开着时 B 到达，B 会顶掉 A。
  最小补法：`AutoOpenState` 增加 `openLevelId: string | null`（由浮层通过 `notifyAutoOpened` 上报），非 `null` 时任何新关卡都返 `already_opened`。

> 两条都属于 t69 的 `apps/web/src/agent/auto-open.ts`，不在 t68 的浮层里。浮层只负责「被要求打开时正确打开、关闭时如实上报」。

---

## 4. 无障碍

浮层由 t68 实现（`apps/web/src/level/LevelOverlay.tsx`），以下是**规格**，不是建议。

| 要求 | 规格 | 理由 |
| --- | --- | --- |
| 语义 | `role="dialog"` + `aria-modal="true"` + `aria-labelledby` 指向关卡标题元素 | 读屏用户进入浮层时第一句要听到「这是什么」。指向 `title` 而非 `aria-label` 字符串，是为了让标题改文案时无障碍名自动跟上。 |
| 焦点移入 | 打开后焦点移到**面板容器**（`tabIndex={-1}`）或第一个可聚焦控件 | 不移入的话，Tab 会从背后页面的某个位置开始走，读屏用户会以为浮层不存在。移到容器而非第一个按钮：先让人听到标题，而不是先听到「提交」。 |
| 焦点陷阱 | Tab / Shift+Tab 在面板内循环 | 焦点跑到遮罩背后的输入框里，会出现「看得见浮层、却在打字打给背后」的状态。 |
| 背后 inert | 背后内容 `inert`（或 `aria-hidden`），**但输入框保持可见** | 见下条。 |
| 输入框保留可见 | 不用 `display:none` / `visibility:hidden` 抽走背后内容，只 `inert` | 抽走会让背后布局塌陷，浮层关闭时页面跳一下（CLS）。而且学习者需要看到「我刚才打的那句话还在」。 |
| **焦点归还锚点** | 关闭后焦点回到**打开时记录的 `document.activeElement`**；若它是 `body` 或已卸载，回落到对话输入框 `textarea[aria-label="这一轮想说的话"]`（`apps/web/src/pages/HomePage.tsx:499`） | 自动弹出**没有触发按钮**，所以「回到触发处的元素」不能按字面理解。实际最可能的锚点是输入框（学习者刚提交完，焦点还在 composer 一带）。回落到输入框而不是 `body`，是为了让「关掉浮层继续打字」不需要先 Tab 十几次。 |
| Esc | 等价于关闭，且在**捕获阶段**处理 | Fluent 的 `Dialog` 也监听 Esc；浮层必须比背后组件先拿到它，否则会先触发背后某个 `Dialog` 的关闭。 |
| 点遮罩 | 等价于关闭 | 与 Esc 是**两条等价路径**，不是「Esc 是高级用户快捷键」。鼠标用户只有这一条。 |
| 面板内关闭 | 右上角关闭按钮，`aria-label="关闭关卡"` | 第三条等价路径。触屏与读屏用户主要靠它。 |

**三条关闭路径必须导出同一个关闭意图**（都调 `notifyAutoOpenClosed`），否则「用 Esc 关」和「点叉关」会产生不同的会话记忆——那是最难复现的一类 bug。

---

## 5. reduce：降级的是动画，不是交互

`prefers-reduced-motion: reduce` 下：

| 行为 | reduce 下 |
| --- | --- |
| 自动弹出 | **仍然弹** |
| 遮罩压暗 | **仍然生效** |
| `backdrop-filter: blur()` | **仍然生效** |
| 弹出 / 收回动画 | **不播**，瞬时切换（`instant = 0`） |
| `requestAnimationFrame` 调用 | **0** |
| 焦点移入 / 陷阱 / 归还 | 不变 |
| 3 秒撤销窗口 | **不变**（窗口量的是「关得多快」，不是动画多长） |

**为什么 reduce 下仍然弹**：reduce 是「别晃我」，不是「别替我决定」。把自动弹出关掉，等于用无障碍偏好换掉一条功能路径——学习者从此必须自己找路进关卡，而这条路（§1.2 四条）要求他记得刚才那张卡说的是哪个点。那不是尊重偏好，是降级功能。

**为什么 rAF 必须为 0**：只要起了 rAF 循环，就一定有逐帧的工作量；对前庭功能敏感的用户来说，「位移量小到看不见」仍然是一次帧循环。判据是**有没有动画**，不是**动画明显不明显**。

动画数值本身由 `apps/web/src/motion/tokens.ts` 提供（`instant = 0`、`quick = 120`、`standard = 200`、`slow = 350`、`easeOut = cubic-bezier(0.22, 1, 0.36, 1)`），浮层**不允许写字面量毫秒数**。

---

## 6. 文件归属

| 文件 | 归属 | 职责 |
| --- | --- | --- |
| `apps/web/src/level/open.ts` | **t68** | 浮层门面：`openLevel` / `closeLevel` + 订阅。外部只通过它开关浮层。 |
| `apps/web/src/level/LevelOverlay.tsx` / `overlay.css` | **t68** | 浮层本体、遮罩、焦点陷阱、三条关闭路径、reduce 分支。 |
| `apps/web/src/motion/` | **t68** | 动画常量与降级口径（`tokens.ts` 已有；浮层只引用，不改）。 |
| `apps/web/src/agent/auto-open.ts` | **t69** | `shouldAutoOpen` / `evaluateAutoOpen` / `registerLevelOpener` / 3 秒窗口 / 会话去重 / 草稿挂起。 |
| `apps/web/src/agent/ArtifactCard.tsx` | **t69** | 关卡卡只渲染事实，**不含任何「进入关卡」按钮**。 |
| `docs/design/auto-open-level.md` | **t71** | 本文件。 |

**依赖方向是单向的**：`auto-open.ts`（t69）只通过 `registerLevelOpener` 拿到一个 `(levelId: string) => void`，不认识浮层、不认识路由、不认识 DOM。反过来浮层只在关闭时调 `notifyAutoOpenClosed`。

这条线必须保持，理由：t69 的判定能被单测完全覆盖（纯函数，5 类产物 × 7 条否决 × 窗口两侧），而 t68 的浮层能在真浏览器里被 e2e 覆盖（动画起止值、`backdrop-filter`、CLS）。两边一旦互相 import，两类测试都会退化成「渲染整个应用碰运气」。

### 6.1 接线契约（与 t69 已落地的 API 逐字对齐）

t69 已实现完成并被 25 条单测钉住，以下是**实际导出**，t68 按此接：

```ts
import { registerLevelOpener, notifyAutoOpenClosed, type LevelOpener } from '../agent/auto-open';

// LevelOpener = (levelId: string) => void
// 注意形参是「单个 levelId」，不是 `{ levelId }` 对象 —— 浮层的 openLevel 需兼容这个形状。
registerLevelOpener(openLevel);   // 浮层/宿主组件挂载时注册
registerLevelOpener(null);        // 卸载时注销

// 三条关闭路径（Esc / 点遮罩 / 面板内关闭）都调它，closedAtMs 传事件时间戳或 Date.now()
// 返回值即语义，可直接用于文案：
//   'this_time' → 3 秒内关的 =「这次不练」：该 levelId 本会话不再自动弹
//   'later'     → 超过 3 秒    =「下次再说」：后续新的 learning turn 仍可再弹
const intent = notifyAutoOpenClosed(levelId, closedAtMs);
```

三个接线时**必须知道**的行为细节（t69 的既有实现，不是建议）：

1. **注册时机**：`useAutoOpenLevel` 在 effect 里 `queueMicrotask` 之后才调 opener（`apps/web/src/agent/auto-open.ts:505` `:508`）。微任务排在这一帧所有 effect 之后，所以**「浮层在自己的挂载 effect 里注册」也能被同一次提交里排到的弹出看见**。不需要把注册提到模块顶层或 `useLayoutEffect`。
2. **卸载必须注销**：`registerLevelOpener(null)`。否则旧闭包会继续收 levelId，而它捕获的 `setState` 属于已卸载的组件 —— 表现为「切走页面后关卡仍在后台被打开」。
3. **未注册期间不标记已展示**：t69 不会因为 `no_opener` 把该 card 记为已处理，所以**晚一帧注册回来，同一张卡下一次渲染就会补弹**（不会重复：同一 `cardId` 只处理一次，`offeredCardIds` 挡着）。这条决定了 t68 的浮层可以安全地按路由懒挂载。

**关掉浮层后卡片仍在学习日志**（`apps/web/src/agent/TurnLog.tsx:115`），对话里没有任何「进入关卡」按钮 —— t69 已删掉 `ArtifactCard` 里那个 `onClick={() => navigate('/level/' + levelId)}`。

---

## 7. 复盘：为什么最后不是按钮

### 7.1 原本的设计，以及它为什么被否

最初 `apps/web/src/agent/ArtifactCard.tsx` 的关卡卡里有一个主按钮「进入关卡」，点了 `navigate('/level/' + levelId)` 整页跳走。它的理由写在当时的注释里，而且是成立的：*一张卡产出了关卡却没给入口，等于把「去做」这一步退回给记忆。*

**用户看过之后明确否掉了它**，要求是「关卡别再从对话里跳走，判定该练了就直接浮出来，对话里不要『打开』」。这条要求的实质是**沉浸感**：对话是一个连续的空间，一次整页跳转把它切断，回来时学习者要重新找回刚才说到哪。

于是入口从「按钮」变成「系统判定」：

- 按钮把「现在该不该练」这个判断推给了学习者——而系统本来就有足够信息（这是按需生成的关卡、这个点刚被问到、这个会话还没练过）。
- 按钮还会在「正在打字」的时候和输入框抢注意力，而自动弹出可以**等到草稿空了再弹**（§3 ④）——按钮做不到这一点。
- 按钮是永久的，判定是一次性的：`offeredCardIds` 保证同一张卡不会弹第二次，而按钮会一直挂在那里，每次滚回去都重新勾引一次。

**代价**：系统判断错的时候，学习者没有「我本来就不想点」这个退路。这就是 3 秒窗口与七条否决存在的原因——它们不是锦上添花，是这个设计能成立的前提。

### 7.2 两种模式的取舍代价

| 代价 | 谁承担 | 缓解 |
| --- | --- | --- |
| **浮层里不能分享 URL**：URL 没变，复制地址栏得到的是对话页 | 需要把某一关发给别人 / 自己收藏的人 | 深链 `/level/:levelId` 仍然有效（§1.2 第 4 条）。要分享时从地图节点或市场进入，那两条路径的 URL 是完整的。 |
| **深链仍走整页**：从 `/level/x` 打开不是浮层 | 刷新页面的人 | 这是刻意的：刷新后没有对话上下文，浮层盖在一片空白上比整页更怪。 |
| **浮层关闭后卡片还在**，但不再有入口按钮 | 想重进这一关的人 | 走地图节点（该点会显示已解锁）、市场（自制关卡）、复验（到期时）。卡片本身是可回看的事实记录，不是入口。 |
| **判定逻辑分散在两处**（纯函数 + 薄壳） | 维护者 | 这是为了可测性付的价：`apps/web/src/agent/auto-open.ts` 里 `evaluateAutoOpen` 全部是纯函数，薄壳只有 `offerAutoOpen` / `flushPendingAutoOpen` / `notifyAutoOpenClosed` 三个。 |
| **reduce 下仍然弹**，可能让偏好「零打扰」的用户不满 | 前庭敏感用户 | 用 Esc 一次关掉即可；且窗口内关闭会拉黑该关卡本会话。若将来要提供「本会话不再自动弹」的全局开关，入口应放在设置里，**不是**把 reduce 当成那个开关。 |

### 7.3 一个已知的契约缺口

`packages/api-contract/src/domains/agent.ts:55` 的 `LevelCardArtifactSchema` **没有 `actions` 字段**，而 `AgentCardActionKindSchema`（`:39`）只有 `retry` / `show_evidence` 两种，服务端 `defaultActions`（`apps/api/src/agent/artifact.ts:196`）也从不下发「现在开始练」。

因此当前「该练了」的信号有两级取法（`apps/web/src/agent/auto-open.ts:217`）：

1. 产物**带** `actions` 时以它为准（`kind === 'start_practice'` 或 `label === '现在开始练'`）；
2. 产物**不带** `actions` 时，退一步看关卡 id 前缀 `lv-ai-`（`apps/api/src/generation/generation.workflow.ts:143` 的 `generatedLevelId()`）——按需生成的关卡本身就是「这个点现在就该练」的证据。

第 2 级是**当前契约下唯一能让自动弹出真正发生**的路径。补齐正路的最小改动是：契约给 `level_card` 加 `actions`，`turn.service` 对 `level_card` 下发 `[{ kind: 'start_practice', label: '现在开始练', enabled: true }]`，然后删掉第 2 级兜底。那件事同时要改契约与 `apps/api`，不在 t68 / t69 / t71 任何一张票的 inScope 内。
