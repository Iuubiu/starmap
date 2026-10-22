-- 0061: 课程层级（票 18 AC2）
--
-- 票面原话：「知识点树按**课程先修关系**排布：数字部分（第 3–4 学期）排在核电子学
-- （第 4–6 学期）之前，中间经过模拟电子、电路分析、原子核物理」。
--
-- ## 为什么要有这张表，而不是给 modules 加一个字符串列
--
-- 「课程层」不是一本书的属性，是**一门课在培养方案里的位置**：学期区间、先后
-- 次序、性质（基础/核心/进阶/方法）。三样东西都要能查询：地图要按 ordinal 排、
-- 学习者画像要按学期区间判断「这门课你现在该不该学」、先修边生成要按 ordinal
-- 判方向。塞进 modules 的一个 text 列里，这三件事都得在前端或 SQL 里再写一遍
-- 常量表 —— 而常量表一旦有两份就会漂移。
--
-- ## 为什么学期区间写死在这里（而不是从课程调研文档里读）
--
-- 学期区间是**培养方案的事实**，不是本仓库的内容产物。它变化极慢（几年一次），
-- 且必须与 `note` 里的证据一起被审计。写成迁移种子意味着：改一次学期区间要写
-- 一条新迁移、要能回滚、要过 `check-migrations.mjs` 的 up→down 往返 —— 这正是
-- 我们希望「改课程体系」这件事付出的成本。
--
-- ## 为什么 tier 的 CHECK 放宽而不是替换
--
-- `app.modules` 现有 362 行（352 本`tier='D'` + 10 个论文模块 `tier='C'`），
-- 而且 `apps/api/src/**` 里 12 处测试夹具直接插 `tier='A'|'D'`。把 CHECK 换成
-- 只允许 `foundation|core|advanced|method` 会让这些测试当场全红 —— 而本票的
-- 红线是「不改 API/契约/前端」。所以新旧值同时允许：论文模块继续用 'C'，
-- 书模块由 `import-content.ts` 改写为课程层的 kind。
--
-- 回滚见 0061_course_layers.down.sql。

CREATE TABLE IF NOT EXISTS app.course_layers (
    id              text PRIMARY KEY,
    name            text NOT NULL,
    -- 学期区间。`semester_from`/`semester_to` 而不是 `min`/`max`：这两个词在
    -- 培养方案里就是「起止学期」，而且 min/max 容易被误读成聚合函数的结果。
    semester_from   int NOT NULL,
    semester_to     int NOT NULL,
    -- 课程层在全链路里的先后。10 的步长留出插层空间（例如「概率统计」插在
    -- 电路分析之前可以取 5，不必重排全表）。
    ordinal         int NOT NULL UNIQUE,
    -- 层性质。CHECK 而不是 enum 类型：枚举值将来大概率会加（例如 'elective'），
    -- 而 PostgreSQL 的 enum 加值不能回滚（没有 DROP VALUE）。
    kind            text NOT NULL
                    CHECK (kind IN ('foundation', 'core', 'advanced', 'method')),
    -- 证据来源。**不许为空**：课程层的学期区间是要被审计的事实，写不出出处的
    -- 层不应该存在。默认值给空串只是为了 INSERT 时不强制写，但下面每一行都写了。
    note            text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (semester_from <= semester_to)
);

-- 一本书的每一章是一个 module。章属于哪门课，由这本书属于哪个课程层决定。
-- `ON DELETE SET NULL` 而不是 CASCADE：课程层被撤掉时，教材章节不该跟着消失
-- （它们是真实内容，只是暂时没有归属），而 NULL 正好表达「未归层」。
ALTER TABLE app.modules
    ADD COLUMN IF NOT EXISTS course_layer_id text
    REFERENCES app.course_layers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS modules_course_layer_idx ON app.modules (course_layer_id);

-- 放宽 tier：同时接受旧的 A|B|C|D（论文模块与测试夹具仍在用）与新的课程层 kind。
ALTER TABLE app.modules DROP CONSTRAINT IF EXISTS modules_tier_check;
ALTER TABLE app.modules
    ADD CONSTRAINT modules_tier_check
    CHECK (tier IN ('A', 'B', 'C', 'D', 'foundation', 'core', 'advanced', 'method'));

-- 8 个课程层。学期区间与证据出处全部来自
-- `.scratch/mastra-research/curriculum_report.md`（三校真实大纲并排比对）。
INSERT INTO app.course_layers (id, name, semester_from, semester_to, ordinal, kind, note)
VALUES
  (
    'circuit-analysis', '电路分析', 2, 3, 10, 'foundation',
    '兰州大学 2016 版《电子学基础》1403006 在第 3 学期（模拟+数字合并，4 学分 72 学时），'
    '其内容以电路分析为起点；南华 2019 版方案中电路类课程同样排在第 2–3 学期。'
    '证据：curriculum_report.md 第 2 节课程事实表（兰大 2016 版 PDF 第 2510 行起）。'
  ),
  (
    'analog-electronics', '模拟电子技术', 3, 4, 20, 'foundation',
    '复旦《核电子学》TCPH130004 大纲「要求预修模拟电子技术、数字电子技术」（第 97 页）；'
    '南华 2017 版《核电子学》先修栏「模拟、数字电子技术，原子核物理」。'
    '数字/模拟课在第 3–4 学期，核电子学在第 4–6 学期，时间差恰好一个学期。'
    '证据：curriculum_report.md 第 1 节先修课列 + 第 7 节操作性结论 2。'
  ),
  (
    'digital-electronics', '数字电子技术', 3, 4, 30, 'foundation',
    '复旦「数字逻辑基础」INFO130331 在第 3 学期（4 学分 64 学时，专业核心课）；'
    '南华核专业「数字电子技术 B」2019 版第 5 学期、2024 版第 4 学期。'
    '**必须排在 nuclear-electronics（ordinal 50）之前** —— 这是票 18 AC2 的核心断言，'
    '也是南华/复旦两份大纲先修栏里写明的直接先修关系。'
    '证据：curriculum_report.md 第 2 节 + 第 7 节结论 1、2。'
  ),
  (
    'atomic-nuclear-physics', '原子核物理', 4, 5, 40, 'core',
    '南华 2017 版《核电子学》先修栏第三项即「原子核物理」；郭江《原子及原子核物理》'
    '（2014/2023 两版）是本资源库的对口教材，内容覆盖到衰变、核反应、射线与物质相互作用。'
    '证据：curriculum_report.md 第 1 节南华行。'
  ),
  (
    'nuclear-electronics', '核电子学', 4, 6, 50, 'core',
    '兰州大学 2016 版第 4 学期（4 学分 72 学时，教材=王芝英）、2019 版第 4 学期（3 学分）；'
    '复旦第 4 学期（3 学分 54 学时）；南华 2019 版第 6 学期 / 2024 版第 5 学期（3 学分 48 学时）；'
    '清华第 6 学期（4 学分）。三校章节顺序完全一致：信号与噪声 → 前置放大器 → 成形/滤波 →'
    '脉冲幅度分析 → 时间分析 → 数据获取。'
    '证据：curriculum_report.md 第 1 节课程事实表（五行学校）。'
  ),
  (
    'radiation-detection', '探测与测量方法', 4, 6, 60, 'core',
    '汤彬《核辐射测量原理》是「核辐射测量原理」课教材（东华理工 68 学时），'
    '全书 9 章无核电子学章；Knoll/陈伯显/丁洪林/汲长松同属探测方法教材。'
    '与 nuclear-electronics 同学期区间但**不是先修关系**（并行课）：核电子学讲电子学链路，'
    '探测层讲探测器本身与测量方法。'
    '证据：curriculum_report.md 第 1 节「关于三本教材的采用面」表 + 第 7 节结论 4。'
  ),
  (
    'radiation-measurement-methods', '实验方法与数据处理', 6, 8, 70, 'method',
    '《原子核物理实验方法》（修订第 3 版 1997）是**后继课**教材：兰州大学大纲先修栏写'
    '「核电子学和原子核物理」，即它排在核电子学之后；Tsoulfanidis/Debertin/Gilmore 同属'
    '测量与数据处理方法（计数统计、效率刻度、能谱解析）。'
    '证据：curriculum_report.md 第 7 节结论 4（18 应从 D 层移到后继位置）。'
  ),
  (
    'advanced-digital', '数字脉冲处理与可编程逻辑', 9, 10, 80, 'advanced',
    '本科层面未找到任何可核验来源：兰大 72 学时、南华 56 学时、复旦 54 学时三份本科大纲'
    '的最后一章都止于「多道分析器原理」，数字多道/FPGA/DSP 完全缺席。'
    '唯一相关的是上海交大研究生课 PHY8508 第 13–14 周「FPGA 可编程器件介绍与设计」'
    '（6 学时，实验课）。学期 9–10 是研究生学年，不是本科第 9 学期。'
    '资源库唯一候选教材是 Nakhostin《Signal Processing for Radiation Detectors》2018。'
    '证据：curriculum_report.md 第 3 节 + 第 7 节结论 5；缺口见 0060_content_gaps 的 gap-digital-pulse。'
  )
ON CONFLICT (id) DO NOTHING;
