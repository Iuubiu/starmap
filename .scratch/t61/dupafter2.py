import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

# 改动后的新名字，在同书里**除自己以外**还有没有同名节点（叶/非叶都算）
CASES = {
    'analog-electronics-tongshibai-5e': ['晶体三极管模型及其参数'],
    'nuclear-physics-experiment-methods-1997': [
        '倍增过程统计学',
        '带电粒子在靶物质中的慢化',
        '重带电粒子在物质中的能量损失',
        '重离子的电子阻止本领',
        '概述',
        '中子全截面测量',
    ],
    'nuclear-radiation-physics-chenboxian-2011': ['中子探测方法和常用探测器'],
    'radiation-detector-handbook-jichangsong-1990': ['工作原理', '光导纤维光导'],
    'radiation-detectors-dinghonglin-2010': ['核探测技术在核科学研究、核试验测试、核技术应用中的作用与地位'],
}

for sid, names in CASES.items():
    nodes = json.loads((Path('content') / sid / 'toc.json').read_text(encoding='utf-8'))['nodes']
    for target in names:
        hits = [(n['microKpId'], n.get('num'), n.get('isLeaf')) for n in nodes if (n.get('name') or '').strip() == target]
        print(f'{sid}: {target!r} 命中 {len(hits)} 个 -> {hits}')
