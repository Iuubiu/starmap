# StarMap 技能库计划（预置）

用户要求：大部分功能通过 agent + skill 实现（见 NEXT-VERSION 第 12 条）。本文是先于实现写下的技能清单，用于在架构迁移时直接照着建，避免边写边想。

约定：每个技能一个目录 `apps/api/src/mastra/skills/<name>/SKILL.md`，frontmatter 键集与现有 `question-author` 一致（name/description/version/triggers/metadata{owner,ticket}）。触发场景写「什么时刻该调用」，不写「它是什么」。

| 技能 | 触发场景（何时调用） | 输入 | 输出 | 状态 |
|---|---|---|---|---|
| `question-author` | 要出题/校验题时 | 知识点、档位、变式组 | 可入库题目 + 自检项 | ✓ 已有 |
| `socratic-tutor` | 学习者卡住/答错/要答案时 | 当前题、错误选项、追问阶梯层 | 下一句追问 | ✓ 已有 |
| `level-architect` | 把知识点编排成一关七段时 | 知识点、档位、可用题池 | LevelSpec 骨架 | 待建 P0 |
| `placement-assessor` | 定级答题结束需判定档位时 | 作答序列、题目难度 | P1/P2/P3 + 置信度 | 待建 P0 |
| `misconception-diagnostician` | 学生答错且要判断错因时 | 题干、正确项、所选错项 | 错因分类（概念/计算/单位/符号） | 待建 P1 |
| `explanation-writer` | 讲解卡与小结措辞不够时 | 知识点、之前答错的模式 | 讲解正文（≤6 分钟阅读量） | 待建 P1 |
| `remediation-designer` | 进入深究段需要补讲时 | 错因分类、目标知识点 | 补讲步骤 + 检查题 | 待建 P1 |
| `review-scheduler` | 决定下次复验间隔时 | 历史作答、间隔序列、表现 | 下一次复验时间 | 待建 P2 |
| `source-router` | 检索前决定查哪本书时 | 问题、可用 sources 列表 | sourceIds 子集 + 理由 | 待建 P2 |
| `progress-narrator` | 看板需要解释「为什么推荐这个」时 | 推荐结果 facts、学习日志 | 一句可核验的解释 | 待建 P2 |

## 建库顺序与理由

**P0（先建 level-architect、placement-assessor）**：这两个是「关卡」与「档位」的唯一生成点，现在都由代码硬编码。它们一旦成为技能，tier 与 level 的差异才能真由模型按学生状态生成，而不是查表。

**P1（misconception-diagnostician、explanation-writer、remediation-designer）**：构成「答错之后」的完整闭环 —— 判错因 → 写补讲 → 出检查题。现在这一段是固定文案，学生答错只会看到同一句话。

**P2（review-scheduler、source-router、progress-narrator）**：属于「策略微调」类，改错代价低、收益也低，等 P0/P1 稳定后再动。

## 硬约束（写给将来的实现者）

1. 判定类技能（placement-assessor、review-scheduler）在迁移前必须先过一致性评估：同一输入重复 20 次，判定一致率 ≥ 95%，否则不许接管代码里的判定。
2. 每个技能只输出**结构化结果**（JSON），措辞由模板渲染。理由：技能输出直接进判定链，自由文本无法测试。
3. 技能不得直接写库。需要落库的动作一律经工具（`recordAttempt` 等），以便审计与回放。
