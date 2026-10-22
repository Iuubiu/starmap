"""跨书先修边：把「这本书的这一节」接到「那本书的那一节」上。

## 为什么需要跨书边

书内先修边（`tools/ingest/edges.py`）只能表达「同一本书里 3.1 在 3.2 之前」。
但票 18 AC2 要的是**课程先修关系**：阎石的「逐次逼近型 A/D 转换器」是王芝英
「逐次比较型模数变换器」的先修，这两节分属两本书、两个课程层。书内边永远
表达不了这条关系，图谱就只能是一堆互不相连的书。

## 为什么是白名单，不是自动匹配

试过三种自动方案，全部否决（数字见 `sweep_candidates()` 的拒绝统计）：

1. **共享中文二元组**：27 本去噪后 2947 个名字，相邻层精确同名 216 对，
   但绝大多数是「光电效应 / 康普顿散射 / 轫致辐射」这类**同一物理概念在两本
   教材里各讲一遍**（`ahmed-2e → leo-2e` 20 对、`jichangsong → methods` 13 对）。
   这类边不是先修，是重复；连上去会让学习者先被要求「掌握」一个他还没学过的
   同名节点，永远卡住。
2. **术语表子串命中 + 相邻层**：971 个原始叶对，噪声更大（「计数器」480 对）。
3. **归一化整名相等**：7582 对，其中大量是 `未收录术语（…）` 归一化后撞名。

真正的判据不是「两个名字有共同词」，而是「后一本书的这一节在讲前一本书那一节
的**直接应用**」。这是教学判断，只能逐条写下来并附理由 —— 和 `course_map.py`
的 27 条映射同一个道理。白名单的代价是覆盖不全（32 条，不是 200 条），
收益是每一条都能被审。

## 三条判据（每条边至少满足两条）

1. **层序**（必要条件）：`from` 的课程层 ordinal 严格小于 `to` 的。
   同层不许连边 —— 同层是并行课，没有先后。
2. **术语对应**：两节名字里有共同的确定性术语（不做模糊匹配，命中词写进
   `matchedTerms` 与 `evidence`）。跨书的**同义不同词**（核电子学叫「逐次比较」、
   数字电路叫「逐次逼近」）不算共同术语，单独记进 `synonymPairs` —— 它证明的是
   「同一件事」，不是「同一个词」，不能拿来当 `term_match` 成立。
3. **人工白名单**：逐条附 `reason`（为什么是应用关系）与 `curriculumSource`
   （课程调研报告里的出处）。

`basis` 记录这条边实际靠哪几条成立：`layer_order+term_match`（两端名字确有共同
术语）或 `whitelist`（没有共同术语，靠人工判定的应用关系）。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path
from typing import NamedTuple

from course_map import BOOK_TO_LAYER, LAYER_BY_ID, LAYERS, REPO, CONTENT

#: 课程层 ordinal，用于层序判据。
LAYER_ORD: dict[str, int] = {layer.id: layer.ordinal for layer in LAYERS}


class CrossEdge(NamedTuple):
    """一条策展的跨书先修边。"""

    from_id: str
    to_id: str
    #: 术语证据。两种写法：
    #: - `'阶跃响应'` —— 两端名字都含这个词，可作 `term_match` 判据；
    #: - `'逐次逼近≈逐次比较'` —— 跨书的同义不同词，只作说明，不算共同术语。
    matched: tuple[str, ...]
    reason: str
    curriculum: str

    @property
    def common_terms(self) -> list[str]:
        return [t for t in self.matched if '≈' not in t]

    @property
    def synonym_pairs(self) -> list[list[str]]:
        return [t.split('≈', 1) for t in self.matched if '≈' in t]


#: 32 条跨书先修边。方向约定与书内边一致：**from 是先修，to 是后继**。
#:
#: 每一条都要能回答「后一本书这一节为什么用得上前一本书那一节」。写不出这句话
#: 的边不该存在 —— 图谱上的箭头会被推荐引擎当成硬门槛（`prereqSatisfied`），
#: 一条错边就是一条永久卡住学习者的死路。
WHITELIST: tuple[CrossEdge, ...] = (
    # ---- 电路分析(10) → 模拟电子技术(20) ----
    CrossEdge(
        'kp-lihansun-5e-vol1-6-3', 'kp-tongshibai-5e-5-6-1',
        ('阶跃响应',),
        '李瀚荪 6.3 从一阶 RC 电路解出阶跃响应（时间常数、上升过程）；童诗白 5.6.1 '
        '把同一套一阶响应换算成放大器的上升时间、超调量等指标。没有 RC 阶跃响应的'
        '解析式，放大器阶跃指标只能背结论。',
        'curriculum_report.md 第 2 节：电路分析第 2–3 学期 → 模拟电子技术第 3–4 学期',
    ),
    CrossEdge(
        'kp-lihansun-5e-vol1-7-3', 'kp-tongshibai-5e-5-1-2',
        (),
        '李瀚荪 7.3 的 RLC 串联电路零状态响应给出谐振、品质因数与幅频特性；童诗白 '
        '5.1.2 的「频率响应的基本概念」直接建立在这个幅频/相频描述上（波特图之前'
        '必须先有幅频特性的概念）。',
        'curriculum_report.md 第 2 节：电路分析 → 模拟电子技术（学期相差 1 个学期）',
    ),
    # ---- 模拟电子技术(20) → 核电子学(50) ----
    CrossEdge(
        'kp-tongshibai-5e-6-2-1', 'kp-wangzhiying-1989-p42-电荷灵敏前置放大器的基本电路和实例分析',
        (),
        '童诗白 6.2.1 给负反馈放大电路的四条分析要点（闭环增益、输入输出电阻、'
        '深度负反馈的近似）；王芝英 2.2.4 的电荷灵敏前置放大器就是一个并联电压负反馈'
        '放大器，其增益与噪声分析全靠这几条要点。',
        'curriculum_report.md 第 1 节：南华《核电子学C》先修栏「模拟、数字电子技术，原子核物理」',
    ),
    CrossEdge(
        'kp-tongshibai-5e-6-6-4', 'kp-wangzhiying-1989-3-4',
        (),
        '童诗白 6.6.4 讲负反馈放大电路自激振荡的判据与消除（相位补偿）；王芝英 3.4 '
        '的通用谱仪放大器是高增益多级放大器，必须做频率补偿才不会自激 —— 直接沿用'
        '同一套稳定性判据。',
        'curriculum_report.md 第 1 节：模拟电子技术是核电子学的先修课（复旦/南华两份大纲）',
    ),
    CrossEdge(
        'kp-tongshibai-5e-5-1-2', 'kp-wangzhiying-1989-p16-时域和频域分析',
        ('频率响应≈频域分析',),
        '童诗白 5.1.2 建立频率响应的概念；王芝英 1.3.1 的「时域和频域分析」用它把'
        '核电子学系统的传递函数写成 H(jω)，是后面噪声功率谱与最佳滤波推导的起点。',
        'curriculum_report.md 第 1 节：模拟电子技术 → 核电子学',
    ),
    # ---- 数字电子技术(30) → 核电子学(50) ----
    CrossEdge(
        'kp-yanshi-6e-6-3-2', 'kp-wangzhiying-1989-6-1',
        ('计数',),
        '阎石 6.3.2 的计数器是同步/异步二进制计数电路；王芝英 6.1 的核脉冲计数'
        '（定标器）就是把它接在甄别器后面数脉冲，计数容量与计数损失直接由计数器'
        '位数决定。',
        'curriculum_report.md 第 1 节：南华先修栏「数字电子技术」；第 7 节结论 1（数字必须先于核电子学）',
    ),
    CrossEdge(
        'kp-yanshi-6e-8-6-3', 'kp-wangzhiying-1989-4-3-4',
        ('逐次逼近≈逐次比较',),
        '阎石 8.6.3 讲逐次逼近型 A/D 的逐位比较算法与转换时间；王芝英 4.3.4 的'
        '「逐次比较型模数变换器」是同一算法在谱仪 ADC 上的实现（核电子学叫法不同），'
        '连转换位数与线性度的分析都一致。',
        'curriculum_report.md 第 1 节：数字电子技术 → 核电子学；第 7 节结论 1',
    ),
    CrossEdge(
        'kp-yanshi-6e-8-6-4', 'kp-wangzhiying-1989-4-3-3',
        ('双积分型A/D转换≈线性放电型模数变换',),
        '阎石 8.6.4 的双积分型 A/D 用积分器 + 计数器把模拟量变成时间比；王芝英 4.3.3 '
        '的「线性放电型模数变换」是同一原理的谱仪版本（线性放电到零的时间正比于幅度），'
        '是核谱仪 ADC 最经典的方案。',
        'curriculum_report.md 第 1 节：数字电子技术 → 核电子学',
    ),
    CrossEdge(
        'kp-yanshi-6e-8-6-1', 'kp-wangzhiying-1989-4-3-5',
        ('并联比较≈闪电',),
        '阎石 8.6.1 的并联比较型 A/D 用 2^n−1 个比较器一次性出码；王芝英 4.3.5 的'
        '「闪电型模数变换器」就是 flash ADC（英文直译），用于高计数率场合。',
        'curriculum_report.md 第 1 节：数字电子技术 → 核电子学',
    ),
    CrossEdge(
        'kp-yanshi-6e-7-3-2', 'kp-wangzhiying-1989-4-3-2',
        ('单稳态≈展宽',),
        '阎石 7.3.2 的集成单稳态电路输出固定宽度脉冲；王芝英 4.3.2 的线性门和模拟'
        '展宽器用它把随机到达的核脉冲展宽成固定宽度，供后续 ADC 采样 —— 单稳态'
        '宽度直接决定展宽后的脉冲宽度。',
        'curriculum_report.md 第 1 节：数字电子技术 → 核电子学',
    ),
    # ---- 原子核物理(40) → 核电子学(50) ----
    CrossEdge(
        'kp-guojiang-2023-14-1', 'kp-wangzhiying-1989-p10-五核辐射探测器输出信号的数学模拟',
        (),
        '郭江 14.1 给出重带电粒子在介质中的能量损失与射程；王芝英 1.1.5 的探测器'
        '输出信号数学模拟要按「能量沉积在哪里」算电荷收集时间，射程与比电离是输入'
        '参数。',
        'curriculum_report.md 第 1 节：南华先修栏第三项「原子核物理」',
    ),
    # ---- 原子核物理(40) → 探测与测量方法(60) ----
    CrossEdge(
        'kp-guojiang-2023-14-1', 'kp-chenboxian-2011-6-2',
        ('重带电粒子', '相互作用', '物质'),
        '郭江 14.1 是原子核物理课对重带电粒子相互作用的基础推导；陈伯显 6.2 在探测器'
        '语境下重讲同一批公式（Bragg 峰、比电离），是它的直接应用。',
        'curriculum_report.md 第 5 节：郭江（D 先修）→ 陈伯显（B 探测）',
    ),
    CrossEdge(
        'kp-guojiang-2023-14-2', 'kp-chenboxian-2011-6-3',
        ('相互作用', '物质', '快速电子≈快电子'),
        '郭江 14.2 讲快电子的碰撞与辐射能量损失；陈伯显 6.3 用它解释 β 射线在探测器'
        '中的能量沉积与轫致辐射本底。',
        'curriculum_report.md 第 5 节：郭江（D 先修）→ 陈伯显（B 探测）',
    ),
    CrossEdge(
        'kp-guojiang-2023-14-3', 'kp-chenboxian-2011-6-4',
        ('射线', '相互作用', '物质'),
        '郭江 14.3 讲 γ 射线与物质相互作用（光电、康普顿、电子对）；陈伯显 6.4 把三种'
        '作用换算成探测器里的能量沉积谱与峰效率 —— 探测层的 γ 能谱分析全部建立在这'
        '三个系数上。',
        'curriculum_report.md 第 5 节：郭江（D 先修）→ 陈伯显（B 探测）',
    ),
    CrossEdge(
        'kp-guojiang-2023-14-4', 'kp-chenboxian-2011-13-3',
        ('中子', '相互作用', '物质'),
        '郭江 14.4 讲中子与物质的相互作用（弹性/非弹性散射、俘获）；陈伯显 13.3 用它'
        '说明中子探测为什么必须靠核反应产物（中子本身不电离）。',
        'curriculum_report.md 第 5 节：郭江（D 先修）→ 陈伯显（B 探测）',
    ),
    CrossEdge(
        'kp-guojiang-2014-9-5-1', 'kp-chenboxian-2011-1-7',
        ('宇称',),
        '郭江 9.5.1 给出原子核宇称的定义与实验测定；陈伯显 1.7 在「原子核的基本性质」'
        '里用它判断衰变与反应的选择定则。',
        'curriculum_report.md 第 5 节：郭江（D 先修）→ 陈伯显（B 探测）',
    ),
    # ---- 核电子学(50) → 实验方法与数据处理(70) ----
    CrossEdge(
        'kp-wangzhiying-1989-5-3', 'kp-methods-1997-p190-第一节符合法的基本原理',
        ('符合',),
        '王芝英 5.3 讲符合电路的逻辑与分辨时间；《原子核物理实验方法》第 7 章第一节'
        '把它用于测量放射源的绝对活度与角关联 —— 实验层的符合法就是电子学层符合'
        '电路的应用。',
        'curriculum_report.md 第 7 节结论 4：18《原子核物理实验方法》是先修栏写「核电子学和原子核物理」的后继课',
    ),
    CrossEdge(
        'kp-wangzhiying-1989-5-5', 'kp-methods-1997-p389-第一节脉冲形状甄别方法',
        ('甄别', '脉冲波形甄别≈脉冲形状甄别'),
        '王芝英 5.5 的脉冲波形甄别用上升时间/过零 discrimination 区分粒子；实验方法'
        '第 14 章第一节把它用于 n-γ 分辨与粒子鉴别（PSD）。',
        'curriculum_report.md 第 7 节结论 4：methods 是核电子学的后继课',
    ),
    CrossEdge(
        'kp-wangzhiying-1989-5-4-1', 'kp-methods-1997-p422-第二节短核寿命的测量方法',
        (),
        '王芝英 5.4.1 的时间-幅度变换（TAC）把两个信号的时间差变成幅度；实验方法'
        '第 15 章第二节的短核寿命测量正是用 TAC + 多道分析器测延迟符合曲线。',
        'curriculum_report.md 第 7 节结论 4：methods 是核电子学的后继课',
    ),
    CrossEdge(
        'kp-wangzhiying-1989-4-2', 'kp-tsoulfanidis-4e-9-4',
        ('单道',),
        '王芝英 4.2 的单道脉冲幅度分析器用上下甄别器开一个幅度窗；Tsoulfanidis 9.4 '
        '的「差分能谱带单道的测量」就是逐点移动这个窗测微分谱 —— 实验层把单道当'
        '测量工具用。',
        'curriculum_report.md 第 7 节结论 4：测量方法层是核电子学的后继',
    ),
    CrossEdge(
        'kp-wangzhiying-1989-6-4-1', 'kp-leo-2e-18-1',
        (),
        '王芝英 6.4.1 讲 NIM 数字数据总线与 NIM/GPIB 系统；Leo 第 18 章讲 CAMAC —— '
        '同一代核电子学仪器总线标准，实验层的 CAMAC 机箱就是在 NIM 插件体系上'
        '加数字总线。',
        'curriculum_report.md 第 7 节结论 4：Leo 属实验技术层（后继）',
    ),
    CrossEdge(
        'kp-nakhostin-2018-4-4', 'kp-tsoulfanidis-4e-9-3',
        (),
        'Nakhostin 4.4 讲脉冲幅度分析（甄别器 + 峰值保持 + ADC）的电子学实现；'
        'Tsoulfanidis 9.3 用它测「带甄别器的能谱」，是同一套电子学在测量现场的使用。',
        'curriculum_report.md 第 7 节结论 4：测量方法层是核电子学的后继',
    ),
    # ---- 探测与测量方法(60) → 实验方法与数据处理(70) ----
    CrossEdge(
        'kp-knoll-4e-2010-17-1', 'kp-tsoulfanidis-4e-9-4',
        ('单道',),
        'Knoll 17.1 讲单道分析器的方法（窗宽、扫描）；Tsoulfanidis 9.4 用单道逐点测'
        '微分能谱，是同一方法在测量实验里的操作步骤。',
        'curriculum_report.md 第 5 节：Knoll（A 主干/探测）→ Tsoulfanidis（B 探测，课程归属测量方法）',
    ),
    CrossEdge(
        'kp-knoll-4e-2010-17-2', 'kp-methods-1997-p243-三描述谱仪性能的几个量',
        (),
        'Knoll 17.2 讲多道分析器的一般特性（道宽、道数、死时间）；实验方法 9.3 的'
        '「描述谱仪性能的几个量」（能量分辨率、峰康比、峰总比）就是拿多道谱算出来的。',
        'curriculum_report.md 第 7 节结论 4：methods 是后继课',
    ),
    CrossEdge(
        'kp-knoll-4e-2010-16-5', 'kp-methods-1997-p389-第一节脉冲形状甄别方法',
        ('甄别',),
        'Knoll 16.5 讲脉冲形状甄别的电子学实现（上升时间、过零、电荷比较）；实验方法'
        '第 14 章第一节讲 PSD 在 n-γ 分辨中的实验方法。',
        'curriculum_report.md 第 7 节结论 4：methods 是后继课',
    ),
    CrossEdge(
        'kp-knoll-4e-2010-16-4', 'kp-leo-2e-17-4-3',
        ('定时',),
        'Knoll 16.4 讲系统脉冲定时（前沿、恒比、ARC）；Leo 17.4.3 讲实验中的定时系统'
        '（快慢符合、延迟线）—— 后者是前者在实验装置里的落地。',
        'curriculum_report.md 第 7 节结论 4：Leo 属实验技术层（后继）',
    ),
    CrossEdge(
        'kp-knoll-4e-2010-p641-isPulseShaping', 'kp-tsoulfanidis-4e-10-6',
        ('脉冲成形', '成形'),
        'Knoll 第 16 章讲脉冲成形（CR-RC、高斯成形、极零补偿）的原理；Tsoulfanidis '
        '10.6 讲辐射计数电子学里的脉冲成形电路与参数选择。',
        'curriculum_report.md 第 5 节：Knoll（探测）→ Tsoulfanidis（测量方法）',
    ),
    CrossEdge(
        'kp-chenboxian-2011-7-2', 'kp-methods-1997-p6-第二节放射性测量的统计误差',
        ('统计误差',),
        '陈伯显 7.2 从核衰变的统计分布推出放射性测量的统计误差公式；实验方法第 1 章'
        '第二节把同一公式用于实验数据处理（误差传递、测量时间分配）。',
        'curriculum_report.md 第 5 节：陈伯显（B 探测）→ methods（D 实验，后继）',
    ),
    CrossEdge(
        'kp-chenboxian-2011-8-3', 'kp-methods-1997-p82-第三节正比计数器',
        ('正比计数器', '计数器', '计数'),
        '陈伯显 8.3 讲正比计数器的工作原理与气体放大；实验方法第 3 章第三节讲正比'
        '计数器的实验使用（坪曲线、分辨时间、效率刻度）。',
        'curriculum_report.md 第 5 节：陈伯显（B 探测）→ methods（D 实验，后继）',
    ),
    CrossEdge(
        'kp-chenboxian-2011-11-2', 'kp-methods-1997-p186-第七节热释光探测器',
        ('热释光',),
        '陈伯显 11.2 讲热释光探测器的发光机理与剂量响应；实验方法第 6 章第七节讲它的'
        '实验使用方法（退火、刻度、剂量测量）。',
        'curriculum_report.md 第 5 节：陈伯显（B 探测）→ methods（D 实验，后继）',
    ),
    CrossEdge(
        'kp-chenboxian-2011-6-2', 'kp-methods-1997-p30-第二节重带电粒子与物质的相互作用',
        ('重带电粒子', '相互作用', '物质'),
        '陈伯显 6.2 从探测器角度讲重带电粒子的能量损失；实验方法第 2 章第二节把它'
        '作为「射线与物质相互作用」实验课的理论基础（Bragg 曲线测量）。',
        'curriculum_report.md 第 5 节：陈伯显（B 探测）→ methods（D 实验，后继）',
    ),
    CrossEdge(
        'kp-tangbin-6-4', 'kp-debertin-1988-4-1-2',
        ('效率',),
        '汤彬 6.4 讲 γ 射线能量刻度与探测效率刻度的实验步骤；Debertin 第 4 章讲效率'
        '刻度的严谨方法（效率曲线拟合、符合相加修正、不确定度）—— 是同一件事的'
        '深入版。',
        'curriculum_report.md 第 5 节：汤彬（探测）→ Debertin（D 实验，后继）',
    ),
)


# ---------------------------------------------------------------- 读取叶节点


class Leaf(NamedTuple):
    id: str
    book: str
    name: str
    num: str
    page: int | None
    chapter: str


def load_leaves(content_dir: Path | None = None) -> dict[str, Leaf]:
    """从 27 本 `toc.json` 读出全部叶节点，带所属章名（depth==1 祖先）。"""
    root = content_dir or CONTENT
    leaves: dict[str, Leaf] = {}
    for toc in sorted(root.glob('*/toc.json')):
        payload = json.loads(toc.read_text(encoding='utf-8'))
        book = payload.get('sourceId') or toc.parent.name
        nodes = payload.get('nodes', [])
        by_id = {n['microKpId']: n for n in nodes}
        for node in nodes:
            if not node.get('isLeaf'):
                continue
            cur = node
            chapter = ''
            while cur is not None:
                if cur.get('depth') == 1:
                    chapter = cur.get('name') or ''
                    break
                cur = by_id.get(cur.get('parentId')) if cur.get('parentId') else None
            leaves[node['microKpId']] = Leaf(
                id=node['microKpId'],
                book=book,
                name=node.get('name') or '',
                num=node.get('num') or '',
                page=node.get('printedPage'),
                chapter=chapter,
            )
    return leaves


# ---------------------------------------------------------------- 生成


def _layer_of(book: str) -> str | None:
    return BOOK_TO_LAYER.get(book)


def build_edges(
    leaves: dict[str, Leaf] | None = None,
    *,
    chunk_counts: dict[str, int] | None = None,
    whitelist: tuple[CrossEdge, ...] | None = None,
) -> tuple[list[dict], list[dict]]:
    """返回 `(edges, rejected)`。

    `chunk_counts` 给定时额外要求两端都有 chunk（没有内容的节点连上边等于给学习者
    挖一个点不开的坑）；不给时跳过这一条（纯产物生成阶段还没有库可查）。
    """
    leaves = leaves if leaves is not None else load_leaves()
    entries = whitelist if whitelist is not None else WHITELIST
    edges: list[dict] = []
    rejected: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for entry in entries:
        from_leaf = leaves.get(entry.from_id)
        to_leaf = leaves.get(entry.to_id)
        if from_leaf is None or to_leaf is None:
            missing = [i for i in (entry.from_id, entry.to_id) if i not in leaves]
            rejected.append({'from': entry.from_id, 'to': entry.to_id,
                             'reason': 'unknown_leaf', 'detail': ','.join(missing)})
            continue
        from_layer = _layer_of(from_leaf.book)
        to_layer = _layer_of(to_leaf.book)
        if from_layer is None or to_layer is None:
            rejected.append({'from': entry.from_id, 'to': entry.to_id,
                             'reason': 'unmapped_book',
                             'detail': f'{from_leaf.book}/{to_leaf.book}'})
            continue
        if LAYER_ORD[from_layer] >= LAYER_ORD[to_layer]:
            rejected.append({'from': entry.from_id, 'to': entry.to_id,
                             'reason': 'layer_order',
                             'detail': f'{from_layer}({LAYER_ORD[from_layer]}) → '
                                       f'{to_layer}({LAYER_ORD[to_layer]})'})
            continue
        if chunk_counts is not None:
            empty = [i for i in (entry.from_id, entry.to_id) if chunk_counts.get(i, 0) <= 0]
            if empty:
                rejected.append({'from': entry.from_id, 'to': entry.to_id,
                                 'reason': 'no_chunks', 'detail': ','.join(empty)})
                continue
        key = (entry.from_id, entry.to_id)
        if key in seen:
            rejected.append({'from': entry.from_id, 'to': entry.to_id,
                             'reason': 'duplicate'})
            continue
        seen.add(key)

        a, b = LAYER_BY_ID[from_layer], LAYER_BY_ID[to_layer]
        common = entry.common_terms
        synonyms = entry.synonym_pairs
        basis = 'layer_order+term_match' if common else 'whitelist'
        if common:
            terms = '术语命中' + '、'.join(f'「{t}」' for t in common)
        else:
            terms = '无共同术语（人工判定的应用关系）'
        if synonyms:
            terms += '；同义对应' + '、'.join(f'「{x}」≈「{y}」' for x, y in synonyms)
        evidence = (
            f'跨书：{from_leaf.book}·{from_leaf.chapter} → {to_leaf.book}·{to_leaf.chapter}'
            f'（课程层 {a.name} 第 {a.semester_from}–{a.semester_to} 学期 → '
            f'{b.name} 第 {b.semester_from}–{b.semester_to} 学期；{terms}）'
            f'。{entry.reason}'
        )
        edges.append({
            'fromId': entry.from_id,
            'toId': entry.to_id,
            'kind': 'prereq',
            'evidence': evidence,
            'evidenceDetail': {
                'type': 'cross_book',
                'from_book': from_leaf.book,
                'to_book': to_leaf.book,
                'fromLayer': from_layer,
                'toLayer': to_layer,
                'matchedTerms': common,
                'synonymPairs': synonyms,
                'basis': basis,
                'curriculumSource': entry.curriculum,
            },
            'from': {'name': from_leaf.name, 'num': from_leaf.num,
                     'page': from_leaf.page, 'chapter': from_leaf.chapter},
            'to': {'name': to_leaf.name, 'num': to_leaf.num,
                   'page': to_leaf.page, 'chapter': to_leaf.chapter},
        })
    return edges, rejected


def validate(edges: list[dict], leaves: dict[str, Leaf] | None = None) -> list[str]:
    """产物自检：层序、证据、字段完整性。测试与 CLI 共用。"""
    leaves = leaves if leaves is not None else load_leaves()
    problems: list[str] = []
    if not (15 <= len(edges) <= 60):
        problems.append(f'跨书边数量 {len(edges)} 不在 15–60 的目标区间内')
    pairs: set[tuple[str, str]] = set()
    for e in edges:
        fid, tid = e['fromId'], e['toId']
        if (fid, tid) in pairs:
            problems.append(f'重复的边：{fid} → {tid}')
        pairs.add((fid, tid))
        for key in ('fromId', 'toId', 'kind', 'evidence', 'evidenceDetail'):
            if not e.get(key):
                problems.append(f'{fid} → {tid} 缺字段 {key}')
        if e.get('kind') != 'prereq':
            problems.append(f'{fid} → {tid} 的 kind 不是 prereq：{e.get("kind")}')
        text = e.get('evidence') or ''
        if '跨书' not in text:
            problems.append(f'{fid} → {tid} 的 evidence 不含「跨书」')
        detail = e.get('evidenceDetail') or {}
        if detail.get('type') != 'cross_book':
            problems.append(f'{fid} → {tid} 的 evidenceDetail.type 不是 cross_book')
        for key in ('from_book', 'to_book', 'basis', 'curriculumSource'):
            if not detail.get(key):
                problems.append(f'{fid} → {tid} 的 evidenceDetail 缺 {key}')
        fl, tl = detail.get('fromLayer'), detail.get('toLayer')
        if fl not in LAYER_ORD or tl not in LAYER_ORD:
            problems.append(f'{fid} → {tid} 的课程层不在 8 层里：{fl}/{tl}')
        elif LAYER_ORD[fl] >= LAYER_ORD[tl]:
            problems.append(f'{fid} → {tid} 违反层序：{fl} → {tl}')
        for side, leaf_id in (('from', fid), ('to', tid)):
            leaf = leaves.get(leaf_id)
            if leaf is None:
                problems.append(f'{side} 端 {leaf_id} 不是任何一本书的叶节点')
                continue
            if leaf.book != detail.get(f'{side}_book'):
                problems.append(f'{side} 端 {leaf_id} 属于 {leaf.book}，与 evidenceDetail 不一致')
    return problems


# ---------------------------------------------------------------- 候选拒绝统计


_NOISE = re.compile(r'未收录术语|术语表|目录|索引|参考文献|习题|附录|题解|解答|小结|概述|导言|绪论|前言')
_NUM_PREFIX = re.compile(
    r'^\s*(?:第\s*[0-9一二三四五六七八九十百]+\s*[章节篇]'
    r'|[0-9]+(?:\s*[.．\-]\s*[0-9]+)*'
    r'|[一二三四五六七八九十]+\s*[、.．]'
    r'|[§$]\s*[0-9.\-]+)\s*'
)
_PAREN = re.compile(r'[（(][^（()）]*[)）]')
_PUNCT = re.compile(r'[\s，。、；：？！,.;:?!"\'“”‘’（）()\[\]【】<>《》\-—–_/\\|·．.]+')


def normalize_name(name: str) -> str:
    """去掉编号前缀、括号注释与标点，用于「同名」判定。"""
    s = unicodedata.normalize('NFKC', name or '')
    s = _NUM_PREFIX.sub('', s)
    s = _PAREN.sub('', s)
    s = _PUNCT.sub('', s)
    return s


def sweep_candidates(leaves: dict[str, Leaf] | None = None) -> dict:
    """跑一遍自动候选（归一化同名 + 层序），只用于**统计拒绝原因**，不产出边。

    这是给票 18 AC3「可列出全部有证据／无证据的边数」用的诚实账：自动方案能找出
    多少对、其中多少对因为层序被拒、多少对虽然层序合法但不是应用关系（重复讲解）
    而被人工判掉。数字写进 `content/cross-edges.json` 的 `candidateAudit`。
    """
    leaves = leaves if leaves is not None else load_leaves()
    by_norm: dict[str, list[Leaf]] = {}
    for leaf in leaves.values():
        key = normalize_name(leaf.name)
        if len(key) < 4 or _NOISE.search(leaf.name):
            continue
        by_norm.setdefault(key, []).append(leaf)

    stats = Counter()
    same_layer = Counter()
    accepted = {(e['fromId'], e['toId']) for e in build_edges(leaves)[0]}
    for key, group in by_norm.items():
        books = {g.book for g in group}
        if len(books) < 2:
            continue
        stats['concepts_with_multiple_books'] += 1
        for a in group:
            for b in group:
                if a.book == b.book:
                    continue
                la, lb = _layer_of(a.book), _layer_of(b.book)
                if la is None or lb is None:
                    stats['rejected_unmapped_book'] += 1
                    continue
                if LAYER_ORD[la] == LAYER_ORD[lb]:
                    stats['rejected_same_layer'] += 1
                    same_layer[(la, lb)] += 1
                    continue
                if LAYER_ORD[la] > LAYER_ORD[lb]:
                    stats['rejected_reverse_layer'] += 1
                    continue
                stats['layer_order_ok'] += 1
                if (a.id, b.id) in accepted:
                    stats['kept_by_whitelist'] += 1
                else:
                    stats['rejected_not_application'] += 1
    return {
        'normalizedConcepts': len(by_norm),
        'conceptsAcrossBooks': stats['concepts_with_multiple_books'],
        'layerOrderOk': stats['layer_order_ok'],
        'keptByWhitelist': stats['kept_by_whitelist'],
        'rejectedSameLayer': stats['rejected_same_layer'],
        'rejectedReverseLayer': stats['rejected_reverse_layer'],
        'rejectedNotApplication': stats['rejected_not_application'],
        'rejectedUnmappedBook': stats['rejected_unmapped_book'],
        'sameLayerTop': [
            {'fromLayer': a, 'toLayer': b, 'count': c} for (a, b), c in same_layer.most_common(5)
        ],
        'note': (
            '自动候选只做统计，不产出边：归一化同名大多表示「同一物理概念在两本教材里'
            '各讲一遍」，不是先修。真正入图的边全部来自 WHITELIST 并逐条附理由。'
        ),
    }


# ---------------------------------------------------------------- 产物与写库


def build_payload(leaves: dict[str, Leaf] | None = None) -> dict:
    leaves = leaves if leaves is not None else load_leaves()
    edges, rejected = build_edges(leaves)
    return {
        'version': 1,
        'kind': 'cross_book_prereq',
        'edgeCount': len(edges),
        'edges': edges,
        'rejected': rejected,
        'candidateAudit': sweep_candidates(leaves),
    }


def write_cross_edges(path: Path | None = None, leaves: dict[str, Leaf] | None = None) -> Path:
    out = path or (CONTENT / 'cross-edges.json')
    leaves = leaves if leaves is not None else load_leaves()
    payload = build_payload(leaves)
    problems = validate(payload['edges'], leaves)
    if problems:
        raise SystemExit('cross-edges 自检失败：\n  ' + '\n  '.join(problems))
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return out


def apply_to_db(database_url: str, *, dry_run: bool = False) -> dict:
    """把 `content/cross-edges.json` 写进 `app.kp_edges`。

    删除范围**只限** `evidence_detail->>'type' = 'cross_book'`：书内边是
    `edges.py` 的产物，由 `import-content.ts` 管；跨书边是这里的产物，互不覆盖。
    这也是唯一被批准的删边方式（票 18 红线）。
    """
    import psycopg

    payload = json.loads((CONTENT / 'cross-edges.json').read_text(encoding='utf-8'))
    leaves = load_leaves()
    problems = validate(payload['edges'], leaves)
    if problems:
        raise SystemExit('cross-edges 自检失败：\n  ' + '\n  '.join(problems))

    stats = {'deleted': 0, 'inserted': 0, 'missingEndpoint': 0, 'noChunks': 0}
    with psycopg.connect(database_url, options='-c search_path=app,public') as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM knowledge_points WHERE id = ANY(%s)",
                ([e['fromId'] for e in payload['edges']] + [e['toId'] for e in payload['edges']],),
            )
            known = {r[0] for r in cur.fetchall()}
            cur.execute(
                "SELECT micro_kp_id, count(*) FROM chunks WHERE micro_kp_id = ANY(%s) GROUP BY 1",
                ([e['fromId'] for e in payload['edges']] + [e['toId'] for e in payload['edges']],),
            )
            counts = {r[0]: r[1] for r in cur.fetchall()}

            cur.execute("DELETE FROM kp_edges WHERE evidence_detail->>'type' = 'cross_book'")
            stats['deleted'] = cur.rowcount

            for e in payload['edges']:
                if e['fromId'] not in known or e['toId'] not in known:
                    stats['missingEndpoint'] += 1
                    continue
                if counts.get(e['fromId'], 0) <= 0 or counts.get(e['toId'], 0) <= 0:
                    stats['noChunks'] += 1
                    continue
                cur.execute(
                    """
                    INSERT INTO kp_edges (from_id, to_id, kind, evidence, evidence_detail)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (from_id, to_id, kind) DO UPDATE
                      SET evidence = EXCLUDED.evidence,
                          evidence_detail = EXCLUDED.evidence_detail
                    """,
                    (e['fromId'], e['toId'], e['kind'], e['evidence'],
                     json.dumps(e['evidenceDetail'], ensure_ascii=False)),
                )
                stats['inserted'] += 1
            if dry_run:
                conn.rollback()
            else:
                conn.commit()
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='跨书先修边：生成 content/cross-edges.json，可选写入数据库')
    parser.add_argument('--out', type=Path, default=None, help='产物路径（默认 content/cross-edges.json）')
    parser.add_argument('--apply', action='store_true', help='写入 app.kp_edges')
    parser.add_argument('--dry-run', action='store_true', help='与 --apply 合用：只算不写')
    parser.add_argument(
        '--database-url',
        default='postgres://postgres:postgres@127.0.0.1:5432/starmap',
        help='数据库连接串',
    )
    parser.add_argument('--check', action='store_true', help='只做自检，不写文件')
    args = parser.parse_args(argv)

    leaves = load_leaves()
    if args.check:
        edges, rejected = build_edges(leaves)
        problems = validate(edges, leaves)
        if problems:
            print('✗ cross-edges 自检失败：')
            for p in problems:
                print('   ', p)
            return 1
        print(f'✓ cross-edges 自检通过（{len(edges)} 条边，被拒 {len(rejected)} 条白名单项）')
        return 0

    out = write_cross_edges(args.out, leaves)
    edges, rejected = build_edges(leaves)
    print(f'✓ 写入 {out.relative_to(REPO)}（{len(edges)} 条跨书边，白名单被拒 {len(rejected)} 条）')
    audit = sweep_candidates(leaves)
    print(
        f'  自动候选审计：层序合法 {audit["layerOrderOk"]} 对，其中白名单采用 '
        f'{audit["keptByWhitelist"]} 对；同层被拒 {audit["rejectedSameLayer"]}、'
        f'反向被拒 {audit["rejectedReverseLayer"]}、非应用关系被拒 {audit["rejectedNotApplication"]}'
    )

    if args.apply:
        stats = apply_to_db(args.database_url, dry_run=args.dry_run)
        verb = '预演' if args.dry_run else '写入'
        print(
            f'✓ {verb} app.kp_edges：删旧跨书边 {stats["deleted"]}、写入 {stats["inserted"]}'
            f'（端点缺失 {stats["missingEndpoint"]}、无内容 {stats["noChunks"]}）'
        )
    return 0


if __name__ == '__main__':
    sys.exit(main())
