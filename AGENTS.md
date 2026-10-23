## Agent skills

### Issue tracker

Issues and specs live as markdown files under `.scratch/<feature-slug>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## 派工方式：小步快跑（用户 m38438 定）

- 每张票的交付时间上限 **30 分钟**；估计超过 30 分钟的工作必须切成多张票，不许「一张大票做完再说」。
- 每张票只做**一件事**，票面写死：输入（改哪些文件/读哪个接口）、输出（几个数/几张图/几行报告）、判据（怎么算过）。
- 第一阶段可以是「只出报告/只出清单/只出 dry-run」，落地改动放在第二阶段票。**先拿到可核对的事实，再改代码。**
- 票与票之间不串行等待：能同时开工的立刻并行派，不能并行的写清依赖，不做「等它做完再想下一步」。
- 每张票完成即回执三行：做了什么 / 数字或产物路径 / 卡点。超过 40 分钟没有写盘视为停滞，立刻重派或收归 captain。
- 复核（review）只给高风险改动（数据迁移、判定逻辑、契约变更），纯样式与文案不设复核。
