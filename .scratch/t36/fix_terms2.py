import re, pathlib
p = pathlib.Path('tools/ingest/cross_edges.py')
src = p.read_text(encoding='utf-8')
NEW = [
 "('阶跃响应',)",
 "('频率响应≈频域分析',)",
 "()",
 "()",
 "('频率响应≈频域分析',)",
 "('计数',)",
 "('逐次逼近≈逐次比较',)",
 "('双积分型A/D转换≈线性放电型模数变换',)",
 "('并联比较≈闪电',)",
 "('单稳态≈展宽',)",
 "()",
 "('重带电粒子', '相互作用', '物质')",
 "('相互作用', '物质', '快速电子≈快电子')",
 "('射线', '相互作用', '物质')",
 "('中子', '相互作用', '物质')",
 "('宇称',)",
 "('符合',)",
 "('甄别', '脉冲波形甄别≈脉冲形状甄别')",
 "()",
 "('单道',)",
 "()",
 "()",
 "('单道',)",
 "()",
 "('甄别',)",
 "('定时',)",
 "('脉冲成形', '成形')",
 "('统计误差',)",
 "('正比计数器', '计数器', '计数')",
 "('热释光',)",
 "('重带电粒子', '相互作用', '物质')",
 "('效率',)",
]
assert len(NEW) == 32
lines = src.split('\n'); out=[]; pending=False; idx=0
for line in lines:
    if re.match(r"^        'kp-[^']+', 'kp-[^']+',$", line):
        pending=True; out.append(line); continue
    if pending and re.match(r"^        \(.*\),$", line):
        out.append('        ' + NEW[idx] + ','); idx+=1; pending=False; continue
    pending=False; out.append(line)
assert idx==32, idx
p.write_text('\n'.join(out), encoding='utf-8')
print('ok', idx)
