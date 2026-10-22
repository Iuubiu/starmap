# 15: skill 库页

**What to build:** 把应用里的教学策略变成看得见的资产清单：有哪些 skill、各自负责什么、现在是启用还是禁用。禁用开关真的改变 agent 行为。

**Blocked by:** 08

**Status:** ready-for-agent

- [x] 扫描 Mastra 的 `skills/` 目录（`SKILL.md` + `references/`），列出全部 skill 的名称、描述、触发场景、版本
- [x] 每个 skill 可看正文与 references 清单（只读），不做在线编辑提示词
- [x] 启用／禁用开关真实影响 agent：禁用一个 skill 后，agent 的 system message 里不再出现它，且行为相应改变（有测试）
- [x] 开关状态持久化，重启后保持
- [x] 不做导入导出——迁移由文件系统天然支持，页面上要说清这一点
