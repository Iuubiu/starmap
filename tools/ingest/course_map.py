"""把 27 本教材映射到「课程层」，产出 `content/course-map.json`。

## 为什么需要课程层

票 18 AC2：「知识点树按课程先修关系排布：数字部分（第 3–4 学期）排在核电子学
（第 4–6 学期）之前，中间经过模拟电子、电路分析、原子核物理」。

这句话要落地，必须先回答一个数据库回答不了的问题：**这本书属于哪门课**。
`app.modules` 只知道「一本书的一章」，`ordinal` 是章在本书内的序号（每本书重新
从 1 开始），跨书排序毫无意义 —— 直接按它排会把阎石第 1 章排在王芝英第 1 章
旁边，学习者看到的顺序是随机的。

课程层是**培养方案里的事实**（第几学期、先后、性质），不是内容产物的属性，
所以它进数据库（`app.course_layers`，迁移 0061）；而「哪本书属于哪门课」是
**内容侧的判断**，会随资源库变化（补一本书就要加一行），所以它是本模块的常量表
+ 一份 JSON 产物，由 `import-content.ts` 读取写入 `app.modules.course_layer_id`。

## 依据

`.scratch/mastra-research/curriculum_report.md`（三校真实大纲并排比对）：
兰大 72 学时第 4 学期、南华 56 学时第 5–6 学期、复旦 54 学时第 4 学期，章节顺序
完全一致；官方书面先修证据 4 条都写明「模拟 + 数字电子技术」是核电子学的先修。

**注意：`资源库/books/README.md` 的 A/B/C/D 不是课程层。** 那是「内容类型」分级
（A 主干 / B 探测 / C 专题 / D 先修），描述的是「这本书对学核电子学有多核心」，
不是「它在培养方案第几学期」。两者会给出不同的答案：Knoll 在 README 里是 A 主干，
在培养方案里却是探测方法课（与核电子学并行，不是先修）；王经瑾在 README 里也是
A 主干，但多数学校只把它列为参考书。混用会让先修边方向出错。

## 为什么每本书只归一层

一本书只有一个 `course_layer_id`（`app.modules.course_layer_id` 是单值列）。
跨层的书（例如 Leo 前 10 章讲探测器、后 8 章讲电子学）只能按**主体**归层，
并在理由里写清例外。反过来按章拆层会破坏「一章属于一门课」这个教学事实。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import NamedTuple

INGEST = Path(__file__).resolve().parent
REPO = INGEST.parent.parent
CONTENT = REPO / 'content'


class Layer(NamedTuple):
    """课程层。字段与迁移 `0061_course_layers.sql` 的种子一一对应。"""

    id: str
    name: str
    semester_from: int
    semester_to: int
    ordinal: int
    kind: str


#: 8 个课程层，按 `ordinal` 升序。
#:
#: 这里是 `course_map.py` 与 `cross_edges.py` 需要的最小字段集（排序、学期区间、
#: 性质）。**`note`（证据出处）不在这里**，它只写在迁移里 —— 迁移是课程层的单一
#: 真源，重复一份到 Python 就会漂移。`test_course_map.py` 有一条测试直接读迁移
#: 文件，逐行核对这张表与种子一致，改了一边不改另一边就红。
LAYERS: tuple[Layer, ...] = (
    Layer('circuit-analysis', '电路分析', 2, 3, 10, 'foundation'),
    Layer('analog-electronics', '模拟电子技术', 3, 4, 20, 'foundation'),
    Layer('digital-electronics', '数字电子技术', 3, 4, 30, 'foundation'),
    Layer('atomic-nuclear-physics', '原子核物理', 4, 5, 40, 'core'),
    Layer('nuclear-electronics', '核电子学', 4, 6, 50, 'core'),
    Layer('radiation-detection', '探测与测量方法', 4, 6, 60, 'core'),
    Layer('radiation-measurement-methods', '实验方法与数据处理', 6, 8, 70, 'method'),
    Layer('advanced-digital', '数字脉冲处理与可编程逻辑', 9, 10, 80, 'advanced'),
)

LAYER_BY_ID: dict[str, Layer] = {layer.id: layer for layer in LAYERS}

#: sourceId → 课程层 id。27 本，一本不少（`test_course_map.py` 第一条测试守这条）。
BOOK_TO_LAYER: dict[str, str] = {
    # ---- 电路分析（第 2–3 学期）----
    'circuit-analysis-lihansun-5e-vol1': 'circuit-analysis',
    # ---- 模拟电子技术（第 3–4 学期）----
    'analog-electronics-kanghuaguang-5e': 'analog-electronics',
    'analog-electronics-tongshibai-5e': 'analog-electronics',
    # ---- 数字电子技术（第 3–4 学期）----
    'digital-electronics-yanshi-6e': 'digital-electronics',
    'digital-kanghua-5e': 'digital-electronics',
    # ---- 原子核物理（第 4–5 学期）----
    'guojiang-2014': 'atomic-nuclear-physics',
    'guojiang-2023': 'atomic-nuclear-physics',
    # ---- 核电子学（第 4–6 学期）----
    'nuclear-electronics-wangzhiying-1989': 'nuclear-electronics',
    'nuclear-electronics-wangjingjin-1983': 'nuclear-electronics',
    'nicholson-1974': 'nuclear-electronics',
    'nakhostin-2018': 'nuclear-electronics',
    'rivetti-2015': 'nuclear-electronics',
    # ---- 探测与测量方法（第 4–6 学期）----
    'knoll-3e-2000': 'radiation-detection',
    'knoll-4e-2010': 'radiation-detection',
    'nuclear-radiation-physics-chenboxian-2011': 'radiation-detection',
    'radiation-detectors-dinghonglin-2010': 'radiation-detection',
    'radiation-detector-handbook-jichangsong-1990': 'radiation-detection',
    'nuclear-radiation-measurement-tangbin': 'radiation-detection',
    'ahmed-2e': 'radiation-detection',
    'grupen-2e-2008': 'radiation-detection',
    'lutz-2007': 'radiation-detection',
    'spieler-2005': 'radiation-detection',
    # ---- 实验方法与数据处理（第 6–8 学期）----
    'nuclear-physics-experiment-methods-1997': 'radiation-measurement-methods',
    'leo-2e': 'radiation-measurement-methods',
    'debertin-1988': 'radiation-measurement-methods',
    'gilmore-2e-2008': 'radiation-measurement-methods',
    'tsoulfanidis-4e': 'radiation-measurement-methods',
}

#: 逐本理由。**每一条都要能指回证据**（课程调研的哪一节，或书目清单的哪一行），
#: 否则「为什么这本书在这一层」就只是作者的印象，下一轮没人敢改。
BOOK_TO_LAYER_REASON: dict[str, str] = {
    'circuit-analysis-lihansun-5e-vol1': (
        '电路分析是电子技术课的第一门：兰大 2016 版《电子学基础》1403006 在第 3 学期开课，'
        '内容以电路分析为起点（curriculum_report.md 第 2 节）。李瀚荪《电路分析基础》'
        '上册覆盖集总参数约束关系、网孔/节点分析、一阶与二阶电路 —— 正是核电子学里'
        'RC 成形电路的数学基础。'
    ),
    'analog-electronics-kanghuaguang-5e': (
        '南华 2024 版核专业方向「模拟电子技术」课教材（第 6 版）；南华/复旦两份《核电子学》'
        '大纲的先修栏都写明「模拟电子技术」（curriculum_report.md 第 1、2 节）。'
    ),
    'analog-electronics-tongshibai-5e': (
        '国内工科最通用的模拟电子技术教材之一，兰大 2016 版《电子学基础》列为参考书'
        '（curriculum_report.md 第 2 节兰大行）；与康华光同层，覆盖放大电路频率响应与反馈 ——'
        '核电子学「最佳滤波」「谱仪放大器」两章的直接先修。'
    ),
    'digital-electronics-yanshi-6e': (
        '阎石《数字电子技术基础》第 6 版：南华核专业列为参考书、成都理工研究生「核电子学基础」'
        '参考书、多所工科院校数字电子技术课选用教材（curriculum_report.md 第 2 节）。'
        '**本层（ordinal 30）必须排在 nuclear-electronics（50）之前** —— 票 18 AC2 的核心断言。'
    ),
    'digital-kanghua-5e': (
        '康华光《电子技术基础·数字部分》第 5 版：南华电类专业「数字电子技术 A」教材'
        '（curriculum_report.md 第 2 节）。与阎石同层，两本互补（康华光偏器件与系统设计，'
        '阎石偏逻辑代数与经典时序电路）。'
    ),
    'guojiang-2014': (
        '郭江《原子及原子核物理》旧版：覆盖原子结构、原子核性质、放射性衰变、核反应、'
        '射线与物质相互作用 —— 南华《核电子学》先修栏第三项「原子核物理」的对口教材'
        '（curriculum_report.md 第 1 节南华行）。'
    ),
    'guojiang-2023': (
        '同上的第 2 版。与 2014 旧版同层：两版章节结构一致（第 9 章核性质、第 10–11 章衰变、'
        '第 12 章核反应、第 14 章相互作用），保留两版是因为旧版的章节编号更细、'
        '新版补了应用。'
    ),
    'nuclear-electronics-wangzhiying-1989': (
        '**本层的基准教材**：兰大 2016/2019 版、南华核工程/核物理/辐射防护三专业、'
        '东华理工都把它列为《核电子学》选用教材（curriculum_report.md 第 1 节'
        '「关于三本教材的采用面」表）。6 章结构即三校一致的教学顺序：信号与噪声 →'
        '前置放大器 → 放大器 → 脉冲幅度分析 → 时间分析 → 数据获取。'
    ),
    'nuclear-electronics-wangjingjin-1983': (
        '王经瑾《核电子学》上册：多数学校列为参考书，华北电力实验课用作教材、'
        '兰大《核数据获取与处理》用下册（curriculum_report.md 第 1 节）。'
        '上册从第 9 章起（幅度甄别/时间信息/谱仪 ADC/计数设备/多道分析器/计算机多道），'
        '与王芝英后四章重叠但更细 —— 同层作为加深读物。'
    ),
    'nicholson-1974': (
        'Nicholson《Nuclear Electronics》1974：书名即课程名，内容为脉冲成形、放大器、'
        '甄别器、定时电路 —— 核电子学经典体系的英文源头（书目清单第 16 行 C 专题）。'
        '年代早，作为历史参考同层放置。'
    ),
    'nakhostin-2018': (
        'Nakhostin《Signal Processing for Radiation Detectors》2018：10 章里 8 章是'
        '核电子学主线（信号产生、噪声与干扰、前置放大器、能量测量、脉冲计数与电流测量、'
        '时间测量、位置灵敏、脉冲形状甄别），只有第 9–10 章是数字信号处理。'
        '**按主体归核电子学层**：把整本归到 advanced-digital 会让「前置放大器」「噪声」'
        '这些核心概念出现在研究生层，与王芝英的同名节点分处两层，学习者按层学习时必然漏掉。'
        '第 9–10 章属 advanced-digital —— 该层因此没有整本对口教材，正是 0060_content_gaps '
        '里 gap-digital-pulse 声明的内容缺口。'
    ),
    'rivetti-2015': (
        'Rivetti《CMOS Front-End Electronics for Radiation Sensors》2015：输入级、'
        '频域输入级、噪声、时间成形器、甄别器、数据转换器 —— 全是核电子学链路的 ASIC 实现，'
        '不是数字逻辑设计。同层作为前端电子学的现代专题（书目清单第 14 行 C 专题）。'
    ),
    'knoll-3e-2000': (
        'Knoll 第 3 版：探测方法课的通用教材，20 章里 1–15、19–20 是探测器与测量，'
        '只有 16–18 章（脉冲处理与成形、线性与逻辑脉冲函数、多道脉冲分析）是电子学'
        '（curriculum_report.md 第 5 节分级表 A 主干 = 内容核心度高，但课程归属是探测方法）。'
    ),
    'knoll-4e-2010': (
        'Knoll 第 4 版：与第 3 版同层，章节重排（15 脉冲处理 / 16 脉冲成形计数与定时 /'
        '17 多道脉冲分析）。两版并存是因为第 3 版的章节编号被大量旧文献引用。'
    ),
    'nuclear-radiation-physics-chenboxian-2011': (
        '陈伯显《核辐射物理及探测学》：前 6 章核物理与相互作用、后 7 章探测器与测量方法 ——'
        '课程归属是探测方法（书名即「探测学」）。它同时是原子核物理层的复习材料，'
        '但主体在探测（curriculum_report.md 第 5 节 B 探测）。'
    ),
    'radiation-detectors-dinghonglin-2010': (
        '丁洪林《核辐射探测器》：14 章全部是探测器类型与工艺（气体/闪烁/半导体/硅锂/'
        '高纯锗/化合物/低温量热），无核电子学章（书目清单第 7 行 B 探测）。'
    ),
    'radiation-detector-handbook-jichangsong-1990': (
        '汲长松《核辐射探测器及其实验技术手册》：12 章探测器 + 实验技术 + 数据统计处理，'
        '是探测层的手册型参考（书目清单第 19 行 D 实验；按课程归属放探测层，'
        '第 11–12 章的实验技术与统计与 methods 层重叠）。'
    ),
    'nuclear-radiation-measurement-tangbin': (
        '汤彬《核辐射测量原理》：9 章无核电子学章，「核电子学的基础知识」只是第 4 章'
        '探测器内容里的一句话；它是「核辐射测量原理」课教材（东华理工 68 学时）'
        '（curriculum_report.md 第 1 节「关于三本教材的采用面」表 + 第 6 节反常发现）。'
        '**按证据归探测层，不按书目清单的 A 主干** —— 清单的 A/B/C/D 是内容类型，'
        '不是课程层（见模块 docstring）。'
    ),
    'ahmed-2e': (
        'Ahmed《Physics and Engineering of Radiation Detection》第 2 版：13 章里'
        '1–7 章探测器与相互作用、8 章信号处理、9–10 章统计与数据分析、11–13 章剂量/能谱/'
        '数据获取。主体是探测物理与工程（书目清单第 10 行 B 探测）。'
    ),
    'grupen-2e-2008': (
        'Grupen《Particle Detectors》第 2 版：探测器特性、径迹探测器、量能器、粒子识别、'
        '中微子探测器，仅第 14 章「电子学」一章讲电子学（书目清单第 9 行 B 探测）。'
    ),
    'lutz-2007': (
        'Lutz《Semiconductor Radiation Detectors》：半导体物理、探测器结构、能量与位置'
        '测量、读出电子学（第 7 章）。主体是半导体探测器（书目清单第 15 行 C 专题），'
        '第 7 章的读出电子学与核电子学层重叠但只是一章。'
    ),
    'spieler-2005': (
        'Spieler《Semiconductor Detector Systems》：探测器系统、信号形成、电子学噪声、'
        '信号处理、基础数字电子学、晶体管与放大器。**按主体归探测层**（探测器系统），'
        '其中第 3–4 章（噪声、信号处理）是核电子学层的重要补充 —— 这也是它与 Nakhostin '
        '分层的理由：Spieler 从探测器出发讲电子学，Nakhostin 从电子学出发讲信号处理。'
    ),
    'nuclear-physics-experiment-methods-1997': (
        '《原子核物理实验方法》修订第 3 版：**后继课教材**。兰州大学大纲的先修栏写'
        '「核电子学和原子核物理」，即它排在核电子学之后（curriculum_report.md 第 7 节'
        '结论 4 明确要求从书目清单的 D 实验层移到后继位置）。15 章覆盖统计、探测器、'
        '符合法、活度/能谱/中子/低水平测量、截面与寿命测量。'
    ),
    'leo-2e': (
        'Leo《Techniques for Nuclear and Particle Physics Experiments》第 2 版：实验技术'
        '总论，18 章里 11、14–18 章是电子学（脉冲信号、脉冲处理电子学、幅度选择与符合、'
        '逻辑、定时、CAMAC），其余是探测器与统计。**按主体归实验方法层**：它的组织方式是'
        '「怎么做实验」，电子学章节是为实验服务的（书目清单第 12 行 C 专题）。'
    ),
    'debertin-1988': (
        'Debertin & Helmer《Gamma- and X-Ray Spectrometry with Semiconductor Detectors》：'
        '本底材料、实验装置、能谱分析与能量测量、效率刻度、应用、原子与核数据 —— '
        '典型的测量方法与数据处理（书目清单第 20 行 D 实验）。'
    ),
    'gilmore-2e-2008': (
        'Gilmore《Practical Gamma-ray Spectrometry》第 2 版：计数统计、分辨率、谱仪刻度、'
        '真符合相加、能谱分析、故障排查、低/高计数率系统 —— 测量方法与数据处理'
        '（书目清单第 17 行 C 专题）。'
    ),
    'tsoulfanidis-4e': (
        'Tsoulfanidis《Measurement and Detection of Radiation》第 4 版：计数误差、'
        '能量损失、各类探测器、相对与绝对测量、能谱学、数据分析方法、活化分析 —— '
        '测量方法课教材（书目清单第 8 行 B 探测，但按课程归属是测量方法）。'
    ),
}


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def build(book_ids: list[str] | None = None) -> dict:
    """组装 `content/course-map.json` 的 payload。

    `book_ids` 缺省取 `BOOK_TO_LAYER` 的键（27 本）。传进来是为了让测试能喂
    「少一本」的清单，验证 `validate()` 真的会红。
    """
    ids = list(book_ids if book_ids is not None else BOOK_TO_LAYER)
    books = []
    for source_id in ids:
        layer_id = BOOK_TO_LAYER.get(source_id)
        books.append({
            'sourceId': source_id,
            'layerId': layer_id,
            'reason': BOOK_TO_LAYER_REASON.get(source_id, ''),
        })
    return {
        'version': 1,
        'generatedAt': _now(),
        'layers': [
            {
                'id': layer.id,
                'name': layer.name,
                'semesterFrom': layer.semester_from,
                'semesterTo': layer.semester_to,
                'ordinal': layer.ordinal,
                'kind': layer.kind,
            }
            for layer in LAYERS
        ],
        'books': books,
    }


def validate(payload: dict) -> list[str]:
    """返回问题清单（空 = 合格）。测试与 CLI 共用同一套判据。"""
    problems: list[str] = []
    declared = {layer['id'] for layer in payload.get('layers', [])}
    if declared != set(LAYER_BY_ID):
        problems.append(f'layers 与 LAYERS 常量不一致：{sorted(declared ^ set(LAYER_BY_ID))}')

    ordinals = [layer['ordinal'] for layer in payload.get('layers', [])]
    if len(set(ordinals)) != len(ordinals):
        problems.append(f'课程层 ordinal 有重复：{ordinals}')
    if ordinals != sorted(ordinals):
        problems.append(f'课程层 ordinal 未按升序声明：{ordinals}')
    for layer in payload.get('layers', []):
        if layer['semesterFrom'] > layer['semesterTo']:
            problems.append(f"{layer['id']} 的学期区间反了：{layer['semesterFrom']}–{layer['semesterTo']}")

    seen: dict[str, str] = {}
    for book in payload.get('books', []):
        sid, lid = book['sourceId'], book['layerId']
        if sid in seen:
            problems.append(f'同一本书映射了两次：{sid}')
        seen[sid] = lid or ''
        if lid is None:
            problems.append(f'{sid} 没有映射到任何课程层')
        elif lid not in declared:
            problems.append(f'{sid} 的层 {lid} 不在 layers 声明里')
        if not (book.get('reason') or '').strip():
            problems.append(f'{sid} 没有写理由')
    missing = set(BOOK_TO_LAYER) - set(seen)
    extra = set(seen) - set(BOOK_TO_LAYER)
    if missing:
        problems.append(f'常量表里有、产物里缺的书：{sorted(missing)}')
    if extra:
        problems.append(f'产物里有、常量表没有的书：{sorted(extra)}')
    return problems


def discover_books() -> list[str]:
    """仓库里实际存在的书（`content/*/toc.json` 的 sourceId）。

    用目录扫描而不是硬编码清单，是为了让「新增一本书却没加映射」这件事
    在测试里直接红掉 —— 否则新书会静默地 `course_layer_id = NULL`，
    地图上落在「未归层」里没人发现。
    """
    books = []
    for toc in sorted(CONTENT.glob('*/toc.json')):
        try:
            payload = json.loads(toc.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            continue
        source_id = payload.get('sourceId')
        if source_id:
            books.append(source_id)
    return books


def write_course_map(path: Path | None = None, book_ids: list[str] | None = None) -> Path:
    out = path or (CONTENT / 'course-map.json')
    payload = build(book_ids)
    problems = validate(payload)
    if problems:
        raise SystemExit('course-map 自检失败：\n  ' + '\n  '.join(problems))
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return out


def load_course_map(path: Path | None = None) -> dict:
    src = path or (CONTENT / 'course-map.json')
    return json.loads(src.read_text(encoding='utf-8'))


def apply_to_db(database_url: str, *, dry_run: bool = False) -> dict:
    """把 `course-map.json` 同步到 `app.modules`（回填存量行）。

    为什么需要它：`import-content.ts` 只在**导入那一刻**写 `course_layer_id`，
    而库里已有的 362 个模块是 0061 之前导入的。重导 27 本要重写 8.6 万条 chunk
    （id 会漂、耗时以十分钟计），而这件事本质上只是「给每本书的模块补一个层」——
    一条 UPDATE 就能做完，没必要为它重跑内容管线。

    两个写入路径读同一份 `course-map.json`（单一真源）：
    - 新导入 → `import-content.ts`；
    - 存量回填 → 这里。
    """
    import psycopg

    payload = load_course_map()
    problems = validate(payload)
    if problems:
        raise SystemExit('course-map 自检失败：\n  ' + '\n  '.join(problems))
    layer_of = {b['sourceId']: b['layerId'] for b in payload['books']}
    kind_of = {layer['id']: layer['kind'] for layer in payload['layers']}

    stats = {'books': 0, 'modules': 0, 'unmapped': 0, 'unknownLayer': 0}
    with psycopg.connect(database_url, options='-c search_path=app,public') as conn:
        with conn.cursor() as cur:
            for source_id, layer_id in sorted(layer_of.items()):
                kind = kind_of.get(layer_id or '')
                if layer_id is None or kind is None:
                    stats['unknownLayer'] += 1
                    continue
                # 论文模块（`mod-paper-*`）不在这里：它们的 id 前缀不是 `mod-<书>-`。
                # 用 id 前缀匹配而不是 join sources，是因为 modules 没有 source_id 列。
                cur.execute(
                    """
                    UPDATE modules
                       SET course_layer_id = %s, tier = %s
                     WHERE id LIKE %s AND course_layer_id IS DISTINCT FROM %s
                    """,
                    (layer_id, kind, f'mod-{source_id}-%', layer_id),
                )
                stats['modules'] += cur.rowcount
                stats['books'] += 1
            cur.execute('SELECT count(*) FROM modules WHERE course_layer_id IS NULL')
            stats['unmapped'] = cur.fetchone()[0]
            if dry_run:
                conn.rollback()
            else:
                conn.commit()
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='课程层映射：生成 content/course-map.json，可选回填数据库')
    parser.add_argument('--out', type=Path, default=None, help='产物路径（默认 content/course-map.json）')
    parser.add_argument('--apply', action='store_true', help='把映射写入 app.modules.course_layer_id')
    parser.add_argument('--dry-run', action='store_true', help='与 --apply 合用：只算不写')
    parser.add_argument(
        '--database-url',
        default='postgres://postgres:postgres@127.0.0.1:5432/starmap',
        help='数据库连接串',
    )
    parser.add_argument('--check', action='store_true', help='只做自检，不写文件')
    args = parser.parse_args(argv)

    if args.check:
        problems = validate(build())
        if problems:
            print('✗ course-map 自检失败：')
            for p in problems:
                print('   ', p)
            return 1
        print(f'✓ course-map 自检通过（{len(LAYERS)} 层 / {len(BOOK_TO_LAYER)} 本）')
        return 0

    out = write_course_map(args.out)
    print(f'✓ 写入 {out.relative_to(REPO)}（{len(BOOK_TO_LAYER)} 本 / {len(LAYERS)} 层）')

    if args.apply:
        stats = apply_to_db(args.database_url, dry_run=args.dry_run)
        verb = '预演' if args.dry_run else '写入'
        print(
            f'✓ {verb} app.modules：{stats["books"]} 本书、{stats["modules"]} 个模块更新，'
            f'仍未归层 {stats["unmapped"]} 个'
        )
    return 0


if __name__ == '__main__':
    sys.exit(main())
