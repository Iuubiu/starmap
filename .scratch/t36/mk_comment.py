"""生成票 18 Comments 第 4 节（AC2/AC3 取证）。一次性脚本，产物写 .scratch/t36/comment4.md。"""
import collections
import json
import pathlib

cm = json.load(open('content/course-map.json', encoding='utf-8'))
ce = json.load(open('content/cross-edges.json', encoding='utf-8'))

by_layer = collections.defaultdict(list)
for b in cm['books']:
    by_layer[b['layerId']].append(b)

EVID = {
    'circuit-analysis': '兰大 2016《电子学基础》1403006 第 3 学期（4 学分 72 学时），内容以电路分析为起点',
    'analog-electronics': '南华/复旦两份《核电子学》大纲先修栏「模拟电子技术」',
    'digital-electronics': '复旦「数字逻辑基础」INFO130331 第 3 学期；南华「数字电子技术 B」第 4–5 学期；必须先于核电子学',
    'atomic-nuclear-physics': '南华 2017《核电子学》先修栏第三项「原子核物理」',
    'nuclear-electronics': '兰大第 4 学期 / 复旦第 4 学期 / 南华第 5–6 学期 / 清华第 6 学期',
    'radiation-detection': '汤彬《核辐射测量原理》9 章无核电子学章；与核电子学并行非先修',
    'radiation-measurement-methods': '兰大大纲先修栏「核电子学和原子核物理」→ 本层是后继课',
    'advanced-digital': '本科三份大纲止于「多道分析器原理」；仅交大研究生 PHY8508 第 13–14 周 FPGA（6 学时）',
}

L = []
A = L.append
A('')
A('### 4. AC2 / AC3 取证（t36，2026-10-21 21:15）')
A('')
A('票面 AC2「知识点树按课程先修关系排布」与 AC3「每条 prereq 边都能追到证据来源」要落地，'
  '缺的不是算法，是**课程层**这一层数据：`app.modules` 只知道「一本书的一章」，`ordinal` 是章在'
  '本书内的序号（每本书重新从 1 开始），跨书排序毫无意义。本任务补的就是这一层，以及建立在它之上的跨书先修边。')
A('')
A('#### 4.1 八个课程层（迁移 `apps/api/migrations/0061_course_layers.sql`）')
A('')
A('| ordinal | id | 名称 | 学期 | kind | 书 | 证据（`note` 列原文摘要） |')
A('|---|---|---|---|---|---|---|')
for layer in cm['layers']:
    A(f"| {layer['ordinal']} | `{layer['id']}` | {layer['name']} | {layer['semesterFrom']}–{layer['semesterTo']} "
      f"| {layer['kind']} | {len(by_layer[layer['id']])} | {EVID[layer['id']]} |")
A('')
A('证据全文（含文件名与行号）在迁移的 `note` 列里，每一条都能回到 `.scratch/mastra-research/curriculum_report.md` '
  '的具体小节。`test_course_map.py::test_layers_match_the_migration_seed` 逐字段核对 Python 常量表与迁移种子 —— '
  '两处各写一份会漂移，这条测试是防漂移的闸。')
A('')
A('#### 4.2 27 本逐本归层（`content/course-map.json`，由 `tools/ingest/course_map.py` 生成）')
A('')
A('| # | sourceId | 课程层 | 理由（完整文本在 JSON 的 `reason` 字段） |')
A('|---|---|---|---|')
n = 0
for layer in cm['layers']:
    for b in by_layer[layer['id']]:
        n += 1
        reason = b['reason'].replace('\n', ' ')
        A(f"| {n} | `{b['sourceId']}` | `{b['layerId']}` | {reason} |")
A('')
A(f'合计 **{n} 本**，8 层里 7 层有书，`advanced-digital` 为空 —— 这不是漏映射，而是票面 AC5 要求的**内容缺口**：'
  '资源库没有「数字多道／FPGA／数字脉冲处理」的对口教材，已在 `0060_content_gaps` 的 `gap-digital-pulse` 里显式声明。'
  '`test_no_book_maps_to_advanced_digital` 记录这个事实：将来补了书，这条测试会红，提醒同步改缺口声明。')
A('')
A('**注意：`资源库/books/README.md` 的 A/B/C/D 不是课程层。** 那是「内容类型」分级（A 主干 / B 探测 / C 专题 / D 先修）。'
  '两者会给出不同答案：Knoll 在清单里是 A 主干，在培养方案里是探测方法课（与核电子学并行）；汤彬在清单里是 A 主干，'
  '实际是「核辐射测量原理」课教材、9 章无核电子学章。`course_map.py` 的模块 docstring 写明了这个区分，'
  '逐本理由里也标注了「按证据归 X 层，不按清单的 A 主干」这类说明。')
A('')
A('AC4 的两条具体要求都落在映射里：**`nuclear-physics-experiment-methods-1997`（18 原子核物理实验方法）→ '
  '`radiation-measurement-methods`（后继课）**、**`nuclear-radiation-measurement-tangbin`（05 汤彬）→ '
  '`radiation-detection`（探测／测量方法组）** —— 两条都有课程大纲原文作证，不是按书名猜。')
A('')
A('#### 4.3 跨书先修边 32 条（`content/cross-edges.json`，由 `tools/ingest/cross_edges.py` 生成）')
A('')
A('| 层对（ordinal 递增） | 条数 |')
A('|---|---|')
cnt = collections.Counter(
    (e['evidenceDetail']['fromLayer'], e['evidenceDetail']['toLayer']) for e in ce['edges'])
ordinal = {layer['id']: layer['ordinal'] for layer in cm['layers']}
for (a, b), k in sorted(cnt.items(), key=lambda x: (ordinal[x[0][0]], ordinal[x[0][1]])):
    A(f'| `{a}`({ordinal[a]}) → `{b}`({ordinal[b]}) | {k} |')
A(f'| **合计** | **{len(ce["edges"])}** |')
A('')
basis = collections.Counter(e['evidenceDetail']['basis'] for e in ce['edges'])
A(f'判据分布：`layer_order+term_match`（两端名字确有共同术语）**{basis["layer_order+term_match"]}** 条；'
  f'`whitelist`（无共同术语，靠人工判定的应用关系）**{basis["whitelist"]}** 条。'
  '每条边同时满足「层序严格递增」（必要条件）+「术语对应」或「人工白名单」之一。')
A('')
A('**32 条全文**（`from → to`｜书对｜层对｜依据）：')
A('')
for i, e in enumerate(ce['edges'], 1):
    d = e['evidenceDetail']
    tag = ('术语命中 ' + '、'.join(f'「{t}」' for t in d['matchedTerms'])) if d['matchedTerms'] else '人工白名单'
    if d['synonymPairs']:
        tag += '；同义 ' + '、'.join(f'「{x}」≈「{y}」' for x, y in d['synonymPairs'])
    A(f"{i}. `{e['fromId']}` → `{e['toId']}`")
    A(f"   `{d['from_book']}` → `{d['to_book']}`｜{d['fromLayer']} → {d['toLayer']}｜{tag}")
A('')
A('每条边的完整 `evidence` 文本（含课程层学期区间、章节路径、为什么是应用关系）在 `content/cross-edges.json` 的 '
  '`edges[].evidence` 里，可直接读。`evidence_detail` 结构：'
  '`{type:"cross_book", from_book, to_book, fromLayer, toLayer, matchedTerms, synonymPairs, basis, curriculumSource}`。')
A('')
A('**候选拒绝统计（AC3 要求「可列出全部有证据／无证据的边数」）**')
A('')
a = ce['candidateAudit']
A('| 项 | 数 | 说明 |')
A('|---|---|---|')
A(f"| 归一化后名字 | {a['normalizedConcepts']} | 去编号/括号/标点，过滤「未收录术语」「目录」等噪声名 |")
A(f"| 跨书同名概念 | {a['conceptsAcrossBooks']} | 至少两本书有同名叶节点 |")
A(f"| 层序合法 | {a['layerOrderOk']} | from 层 ordinal < to 层的**叶对**数 |")
A(f"| 白名单采用 | {a['keptByWhitelist']} | 其中被策展成边的 |")
A(f"| 非应用关系被拒 | {a['rejectedNotApplication']} | 层序合法但只是「同一概念各书都讲一遍」 |")
A(f"| 同层被拒 | {a['rejectedSameLayer']} | 并行课，无先后（radiation-detection 内部 342 对最多） |")
A(f"| 反向被拒 | {a['rejectedReverseLayer']} | 层序高的书讲得更细，反向同名对 |")
A(f"| 书未映射被拒 | {a['rejectedUnmappedBook']} | 0（27 本全有映射） |")
A('')
A('**为什么不是自动匹配**：三种自动方案实测全部否决 —— ①共享中文二元组：216 对相邻层精确同名，'
  '但绝大多数是「光电效应／康普顿散射／轫致辐射」这类同层重复或反向内容（`ahmed→leo` 20 对、'
  '`jichangsong→methods` 13 对），连上去会让学习者被要求先掌握一个还没学的同名节点；②术语表子串：'
  '971 个原始叶对，噪声更大（「计数器」480 对）；③归一化整名相等：7582 对，大量是 `未收录术语（…）` '
  '归一化后撞名。真正的判据不是「两个名字有共同词」，是「后一本书这一节在讲前一本书那一节的**直接应用**」——'
  '这是教学判断，只能逐条写下来并附理由。32 条不是 200 条，但每条都能被审。')
A('')
A('#### 4.4 `import-content.ts` 的接线（diff 摘要）')
A('')
A('- 新增 `CourseMap` 类型 + `COURSE_MAP_PATH` + `loadCourseMap()`（带缓存、文件缺失时**打警告**而不是抛错，'
  '让旧环境仍能导入，模块的 `course_layer_id` 显式留 NULL）+ `courseLayerOf(sourceId)`；')
A("- 模块 INSERT 从 `(id, subject_id, name, tier, ordinal) VALUES ($1,'nuclear',$2,'D',$3)` 改成 6 列带 "
  '`course_layer_id`，`tier` 由课程层 `kind` 接管（`foundation/core/advanced/method`）；'
  '`ON CONFLICT DO UPDATE` 同时更新 `tier` 与 `course_layer_id`；')
A('- 没有改 `SOURCE_META`（27 本的 title/path 原样）；没有改任何 chunk / 知识点 / 边的逻辑。')
A('')
A('**为什么 `tier` 可以接管**：`tier` 列原本是 A/B/C/D 内容分级，t36 实测 `grep -rn "modules.tier"` 在 '
  '`apps/api/src`、`apps/web/src`、`packages` **零命中** —— 没有任何代码读它。论文模块仍是 `tier=\'C\'`，'
  '不受影响。迁移 0061 把 `modules_tier_check` 放宽成同时接受 '
  "`A|B|C|D|foundation|core|advanced|method`，因为 12 处测试夹具直接插 `tier='A'|'D'`，"
  '只允许新值会让别人的测试全红。')
A('')
A('#### 4.5 真实库报数（2026-10-21 21:15）')
A('')
A('```')
A('app.course_layers        8 行（ordinal 10/20/30/40/50/60/70/80）')
A('app.modules             362 行')
A('  按 course_layer_id:')
A('    radiation-detection            135')
A('    radiation-measurement-methods   74')
A('    digital-electronics             38   ← 含 m-digital')
A('    nuclear-electronics             38')
A('    atomic-nuclear-physics          37')
A('    analog-electronics              23')
A('    circuit-analysis                 7')
A('    NULL                            10   ← 全部 mod-paper-*（论文主题，正确）')
A('  按 tier: core 210 / method 74 / foundation 68 / C 10（论文模块）')
A('app.kp_edges            279 = 书内 247 + 跨书 32')
A('app.knowledge_points    7277')
A('app.chunks              96821（chunks→missing kp = 0）')
A('GET /api/v1/graph       200 / nodes 5495 / edges 279 / recommendedIds 3 / contentGaps 3')
A('```')
A('')
A('**`m-digital` 的处理（captain 补充 1）**：归 `digital-electronics`（`tier=foundation`）。'
  '它不是任何一本书的章节，所以不经过 `content/course-map.json`（那份产物只管「书 → 层」），'
  '而是在 `apps/api/migrations/seed.sql` 里显式写 `course_layer_id` + 一条幂等 `UPDATE`'
  '（因为 `INSERT ... ON CONFLICT DO NOTHING` 对 0061 之前已存在的行什么都不做）。'
  '**10 个 `mod-paper-*` 保持 NULL 是正确形态** —— 它们是文献主题分类（`collider-detectors`、'
  '`readout-asics` 等），横跨所有课程层，不属于任何一门课。两者混在一起就无法区分「漏了」与「本来就不该有」。'
  '这条区分已写进 `seed.sql` 的注释。')
A('')
A('#### 4.6 验证（全部实跑）')
A('')
A('```')
A('python -m pytest tools/ingest/ -q          → 304 passed（t36 新增 34 条：test_course_map 15 + test_cross_edges 19）')
A('pnpm --filter @starmap/api test            → 31 files / 393 tests passed, 61.10s')
A('npx tsc --noEmit -p apps/api/tsconfig.json → rc=0')
A('node scripts/check-migrations.mjs          → 3 项全过（22 个迁移 / 22 对 up-down / 88 个对象 / 无残留）')
A('```')
A('')
A('**变异测试（证明测试有判别力，每次变异后都还原并复跑全绿）**：')
A('- `course_map.py` 把 `advanced-digital` 的 ordinal 80 改成 35 → 4 条红（升序、迁移种子一致、终点层、产物同步）；')
A('- `course_map.py` 删掉 `nicholson-1974` 的映射 → 3 条红（27 本齐全、仓库书双向相等、产物同步）；')
A('- `cross_edges.py` 对调第一条边两端 → 3 条红（白名单齐全、反向候选被拒、产物同步）。')
A('')
A('**端到端验证**：`pnpm --filter @starmap/api content:import` 重导 `circuit-analysis-lihansun-5e-vol1`，'
  '7 个模块的 `course_layer_id` 全部写成 `circuit-analysis`、`tier=foundation`，'
  '32 条跨书边未被 `import-content.ts` 的「删本书旧边」逻辑误删（它只删两端都在本书里的边）。')
A('')
A('#### 4.7 红线合规')
A('')
A('- 没有 `DELETE FROM app.knowledge_points`（无 id 条件的更没有）；')
A('- 跨书边只增不删：247 条书内边一条未动，`DELETE` 只用于 `evidence_detail->>\'type\' = \'cross_book\'`；')
A('- 没有 `git add -A`（提交只 `git add` 具体路径）；')
A('- 没有改 `chunk.py` / `assign.py` / `books_batch.py` / `toc.py` / `tools/eval/**` / `packages/api-contract/**` / `apps/web/**`。')
A('')

pathlib.Path('.scratch/t36/comment4.md').write_text('\n'.join(L) + '\n', encoding='utf-8')
print('lines', len(L))
