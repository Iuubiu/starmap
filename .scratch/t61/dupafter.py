import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

# 11 处改动的新名字，在同书里是否与既有节点重名？
CASES = {
    'analog-electronics-tongshibai-5e': [('、晶体三极管模型及其参数', '晶体三极管模型及其参数')],
    'nuclear-physics-experiment-methods-1997': [
        ('、倍增过程统计学', '倍增过程统计学'),
        ('、带电粒子在靶物质中的慢化', '带电粒子在靶物质中的慢化'),
        ('、重带电粒子在物质中的能量损失', '重带电粒子在物质中的能量损失'),
        ('、重离子的电子阻止本领', '重离子的电子阻止本领'),
        ('、概述', '概述'),
        ('、中子全截面测量', '中子全截面测量'),
    ],
    'nuclear-radiation-physics-chenboxian-2011': [('。中子探测方法和常用探测器', '中子探测方法和常用探测器')],
    'radiation-detector-handbook-jichangsong-1990': [
        ('：工作原理', '工作原理'),
        ('，光导纤维光导', '光导纤维光导'),
    ],
    'radiation-detectors-dinghonglin-2010': [],
}

for sid, cases in CASES.items():
    nodes = json.loads((Path('content') / sid / 'toc.json').read_text(encoding='utf-8'))['nodes']
    names = {(n.get('name') or '').strip() for n in nodes}
    for before, after in cases:
        print(f'{sid}: {before!r} -> {after!r}  在库同名={after in names}')
