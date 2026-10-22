# 给 authoring-dev 的三个既有结论（t64 改写后可直接引用）

## 1. 档位切换已可用
`node .scratch/demo-set-tier.mjs <P1|P2|P3> [--dry-run]`
- 一次事务改三列：`tier` / `status='provisional'` / `attempts_baseline=当前计入掌握度的作答数`
- 只改 `tier` 不够：看板一打开就会触发「够 5 题就重判」，档位被立刻算回去
- 验证：改完 `GET /api/v1/tier` 立刻返回对应六维

## 2. 三档六维实测（captain 刚跑，可直接引用）
| 维 | P1 | P3 |
|---|---|---|
| firstRoundShape | worked_example（整段讲解摊开） | direct（跳过纯讲解直接出题） |
| ladder | 1..3 | 3..5 |
| feedbackTiming | step_immediate（逐题即时） | item_deferred_with_summary（整题延迟+关末总结） |
| attemptsPerItem | 2 | 1 |
| masteryRule.consecutiveCorrect | 2 | 1 |
| sessionNewKpLimit | 2 | 4 |

## 3. 首屏文案实测（同一句「我想学布尔代数的基本运算」）
- P1：「你对布尔代数基本运算的掌握度已经满了……下一步值得练的是吸收律与德摩根律：**这两条律的形状和普通代数差别最大，也最容易凭直觉用错**。」→ 讲「为什么难」
- P3：「布尔代数这一块你已经练到掌握状态了……下一步更值得练的是**把与、或、非组合成更复杂的式子后怎么化简**，那里才是容易出错的地方。」→ 讲「怎么用」
- 两者指向**同一张关卡卡**（逻辑代数基本律：吸收律与德摩根律 / 4 题 / 14 分钟），差别在难度档标签与理由措辞 —— 这正是要讲给观众的那一句。

## 4. 已知阻塞（不必写进交付，但要避开）
- `zip`/焦点问题：右侧「本次会话新知识点」仍会列出辐射测量那几节（t56 未收口）。演示脚本**不要断言这一块**，只断言难度档标签、上限文案与卡片正文。
- kp-bool 已被探针打到 mastered，所以首屏会出现「已经满了/已经练到」。演示前要么清学习数据，要么换一个未学知识点（例如从地图里挑一个 `未学` 的）。

## 5. 我改 t64 票面时用的原文（供对齐）
objective 要点：把演示主线改成「三种学习者学同一个知识点」：P1/P2/P3 各走一遍同一句开场话术与同一个知识点，逐段给出**界面上肉眼可见**的档位差异（首屏产物卡 + 关卡第一屏），并把零模型五连降为背景铺垫。
必须落到票面的两条硬断言：
- 六维里**至少 4 维不同**（两两比较，不是只比 P1 vs P3）；
- **第一轮形态三档必须两两不同**（P1 worked_example / P2 last-card-blank / P3 direct —— P2 的形态你要补一条实测，我目前只测了 P1 与 P3）。

## 6. P2 待补测（交给你）
P1/P3 两端我已跑通；P2 六维应为 `start 2, cap 4`、`feedbackTiming` 介于两者之间（契约里是 `step_immediate` 或 `item_deferred`，实测确认）。补测命令：
```
node .scratch/demo-set-tier.mjs P2
cd apps/web && npx playwright test --config=../../.scratch/qa/playwright.config.ts zz-tier-compare --output=../../.scratch/pw-tier-p2
```
（`zz-tier-compare` 现在只跑 P1/P3，把 P2 加进数组即可。）
