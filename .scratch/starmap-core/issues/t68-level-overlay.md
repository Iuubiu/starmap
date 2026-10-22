# t68：关卡浮层容器 + 两段空间连续动效

**状态**：已实现（浮层 + 两段动效 + 11 条验收逐条取证）

## 契约

- **kind**: implementation
- **inScope**（team.json 原文 6 条）：
  - `apps/web/src/level/LevelOverlay.tsx`
  - `apps/web/src/level/LevelOverlay.test.tsx`
  - `apps/web/src/level/open.ts`
  - `apps/web/src/level/open.test.ts`
  - `apps/web/src/level/overlay.css`
  - `apps/web/src/motion/`
- **captain 口头批准的最小扩围**（rev2 之后，m04637 一类的裁定）：
  - `apps/web/src/pages/MapPage.tsx` —— 只加 `cameraRef` 与 `provideFlightCamera` 登记
  - `apps/web/src/App.tsx` —— 只加 `<LevelOverlayHost />` 一行（与 `CommandPaletteHost` 并列）
  - `apps/web/e2e/overlay.spec.ts` —— 新建
  - `apps/web/src/pages/LevelPage.tsx` —— **批准了但最终没用上**（见下）
- **verify**：
  1. `cd apps/web && npx vitest run src/level/ src/motion/`
  2. `cd apps/web && npx playwright test e2e/overlay.spec.ts --output=../../.scratch/pw-overlay-$(date +%s)`
  3. `pnpm --filter @starmap/web typecheck`

## 交付

### 新增文件

| 文件 | 作用 |
| --- | --- |
| `apps/web/src/level/open.ts`（104 行） | 浮层门面：`openLevel` / `closeLevel` / `subscribeLevelOverlay` / `getOpenLevel` / `getServerSnapshot` / `resetLevelOverlay`。模块级单一 `current`，`openLevel` 幂等（同一关不重播动画） |
| `apps/web/src/level/open.test.ts`（11 tests） | 幂等 / 替换不重播 / 关闭 / 退订 / 多订阅者 / 服务端快照 |
| `apps/web/src/level/LevelOverlay.tsx`（约 350 行） | 浮层本体：`LevelOverlayHost` 挂在 `App.tsx`，`createPortal` 到 `document.body`，内套 `MemoryRouter` 复用 `LevelPage` |
| `apps/web/src/level/LevelOverlay.test.tsx`（20 tests） | 渲染/卸载、reduced 分支、焦点归还、Tab 陷阱、三条关闭路径、动画参数 |
| `apps/web/src/level/overlay.css`（185 行） | 遮罩（`--sm-overlay-blur: 12px` + `backdrop-filter` + `@supports not` 兜底）、面板、头部、关闭按钮、正文。**全部走 `--sm-*` token，零字面量颜色** |
| `apps/web/src/motion/camera-flight.ts` | 镜头通道：`provideFlightCamera(ref)` / `activeFlightCamera()` / `flyIn` / `flyOut` / `resetFlightCamera` |
| `apps/web/src/motion/camera-flight.test.ts`（13 tests） | 登记/注销、ref 语义、推近只改 ratio、reduce 下只 `setState` 不 `animate` |
| `apps/web/e2e/overlay.spec.ts`（9 tests） | 真浏览器里量 `backdrop-filter`、WAAPI 关键帧与时长、`inert`、CLS、sigma 相机 |

### 最小接线（2 个既有文件）

```tsx
// apps/web/src/App.tsx —— 与 CommandPaletteHost 并列
<CommandPaletteHost router={router} />
<LevelOverlayHost />

// apps/web/src/pages/MapPage.tsx —— 登记「此刻活跃的相机」
const cameraRef = useRef<CinematicCamera | null>(null);
useEffect(() => {
  provideFlightCamera(cameraRef);
  return () => provideFlightCamera(null);
}, []);
<GraphCanvas ... cameraRef={cameraRef} />
```

**`apps/web/src/pages/LevelPage.tsx` 最终没有改动。** rev2 曾准备把
`function LevelSession(` 改成 `export function LevelSession(`，好在实现时发现
`LevelPage` 本身已经 export，而它取 `levelId` 走的是 `useParams` ——
`MemoryRouter` 里给它一条 `/level/:levelId` 就够，不必导出内部组件、
也就没有「导出半成品页面组件」这个额外接口面。少改一个文件，少一处将来会被
误用的入口。

## 验收逐条对照

| # | 验收 | 证据 |
| --- | --- | --- |
| 1 | URL 不变、页面不卸载、草稿保留 | `overlay.spec.ts` 第 1 条：`expect(page.url()).toBe(urlBefore)`、`main` 数量不变、`toHaveValue('浮层打开之后这段话必须还在')`、`#root` 带 `inert` 且输入框仍 `toBeVisible()` |
| 2 | blur ≥ 8px + 两主题各自遮罩色 | 第 3 条：先钉 `data-sm-theme='dark'` 读一次、再钉 `'light'` 读一次，两次 `backdropFilter` 的 `blur(Npx)` 都 ≥ 8，且 `light.background !== dark.background`（`rgba(5,5,8,0.72)` vs `rgba(18,18,22,0.32)`） |
| 3 | opacity 0→1 / scale .96→1 / translateY 16px→0，standard + easeOut，无字面量毫秒 | 第 4 条读 `getAnimations()[0].effect`：`duration === 200`、`easing === 'cubic-bezier(0.22, 1, 0.36, 1)'`、首帧 `opacity 0` + `scale(0.96)` + `translateY(16px)`、末帧 `opacity 1` + `scale(1)` + `translateY(0px)` |
| 4 | 收回更快（quick）且遮罩不提前撤 | 第 5 条：点关闭后立刻读，`scrimStillThere === true`、`panelStillThere === true`、`duration === 120`；播完才 `toHaveCount(0)` |
| 5 | Esc / 点遮罩 / 面板内关闭三条路径 + 焦点归还 | 第 6 条：三条路径各跑一遍，每次 `document.activeElement` 的 `aria-label === '这一轮想说的话'`，且 `#root` 的 `inert` 已撤 |
| 6 | role=dialog + aria-modal + aria-labelledby + 焦点移入 + Tab 陷阱 + 背后 inert 但输入框可见 | 第 2 条（dialog/aria-modal/aria-labelledby 指向真标题/焦点在面板容器）+ 第 1 条（inert + 输入框可见）+ 单测 `LevelOverlay.test.tsx` 的 Tab/Shift+Tab 两条 |
| 7 | reduce 下 0 动画 0 rAF 但遮罩模糊仍在 | 第 8 条：`page.emulateMedia({ reducedMotion: 'reduce' })` 后 `getAnimations()` 里**没有任何 `Animation` 构造器实例**、也没有 `duration > 1ms` 的条目；遮罩 `blur >= 8px` 仍在；关闭同样瞬时 |
| 8 | 地图→关卡真驱动 sigma 相机 | 第 7 条：`/map?hops=all` 读到 `data-camera-ratio`，开浮层后 `expect.poll(...).toBeLessThan(ratioBefore)`，关闭后 `toBeCloseTo(1, 1)`。**CSS 假缩放改不动这个属性**，它只由 sigma 相机写 |
| 9 | CLS < 0.01 | 第 9 条：`PerformanceObserver` 收 `layout-shift`（跳过 `hadRecentInput`），开浮层 + 等 1.5s 后 `__cls < 0.01` |
| 10 | 单测覆盖渲染卸载 / reduced / 焦点归还；e2e 量 backdrop-filter 与 transform 起止值 | `LevelOverlay.test.tsx` 20 条 + `overlay.spec.ts` 9 条（见上） |
| 11 | 不实现「何时弹出」与入口按钮 | 本票没有触碰 `agent/auto-open.ts`、`agent/ArtifactCard.tsx`、`HomePage`；触发时机归 t70 |

## 实测数字

```
cd apps/web && npx vitest run src/level/ src/motion/
  → Test Files 12 passed (12) / Tests 171 passed (171) / 18.79s

cd apps/web && npx playwright test e2e/overlay.spec.ts --output=../../.scratch/pw-overlay-<ts>
  → 9 passed (42.3s)

pnpm --filter @starmap/web typecheck
  → exit 0（无输出）
```

## 三个坑（都留了注释，避免后人重踩）

### 1. `e2e` 里进不去对话页：`FirstVisitGate` 把 `/` 换成了 `/welcome`

`apps/web/src/routes.tsx` 的 `index` 路由包着 `FirstVisitGate`，它读
`localStorage.profileDone`，没有就 `<Navigate to="/welcome" replace />`。
Playwright 每次都是全新 context，所以 `goto('/')` 落地是欢迎页，
`textarea[aria-label="这一轮想说的话"]` 永远不出现（首跑 8 条红全卡在这一步）。

修法：`page.addInitScript(() => window.localStorage.setItem('profileDone', '1'))`
—— 「假装这个学生已经走过初识」，不绕过被测逻辑。

### 2. reduce 下 `getAnimations()` 不是空的，但那些不是浮层发的

`theme/tokens.css` 的全局 reduce 块把 `*` 的 `animation-duration` /
`transition-duration` 压到 `0.01ms !important`。面板拿到焦点时，
`:focus-visible` 的 `outline-color` / `outline-offset` / `outline-width`
三条 **`CSSTransition`** 因此以 `0.01ms` 出现在 `getAnimations()` 里
（实测 3 条，`playState: 'running'`，`duration: 0.01`）。

断言因此不能写 `length === 0`，而应筛「构造器是 `Animation`（WAAPI）」或
「`duration > 1ms`」—— 这两条都只剩浮层自己发的动画，reduce 下必须为空。

### 3. 遮罩色不能「默认深色」直接读

`ThemeProvider` 的 `mode` 默认是 `'system'`，Playwright 默认
`colorScheme: 'light'` → 落地就是亮色，硬等深色会读到亮色值
（首跑 `expected not "rgba(18, 18, 22, 0.32)"` 就是这个）。

修法：用 `document.documentElement.dataset.smTheme = 'dark' | 'light'`
显式钉住两次再各读一次 —— 这正是 `applyThemeToDocument` 写入的那个属性面。

## 已知边界（如实记录）

- **浮层里的「下一关」会退出浮层**：`LevelPage` 的 `SummaryPanel` 仍是
  `navigate('/level/<next>')`，在 `MemoryRouter` 里没有这条路由，兜底
  `CloseOnNavigate` 会关掉浮层。这是「浮层内复用 `LevelPage` 而不是让页面
  认识浮层」的直接后果，已由 captain 明确接受。要改成幂等替换需动
  `LevelPage.tsx` 的 `SummaryPanel`，不在本票 scope。
- **`openLevel(` 字面量只能出现在 `level/open.ts`**：`agent/auto-open.test.ts`
  有一条守门测试（正则 `/(?<![\w.])openLevel\s*\(/`）会扫描全 `src/`。
  其它文件要用别名导入。
- **`camera-flight` 存的是 ref 不是实例**：`GraphCanvas` 重建画布会换实例、
  卸载置 `null`，存实例会让浮层飞给一个已被 `kill()` 的幽灵。
- **浮层宿主挂在 `App.tsx`**：`createRoot` 自挂会同时丢掉 `QueryClientProvider`
  与 `ThemeProvider`（浮层要发 `useLevel` 请求、要读 `--sm-*` token）。
