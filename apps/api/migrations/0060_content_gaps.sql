-- 0060: 内容缺口（票 18 AC5）
--
-- 票面原话：「显式标注内容缺口：资源库没有『数字多道／FPGA／数字脉冲处理』的
-- 对口教材，该缺口在图上可见」。这句话的重点是**可见**：缺口如果只写在一份
-- 调研文档里，学习者看到的就是一张「这里什么都没有、但也没有任何解释」的图，
-- 会以为是自己没找到，而不是这门课本身到这儿就断了。
--
-- ## 为什么缺口要进数据库，而不是写死在前端常量里
--
-- 缺口是**内容侧的事实**，会随资源库变化：补进一本 FPGA 教材之后，那条缺口
-- 就该消失。写死在前端意味着改一次缺口要发一次版，而且前端不知道「现在库里
-- 到底有没有对口教材」。放进表里，补书的人删一行就完事。
--
-- ## 为什么 nearest_kp_ids 不建外键、且由子查询解析
--
-- 两件事分开说：
--
-- 1. **不建外键**：缺口指向的是「资源库里没有的东西」，它周边最接近的知识点
--    只是给学习者的**提示**（「你已经学到这儿了，再往后没有教材了」），不是
--    归属关系。而且知识点合并/删除时不该连带删掉「这里缺内容」这条事实 ——
--    恰恰相反，删知识点往往正是因为没有好内容。
--
-- 2. **由子查询解析，不写死 id**：`knowledge_points.id` 是入库时按
--    `书名-章节` 生成的，重新导入就会变（t26 实测三本书 57 个 chunk id 漂移）。
--    迁移里写死 `kp-wangzhiying-1989-6-2-1` 这种 id，下次重导入后它就指向一个
--    不存在的知识点，而界面上会显示一个点不动的链接 —— 比不显示更糟。
--    所以这里按名字在**执行迁移的那一刻**解析，解析不到就是空数组（合法：
--    缺口照常显示，只是没有「最近的知识点」可跳）。
--
-- ## 为什么种子数据写在迁移里而不是 seed.sql
--
-- `seed.sql` 是演示数据，测试 schema 会跳过它（`test-schema.ts` 的约定：
-- 测试自己种自己需要的数据）。而缺口是**产品内容** —— 界面上永远该有这一块，
-- 不是「有演示数据时才出现」。所以它必须跟着结构迁移一起进库。
--
-- 回滚见 0060_content_gaps.down.sql。

CREATE TABLE IF NOT EXISTS app.content_gaps (
    id              text PRIMARY KEY,
    topic           text NOT NULL,
    reason          text NOT NULL,
    -- 这个缺口在课程层里本该是什么角色。CHECK 而不是 enum 类型：
    -- 枚举值将来大概率会加（比如 'elective'），CHECK 改起来是 ALTER，
    -- 而 PostgreSQL 的 enum 加值不能回滚（DROP VALUE 不存在）。
    expected_role   text NOT NULL
                    CHECK (expected_role IN ('prereq', 'core', 'advanced')),
    nearest_kp_ids  text[] NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- 三条缺口。`reason` 里的每一句都能在 `.scratch/mastra-research/curriculum_report.md`
-- 找到出处（三份本科大纲的课程表、上海交大研究生 PHY8508 的教学日历）。
INSERT INTO app.content_gaps (id, topic, reason, expected_role, nearest_kp_ids)
VALUES
  (
    'gap-digital-mca',
    '数字多道分析器',
    '兰大 72 学时、南华 56 学时、复旦 54 学时三份本科《核电子学》大纲的最后一章都止于'
    '「多道分析器原理」，数字多道、FPGA、DSP 在本科大纲里完全缺席 —— 也就是说这不是'
    '「书还没录完」，而是这门课在本科层面就到这儿为止。再往后要学，得先有一本对口教材。',
    'advanced',
    ARRAY(
      SELECT k.id FROM app.knowledge_points k
      WHERE k.is_leaf AND k.name LIKE '%多道分析器%'
      ORDER BY length(k.name), k.id
      LIMIT 3
    )
  ),
  (
    'gap-fpga',
    'FPGA 可编程器件',
    '本科层面未找到任何可核验来源。唯一相关的是上海交通大学研究生课 PHY8508 第 13–14 周'
    '「FPGA 可编程器件介绍与设计」（6 学时，实验课）—— 研究生实验课，不是可以自学的教材。'
    '资源库里康华光、阎石两本数字电路只讲到 FPGA 的结构与原理，没有设计方法。',
    'advanced',
    ARRAY(
      SELECT k.id FROM app.knowledge_points k
      WHERE k.is_leaf AND (k.name LIKE '%FPGA%' OR k.name LIKE '%可编程逻辑器件%')
      ORDER BY length(k.name), k.id
      LIMIT 3
    )
  ),
  (
    'gap-digital-pulse',
    '数字脉冲处理',
    '资源库里唯一候选是 Nakhostin《Signal Processing for Radiation Detectors》(2018)，'
    '但它讲的是数字脉冲处理本身，对应的知识块在本科大纲里不存在 —— 它接不上「多道分析器」'
    '之后的任何一段课程。Knoll 与 Gilmore 各有一节「数字脉冲处理」，都是一节概论，'
    '不足以支撑一条学习路径。',
    'advanced',
    ARRAY(
      SELECT k.id FROM app.knowledge_points k
      WHERE k.is_leaf AND (k.name LIKE '%数字脉冲处理%' OR k.name LIKE '%数字信号处理%')
      ORDER BY length(k.name), k.id
      LIMIT 3
    )
  )
ON CONFLICT (id) DO NOTHING;
