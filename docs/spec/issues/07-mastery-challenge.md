# 07: 掌握度复验与间隔排期

**What to build:** 已掌握的微知识点会按 1/3/7/21/60 天回来找你；没通过就往下调 `current`，但 `achieved` 一动不动。

**Blocked by:** 05

**Status:** ready-for-agent

- [x] 到期的已掌握微知识点被复验抽到，每次 3–5 题，多个知识点交错出现而不是同一个连考
- [x] 间隔按 1/3/7/21/60 天推进；通过则推进到下一个间隔，未通过则回到更早的间隔
- [x] 未通过时按错题数量下调 `current`；`achieved` **不得**被下调
- [x] 复验结果与普通作答共用同一套 BKT 更新路径，不另起一套算法
- [x] 图谱上「需复验」状态与到期判定一致，不会出现图谱说有、抽考说没有

## Comments

### 一、排期是「存下来的时刻」，不是「待触发的闹钟」

`packages/engine/src/review.ts` 是纯函数包（无 IO、无 `Date.now()`、无定时器），
导出 `REVIEW_INTERVALS_DAYS = [1,3,7,21,60]`、`initialReviewSchedule`、
`advanceReviewSchedule`、`isReviewDue`、`overdueDays`、`selectReviewItems`、
`interleaveReviewItems`，27 条测试。

不引 cron、不用 Mastra Workflow 做定时，理由与 ADR-0003 同源：后台任务**有状态**
——要知道上次跑到哪、漏跑怎么补、多实例只跑一次，三种错法都很难被发现。而
「下次什么时候该复验」只是一个时刻，存进 `app.mastery.next_review_at`，
查询时用 `<= now` 比较即可；进程崩了、多实例、重放历史都不改变结论。
代价是「到期」只在有人查询时有意义——对一个学习工作站完全成立。

### 二、读路径一行未改，验收第 5 条因此天然成立

`app.mastery.next_review_at` 由 0003 建、0003 的注释已经写明「**加列的是 03，写列的
是 07**，两边共用同一列、同一个 `<= now` 比较，才不会有第二套判定」。所以本票：
- 写入：`apps/api/src/review/repository.ts` 的 `setReviewSchedule`（唯一写点）
- 读取：`graph.controller.ts:125` 透出 `reviewDueAt`、`recommend.service.ts:238` 读
  `next_review_at`、前端 `apps/web/src/graph/status.ts:66` 用 `<= now` 判「需复验」
  —— **全部是既有代码，本票未动一个字符**。

补上了票 03 留的假绿：`review.controller.test.ts` 里那条用例从**作答**开始，让
`ensureInitialReviewSchedule` 自己落下排期，把 `next_review_at` 拨到过去，再调
`GET /api/v1/graph` 断言该节点的 `reviewDueAt` 非空且 `<= now`；反向拨到未来后断言
图谱是未来时刻且 `GET /review/queue` 返回空数组。两条路径读的是同一列、同一个比较。

### 三、复验作答走 `POST /api/v1/attempts`，不另开判分端点

验收第 4 条要「共用同一套 BKT 更新路径」。实现上不是「复用代码」而是**复用同一个
端点**：`AttemptSubmitRequestSchema` 加一个可选 `reviewRoundId`，`attempts.service.ts`
里只多两处——认领校验（`requireReviewClaim`：会话存在、这道题真在本轮题单里、
会话还没判分，全部 422）与 `counts_toward_mastery` 强制为 true。判题、事务、
`replay` + `upsertMastery` 一行没变，所以「复验里的作答」与「关卡里的作答」在库里
是同一张表、同一列、同一套回放算法。

**为什么不是 `POST /levels/{id}/attempts`**：作答归属是微知识点，关卡只是地点；
复验题本来就是从普通关卡里抽的，挂关卡下会让「这道题做过几次」变成跨关卡并集查询。

### 四、`review_stage` 必须单独存，不能从时间反推

`next_review_at` 只说明「下次什么时候」，说不出「现在在第几档」——同一个时刻既可能
是第 2 档（3 天）也可能是第 4 档（60 天）之后，取决于上次从哪来。所以迁移 0013 给
`app.mastery` 加了 `review_stage`（0..4，带 CHECK），与 `next_review_at` **必须一起写**
（`setReviewSchedule` 一条 UPDATE 写两列），否则崩溃会留下自相矛盾的排期。

`setReviewSchedule` 刻意不并进 `upsertMastery`：后者的语义是「证据回放结果」，
而排期来自「这一轮过没过」这个**事件**，普通作答不该动它。

### 五、起算点是「掌握那一刻」，且已排期不覆盖

`ensureInitialReviewSchedule(run, microKpId, masteredAt)` 在作答落库、`snapshot.state
=== 'mastered'` 时被调用：
- 起算点用 `answeredAt`（掌握那一刻）而不是「打开复验页那一刻」，否则一周没打开的
  人永远显示「还有 1 天到期」。
- 已有 `next_review_at` 就不覆盖。否则每次答对都重设 +1 天，**反复练习的节点永远不
  到期——勤奋会静默取消复验**。

### 六、抽题：不同变式组、不重做原题、多知识点交错

`selectReviewItems` 三条约束按优先级：
1. **不重做原题**：未做过的题 ≥3 时旧题全不选，不够才回落（否则复验变成「重做」，
   考的就不是「还记得吗」）。
2. **跨变式组轮转**：一组一题，再回头补第二题。
3. **3–5 题**（`REVIEW_ITEMS_MIN/MAX`）。题池不足 3 时返回现有的（引擎不编造题目），
   `POST /review/rounds` 在完全抽不出题单时返 409 并列出到期知识点。

`interleaveReviewItems` 用**轮转交错**（A1 B1 C1 A2 B2）而不是洗牌：洗牌需要随机数，
会让复验记录不可复现。确定性还要求 `selectReviewItems` 先按 `(variantGroup, itemId)`
排序——同样数据永远同一份题单。

### 七、通过线：3 题须全对、4 题全对、5 题错一题可过

`REVIEW_PASS_RATIO = 0.8`，实现成 `Math.ceil((Math.trunc(total) * 4) / 5)` 而不是
`total * 0.8`：0.8 二进制不精确，`5 * 0.8` 可能得 4.000000000000001，ceil 后变 5，
会出现只在五题时生效的「必须全对」。

这条线**与出口门控的 8/7（87.5%）、10/9（90%）不是同一把尺子**：门控是准入门槛，
复验只是「提醒你该复习了」，不该用同一把尺。

### 八、`overdueDays` / `intervalDays` 由后端下发而不是前端抄一份

- `overdueDays` 是派生值，存下来必然变旧，所以契约里只存 `nextDueAt`，逾期天数现算。
- `intervalDays` 曾经被前端硬编码复制了一份 `[1,3,7,21,60]`（`apps/web` 不依赖
  `@starmap/engine`），这是第二份间隔真源、必然漂移。改成契约里加 `intervalDays`
  字段，由 `ReviewService.queue()` 用 `reviewIntervalDays()` 现算——**序列的唯一真源
  仍然只有 engine 一处**。

### 九、判分幂等

`complete(roundId)` 先取 `pg_advisory_xact_lock('review:' + roundId)`；若
`review_rounds.verdict !== null` 就直接返回存下来的 `outcomes`，**不推第二档**。
学习者双击、前端重试、网络丢响应都不会让 `review_stage` 跳两级。

### 十、测试与验证

- `packages/engine/src/review.test.ts` 27 条（间隔序列、越界夹取、`<=` 恰好到期、
  坏日期不误判、通过线边界、抽题三条约束、交错、确定性）。
- `apps/api/src/review/review.controller.test.ts` 13 条集成测试，覆盖五条验收 +
  幂等 + 认领校验 + 没有可抽题时 409 + 学习日志可回看。
- 真实后端全链路实测（`http://127.0.0.1:3001`，跑完已还原现场）：
  9 次作答 → `mastered` + 自动落 1 天排期 → 拨到过期 → 队列 1 项 / 图谱 `reviewDueAt`
  同一时刻 → 抽 3 题（3 个变式组、`items` 不含 `answer`）→ 3 题全错 →
  `current` 从 0.9999941 降到 0.9984794、`achieved` 保持 0.9999941、`review_stage`
  停在 0 → 再跑一次排期 3 题全对 → `stage` 0→1、下次 3 天后、`review_passed` 落
  `learning_log`（payload 含 `roundId`/`correctItemIds`/`wrongItemIds`/`intervalDays`）。

### 十一、遗留观察（未擅自改）

真实库里目前**只有 `kp-bool` 一个叶知识点有 3 道 quiz 题**；其余 6 个挂了 AI 关卡的
叶节点，每张关卡只有 1 道 `practice` 题（没有 quiz 题）。复验池只收 `pool='quiz'`，
所以这 6 个知识点即使被掌握也抽不出复验题（`availableItemCount=0`，
`POST /review/rounds` 会对它们 409）。这不是本票的缺陷（票面要求「每次 3–5 题」，
不能拿 1 道题充数），但意味着**票 20 的全流程仿真若想跑出一次通过/未通过的复验，
唯一可行路径是走 `kp-bool`**。若之后要让更多知识点可复验，需要内容侧给 AI 关卡补
quiz 题（票 16 的 `assembleLevelSpec` 只生成 practice 题）。
