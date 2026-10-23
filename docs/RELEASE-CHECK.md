# 发布前自检（RELEASE-CHECK）

> 整理时间：2026-10-23。范围：本轮从「票 01 走通骨架」到「v2 外壳 + 动效系统」的全部改动。
> 本文件只写**能被执行或能被复核**的东西：每个数字给出来源命令，每条遗留给出为什么没做。

---

## ① 本轮真正交付了什么

### 门禁现状（本次实测，全部 exit 0）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 七段全量 | `node scripts/verify.mjs` | **7/7 通过，285s**（日志 `.scratch/qa/t90-verify-1.log`） |
| 类型检查 | `pnpm typecheck` | 6/6 包无错（含 `apps/web`、`apps/api`） |
| 依赖边界 | `pnpm check:boundaries` | 848 modules / 1664 dependencies，0 违规 |
| 契约同步 | `pnpm contract:check` | 120 个组件全部有来源，1 个已交代豁免，457 个产物已同步 |
| 迁移 | `pnpm check:migrations` | 25 个迁移编号无冲突，25 对 up/down 全配对，95 项「建了什么」回滚后零残留 |
| 单元测试 | `pnpm test` | **1739 passed**：web 847、api 498、engine 242、eval 117、shared 32、api-contract 3 |
| 内容管线 | `pnpm verify:py` | 382 passed |
| 端到端 | `pnpm test:e2e:smoke` | 13 passed |

### 交付面（按能力，附提交与库内实测数字）

| 能力 | 落地 | 数字 / 证据 |
|---|---|---|
| 知识图谱 | 全量抽取 + 客户端 FA2 布局 + sigma 渲染（`apps/web/src/graph/**`） | 库内 `app.knowledge_points` **4029** 行、`app.kp_edges` **269** 行；`/map` 首屏渲染 3085 个节点（`data-node-count`），1x 下自动贴标签 9 个 |
| 学科内容 | OCR/入库管线 + 内容库页（`tools/ingest/**`、`96c5780`） | `app.chunks` **78204** 行、`app.course_layers` **8** 层；碎名合并 **11 处 → 1 处真折行**（`92c1c94`） |
| 关卡系统 | 七段流程 + 关卡浮层 + 掌握判定 + 退出闸门（`ab20b01`、`1b8089f`） | `app.levels` **9** 关；`LevelOverlay` 进入 200ms / 飞行 350ms / 退出 120ms |
| 学习机制 | 三档 `TIER_PARAMS` + 双 mastery（`achieved` 不衰减 / `current` 衰减）+ 1/3/7/21/60 复验 | `packages/engine/src/tier.ts` 单一真源，engine 242 条单测 |
| 智能体 | 结构化回合 + RAG 闸门 + 苏格拉底阶梯（`apps/api/src/agent/**`） | `app.agent_turns` **567** 行；api 498 条单测 |
| 三档仿真评估 | 三档 persona 全流程跑通 + judge 自检（`tools/eval/**`、`docs/eval-report.md`） | 最近一次 `run_id=20261022-034205-all`，三档 `failures=0`，judge 自检 **3/3** |
| 视觉主题 | 双主题 token 单一真源（`54b8c5c`，12 文件 +2148/−13）+ 关卡页双主题（`1b8089f`）+ 深色对比度 **4.45 → 4.71**（`0e0a883`） | web 847 条单测含主题对拍；`zz-theme` 3 passed |
| v2 外壳 | 四列骨架 + 毛玻璃 + 真建议 + 会话列真数据（`f733852`、`1f04004`、`26d9a03`、`72b5387`） | `/` 走 `HomeV2`，其余页面暂留 `AppShell`（见 ②-3） |
| 动效系统 | 连续缩放镜头 + 阶段转场 + 计数滚动（`07cc10c`，2444 insertions） | 三节点转场 **36–37 帧 / p50 16.7ms（60fps）/ longtask 0**（`.scratch/qa/zoom-fps-probe.mjs`，Intel Arc D3D11，1280×800） |
| 地图检索 | 清单搜索 + 悬停名牌（`1f6cb37`） | 清单分批 400 条；搜索支持中文名 / 拼音首字母 / id |
| 关卡卡版式 | 对齐设计稿样例（`dd0d87f`） | padding 20/22 → **16/18**、圆角 10 → **14**、上限 720 → **690**；v2 内容列 920 → **1180**（`c2d4a0b`） |

### 收口动作（本次）

| 动作 | 结果 |
|---|---|
| 未提交项归档 | 本次 4 个提交：`1f6cb37`（t86 图谱检索）、`dd0d87f`（t87 关卡卡）、`7ef7fff`（设计文档）、本文件（docs 提交）；t60 动效随 `07cc10c` 入库，v2 两文件由 captain 随 `8ec9926` 入库。归档前逐路径 `git log --oneline -1 -- <path>` 核对过归属 |
| 迁移自检 | `pnpm db:migrate` → 「数据库已是最新（25 个迁移全部已应用）」 |
| 构建自检 | web `✓ built in 1.20s`（`dist/assets/index-Bo_B5B9K.js` 1,676.53 kB / gzip 462.73 kB）；api `tsc -p tsconfig.json` 无输出即无错 |

---

## ② 已知遗留与为什么

1. **图谱连线覆盖率低（t74 重审）**：4029 个知识点只有 269 条边，覆盖率 6.7%。
   原因：抽取阶段只提「显式先修」，暗含的并列/对比关系没有入边；提高召回需要重跑
   一轮带人工抽检的抽取，不是改一个阈值能解决的。**现状可用但导航价值打折**。

2. **t50 碎名**：`92c1c94` 已处理 11 处疑似折行，其中只有 1 处是真的行内折行，其余是
   OCR 吞了编号（例：「2.1 噪声」被读成「噪声」）。原因：OCR 无法区分「编号被吞」
   与「名字本身就这么短」，只能人工回填。**未回填的条目仍在库内**，按 `microKpId`
   可定位。

3. **v2 外壳与旧 AppShell 并存（技术债）**：`apps/web/src/routes.tsx:40-42` 写明
   `/`（学习页）挂在 `AppShell` **外面**、自带四列外壳，其余页面仍走 `AppShell`。
   原因：外壳重写是增量迁移，一次性替换 9 个页面会同时引入 9 处回归；现在两套样式
   （`v2/v2.css` 与 `theme/*.css`）并存，输入区已经去重到 `components/Composer.tsx`
   + `theme/glass.css`（`07cc10c` 前那次 -163 行）。**下一次重构应以「删掉 AppShell」为目标**。

4. **动效 hook 没有产品调用点**：`motion/` 有 68 条单测、`useRouteTransition()` /
   `useCinematicZoom()` 都有真实实现，但原票约定的 `motion/seams.ts` 从未落盘，
   `AppShell` / `App.tsx` / `routes.tsx` 里也没有调用点。原因：接线属于外壳范围，
   t60 按范围约束不越界。**需要一个「动效接线票」把两个 hook 接到路由切换与关卡转场上**，
   否则用户看不到 60fps 的镜头运动 —— 它现在只能由 `zz-motion` 门禁驱动。

5. **帧率门禁不在 `verify` 里**：headless Chromium 默认走 SwiftShader 软光栅，
   `/map` 只有 4–5fps（p50 233ms），必须带
   `--use-gl=angle --use-angle=d3d11 --ignore-gpu-blocklist --enable-gpu-rasterization`
   才是真实 GPU 路径（Intel Arc，p50 16.7ms）。原因：共享 Playwright config 不能为
   单个用例改 launch 参数，且带 GPU 的浏览器在 CI 上不一定可用。**帧率结论必须用
   `zz-motion` 单跑，不能引用 `verify` 的 e2e 段**。

6. **主题默认 `system → light`**（`56b7d08`、`theme/initialTheme.ts:35,38`）：用户没选过
   时跟随系统，系统读不到时回落浅色。深色仍是 T58 那套 token，**没有跟随 v2 浅色外壳
   重做深色版** —— 深色下 v2 的毛玻璃层次会比浅色弱一档。

7. **判分漂移不可复现**（`docs/eval-report.md`）：同一版代码同一批输入跑五次，P1 的
   Fleiss κ 出现 `null / -0.20 / +1.00 / +0.53 / null`，四维分 CV 0.046–0.184（达标线 ≤0.05）。
   原因：judge 是被模型调用本身的不确定性支配的，工具层无法消除；报告采取的做法是
   **不把 κ / CV 当产品结论**，只用「识别率跨五次 6/6 相同」这类可复现指标。

8. **未提交项**：归档结束时工作区只剩 `.scratch/qa/**` 的 157 个未跟踪产物与 25 个
   已跟踪截图改动，按「截图 / 探针不入库」惯例保留在工作区。`apps/web/src/v2/**` 的两处
   在飞改动由 captain 在归档期间自行入库（`8ec9926`，t88+t89），我**未改动该目录**。
   **`.gitignore` 只覆盖 `.scratch` 顶层产物，不覆盖 `.scratch/qa/**`** —— 是否扩规则
   涉及全仓策略，留给 captain 决定。

---

## ③ 复现命令清单

以下命令都从仓库根目录执行，Windows / POSIX 通用（`pnpm` 脚本内部已处理 shell 差异）。

### 起库（本机 Postgres，`DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/starmap`）

```bash
pnpm db:migrate          # 25 个迁移，幂等；期望末尾「数据库已是最新」
pnpm db:seed             # 种子数据（关卡 / 演示用知识点）
```

### 起服务（一条命令带前置检查）

```bash
node scripts/dev.mjs     # 先验 DB 可连 → 跑迁移 → 起 api:3001 与 web:5173
```

单起：`pnpm dev:api`（3001）/ `pnpm dev:web`（5173）。

### 跑门禁

```bash
node scripts/verify.mjs                                   # 七段全量，约 285s
node scripts/check-migrations.mjs                          # up/down 对与回滚残留
pnpm --filter @starmap/web build && pnpm --filter @starmap/api build
```

### 跑动效与帧率探针（需要 GPU 参数，见 ②-5）

```bash
# 头号数字：三节点连续缩放期间的真实帧率（Intel Arc / 1280×800）
node .scratch/qa/zoom-fps-probe.mjs

# 对照：同一台机器上 SwiftShader 与 GPU 的差别（证明 4–5fps 是测量环境问题）
node .scratch/qa/fps-probe.mjs

# 门禁本体：三帧截图 + 帧率断言 + reduced-motion 断言
cd apps/web && npx playwright test --config=../../.scratch/qa/playwright.config.ts zz-motion \
  --output=../../.scratch/pw-motion
```

### 跑三档学生仿真评估

```bash
node --env-file-if-exists=.env tools/eval/src/run.ts --persona all --output .scratch/eval-<时间戳>
```

> 不要写成 `pnpm --filter @starmap/eval run -- --persona all`：`run` 是 pnpm 内建子命令，
> `--` 之后的参数会被当成字面量。产物落在 `.scratch/`（已忽略），报告模板见
> `docs/eval-report.md`。

### 跑浏览器验收矩阵

```bash
cd apps/web && npx playwright test --config=../../.scratch/qa/playwright.config.ts \
  --output=../../.scratch/pw-qa
```

> 共享配置固定 `baseURL=http://localhost:5173`、`workers=1`、`timeout=120s`；**必须显式
> 传 `--output`**，否则会写进默认目录与其它泳道互相覆盖。
