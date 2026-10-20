-- 票 15：skill 启用/禁用的持久化。
--
-- 关键区别：**skill 的存在来自文件系统，开关来自数据库。**
-- skill 本体是 `apps/api/mastra/skills/<name>/SKILL.md`，它们是代码资产，
-- 随仓库走、由开发者增删。启用状态是运行期运营决定，不该写回仓库文件
-- （那样每次开开关都会产生一个 git diff，而且多实例部署会互相覆盖）。
--
-- 所以这张表**只存偏离默认值的部分**：没有行 = 默认启用。
-- 好处是新增 skill 不需要插行，删掉 skill 留下孤儿行也不影响行为
-- （扫描时以文件系统为准，行只是覆盖表）。

CREATE TABLE IF NOT EXISTS app.skill_switches (
  -- skill 名 = 目录名（spec §8 硬约束：≤64 字符、仅小写字母数字连字符）。
  name        text PRIMARY KEY,
  enabled     boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- 谁改的。v1 没有账号体系，留 text 给将来；现在写 'local' 或测试名。
  updated_by  text NOT NULL DEFAULT 'local'
);
