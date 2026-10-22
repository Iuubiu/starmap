# 暂停快照（服务器更新）

暂停时间：2026-10-22 12:05（Asia/Shanghai）
指令来源：用户「服务器更新，暂停任务」
恢复方式：跟 captain 说「继续」，或对团队用 `agent_teams_resume`（若已被 halt）

---

## 一、工作区状态（暂停这一刻的实测）

```
git HEAD: 945c456 feat(db): 语料分离——英文教材停用并从图谱物理移除，学界面只留 14 本中文书

未提交：133 项 = 83 个未跟踪(??) + 50 个已修改(M)
  .scratch   80   探针脚本、qa 场景、截图、票面文档（多数不必提交）
  content    43   各书 toc.json / chunks.jsonl / manifest.json / glossary.json（t45 前一轮重出的产物）
  apps       10   graph.css / MapPage.tsx / LevelPage.tsx / api 的 gating、placement、agent 等
```

**关键判断：这些改动分属 4 条并发泳道，不要一次性 `git add -A` 提交**。恢复后按泳道逐个收，每条先跑自己的门禁。

启动步骤（服务器回来之后）：

```
pwsh -c "Start-Process 'C:\Users\Yhwhy\scoop\apps\postgresql\current\bin\pg_ctl.exe' -ArgumentList 'start','-D','C:\Users\Yhwhy\scoop\persist\postgresql\data' -WindowStyle Hidden"
cd /d/DeepSeek/starmap && pnpm dev        # api:3001 + web:5173
```

验证：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/api/v1/health` 应为 200。

---

## 二、8 个成员各自停在哪（已逐个确认）

| 成员 | 票 | 停在哪一步 | 恢复后第一个动作 |
|---|---|---|---|
| **ui-dev** | t57 | 只做完调研取证（Fluent 用量统计、27 个 makeStyles 文件 / 370 处 `tokens.*`、7 份 ADR 已读），**未落盘任何文件**（`skills/` 还不存在，`docs/adr/` 仍止于 0007） | 写 `skills/web-design-engineer/SKILL.md`（frontmatter 对齐 `apps/api/src/mastra/skills/question-author/SKILL.md`）+ `docs/adr/0008-raycast-visual-language.md` |
| **integrator** | t61 | 侦察完成，未写脚本、未改文件（`git status --porcelain tools/ingest/` 空） | 写 `tools/ingest/merge_fragments.py`（`--dry-run` 默认、幂等），先把「改 `toc_books.py` 还是加独立 post-process」的取舍写进票面 |
| **agent-dev** | t56 | 代码改完且可编译（`tsc --noEmit` = 0）；新建 `apps/api/src/agent/focus-matcher.ts` + 18 条单测绿；`turn.service.ts` 已接线，既有 25 条接口测试仍绿 | 往 `agent-turns.controller.test.ts` 追加 t56 接口级验收用例 |
| **level-dev** | t51 已 completed | 4 个文件已落盘（web 468 tests + typecheck 6/6 已验证） | 领新活前先等 captain 指派 |
| **graph-dev-2** | t47 | 见其未回的消息；票面记录：A) MapPage body 栅格窄视口单列 + graph.css min-width；B) GraphCanvas 构造前量 offsetWidth，为 0 不建 Sigma + ResizeObserver | 继续 t47 落盘 |
| **authoring-dev** | t43 | 范围已收敛为 S2/S5/S9，在收尾 REPORT.md 与清理调试 spec | 收尾 r43 报告 |
| **reviewer-2** | t55 | 评审 t44（地图 5495 节点「糊成一坨」→「逐点可分」是否真实可用） | 继续评审 |
| **anim-dev** | t60（等 t58） | 被要求在只读准备阶段 | 等 t58 交付后 claim t60 |

---

## 三、票板状态（61 张）

**已完成 40 张**：t1–t16、t18–t33、t34–t42、t44、t45、t48、t49、t51、t52

**取消 3 张**：t17（与 t34 重复）、t46（英文书答案块误标 → 下版本）、t50（依赖已取消的 t46 → 由 t61 替代）、t54（审 t45 → 英文书整体推迟）

**在飞 / 排队**：
- t43 浏览器深度验收（authoring-dev）
- t47 窄视口地图画布塌陷（graph-dev-2）
- t53 地图性能归因（graph-dev-2，排队）
- t55 评审 t44（reviewer-2）
- t56 P0 焦点忽略学习者说的话（agent-dev）
- t57 设计规范 skill + ADR（ui-dev）
- t58 Raycast 一期（ui-dev，等 t57）
- t59 命令面板（ui-dev，等 t58）
- t60 动效系统（anim-dev，等 t58）
- t61 碎名知识点合并（integrator）

---

## 四、恢复后要特别注意的三件事

1. **t61 的验收漏洞已补**（我 amend 过）：原票只断言 `name ~ '^[、，。；：）)]'` 为 0，但看板首推的「作用与地位」**不以标点开头**（它是 `kp-dinghonglin-2010-1-1` 那条 18 字标题的续行），只跑那条 SQL 会绿着放过它。现票面已要求 B 类单独断言、C 类 3 处误报必须排除并给理由、产物不得在重导后退化。

2. **`agent_teams_edit_plan` 在整个团队是坏的**：整批校验会扫到已完成任务 t2 的 `assignee: "graph-dev"`（该成员后来改名 graph-dev-2），任何 operations 都被整批拒绝。改依赖只能「取消 + 重建」（t50→t61 就是这么处理的）。

3. **跑 Playwright 必须带 `--output=../../.scratch/pw-<名字>-<时间戳>`**：多人并发共用 `test-results/` 会互删 trace，伪造出 `ENOENT ... recording*.trace` 的假失败（踩过三次）。

---

## 四之二、成员在暂停前已采到的侦察结论（恢复后直接用，不要重跑）

### reviewer-2 · t55（评审 t44）——证据已采完，只差提交 verdict

真实浏览器 1x 截图像素度量，三组对照：

| 情形 | 斑点簇数 | 最大块占比 |
|---|---|---|
| **现状（t44 修复后）** | **3032** | **0.8%** |
| 环种子对照（退回修复前行为） | 352 | 87.9% |
| 写死 7px 对照 | 240 | 99.4% |

→ 「逐点可分」成立。反向验证（临时植入回归再还原，已确认 `grep -rn "REVIEW TEMP" apps/ packages/` 为空、四个文件 pristine）：
- `layout.test.ts` 把 ring 期望改回 3 → 红（`separable` 0.5444 < 0.75），证明该断言不是恒绿
- 直径写死 7 → 红，证明尺寸断言不是恒绿
- 点击 **8/8** 命中盘内节点、**4/4** 空白角落不误触
- `pnpm --filter @starmap/web test` 468 passed、`typecheck` 6/6（现场重跑）
- `itemSizesReference: 'screen'` 仍在 `apps/web/src/graph/GraphCanvas.tsx:305`

**恢复后动作**：让它提交 verdict + findings（`attempt_id 643032ad-9f04-495a-96dc-b20f3f795486`）。

### anim-dev · t60 前置调研——三个可直接用的事实

1. **现有段切换是同步硬切**：`apps/web/src/pages/LevelPage.tsx:665` 一句 `setFlow(advance(spec, flow))`，零过渡。
2. **已有可复用的相机原语**：`apps/web/src/graph/GraphCanvas.tsx:469-486` 的 `camera.animate({x,y},{duration:350})`。`useCinematicZoom` 应建在它上面，不要另造反例。
3. **全仓几乎无动效**：除 `AppShell` 三行 `transitionProperty:'transform'` 外没有任何动效，**也没有任何 `prefers-reduced-motion` 处理** —— 意味着 reduced-motion 降级要从零建，且它必须覆盖 Fluent 自身动画。

### integrator · t61 侦察（数字已写进票面）

A 类（`name` 以标点开头）**10 处**、B 类（「作用与地位」续行）**1 处**、C 类（宽松判据误报，必须排除）**3 处**。
另有一条待复核：`第一节…` 那 17 条（如「第一节时间检出」）**不是**折行碎片，是整条标题带章节序号、只是序号与标题间无空格；界面里看起来像「第一节」应是显示截断。

## 四之三、暂停期间仍在收尾的两张票

- **t47 已在暂停窗口内结案（graph-dev-2，attempt `4c456641`）**：窄视口（≤400px）画布归零修完。实测（3086 节点真实规模）：
  - 画布宽度 400/375/320px 视口 **0 → 336/311/256**，pageErrors 全部 0
  - 1080/900/600px 从 420/280/180 的窄条 → **776/636/536** 单列
  - 单列后右侧清单高度 **0 → 226px**
  - 验证：`e2e/narrow.spec.ts` 2 passed、graph e2e 28 passed、web 单测 468 passed、typecheck 6/6
  - 未提交改动：`M apps/web/src/graph/graph.css`、`M apps/web/src/pages/MapPage.tsx`、`?? apps/web/e2e/narrow.spec.ts`、票面 `03-knowledge-graph-map.md`（99→133 行）
  - **顺带修的第三个缺陷值得记**：单列后 `.graph-roster` 高度塌成 0，但宽度正常、400 条 `li` 仍在无障碍树里、`isVisible()` 也报可见 —— 只断言宽度是**假绿**。补了 `rosterHeight > 120` 的断言并做反向验证。教训与之前那条同源：**断言"某维度正常"必须选那个维度真的会坏的**。
- **t55 证据已采完（reviewer-2）**，verdict 待提交，数字见上一节。恢复后落库要用 **attempt `643032ad-9f04-495a-96dc-b20f3f795486`**（attempt 5；之前的 `dc0c72a0-…` 已 revoke，用它上报会被判 `stale or foreign source attempt`）。
  - 它倾向给 t44 **pass**，但会写一条 **medium finding（不拦交付）**：`layout.test.ts:309` 的 `separable > 0.75` 断言跑在**合成图**上（`syntheticGraph(5000, 275)` + 60 轮 `forceAtlas2.assign`，投影硬编码 **860×480**），而真实浏览器画布实测是 **780×481**；也不是真 worker supervisor、不是真图。这不影响「反向验证有效」与「逐点可分成立」（像素度量独立佐证），但意味着**这条守门测试对「真图 + 真布局路径」的覆盖是间接的**。改进方向：补一条真图 e2e。

### 两条要记的账（工具坑）

1. **票面里的 verify 命令名不存在**：`pnpm --filter @starmap/web e2e --grep graph` 会报 `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT` —— web 包只有 `test:e2e`。以后写票面 verify 一律用 `pnpm --filter @starmap/web test:e2e`。
2. **`update_task` 的 `changedPaths` 只接受票面 inScope 里的路径**：把票面文档 `.scratch/starmap-core/issues/*.md` 写进 `changedPaths` 会被拒（`is undeclared`）。票面文件的改动要写进 `output` 正文，不要塞 `changedPaths`。

## 五、语料现状（英文书已按用户指令物理移除）

```
sources 128 → 115（13 本英文书 enabled=false，数据保留可恢复）
knowledge_points 7227 → 4030（叶节点 3086）
chunks 96729 → 78204
答案块 20805 → 10991
先修边 278 → 269
```

恢复脚本：`tools/ingest/drop_english.py`（默认 `--dry-run`，防护阀 = enabled 知识点超过 10 个就拒绝运行）。
迁移：`apps/api/migrations/0062_corpus_separation2.*`。
