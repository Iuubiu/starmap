import json, sys
sys.path.insert(0, 'tools/ingest')
from cross_edges import WHITELIST, load_leaves
leaves = load_leaves()
STOP = set('电路 分析 基本 方法 系统 测量 原理 概述 一般 特性 计算 应用 处理 技术 信号 数据 时间 幅度 谱仪 探测器 电子学 核辐射 辐射 粒子 物质 相互作用'.split())
def commons(a, b, min_len=3):
    out = set()
    n = len(a)
    for i in range(n):
        for j in range(i + min_len, n + 1):
            s = a[i:j]
            if s in b:
                out.add(s)
    # 去掉被更长串包含的
    kept = [s for s in out if not any(s != t and s in t for t in out)]
    return sorted(kept, key=len, reverse=True)
for e in WHITELIST:
    a, b = leaves[e.from_id].name, leaves[e.to_id].name
    c = [s for s in commons(a, b) if s not in STOP]
    print(f'{a[:22]:24s} -> {b[:24]:26s}  {c[:4]}')
