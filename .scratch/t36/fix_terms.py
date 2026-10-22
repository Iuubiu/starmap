import io, re, pathlib
p = pathlib.Path('tools/ingest/cross_edges.py')
src = p.read_text(encoding='utf-8')

NEW = ['()', '()', '()', '()', "('频率响应≈频域分析',)", '()',
       "('逐次逼近≈逐次比较',)", "('双积分型A/D转换≈线性放电型模数变换',)", "('并联比较≈闪电',)", "('单稳态≈展宽',)",
       '()', '()', "('快速电子≈快电子',)", '()', '()', '()',
       '()', "('脉冲波形甄别≈脉冲形状甄别',)", '()', '()', '()', '()', '()', '()', '()', '()', '()', '()', '()', '()', '()', '()']
assert len(NEW) == 32, len(NEW)

# 第三个位置参数是紧跟在两行 id 之后、缩进 8 空格、形如 ('x',), 的单行
lines = src.split('\n')
out = []
pending = False
idx = 0
for i, line in enumerate(lines):
    if re.match(r"^        'kp-[^']+', 'kp-[^']+',$", line):
        pending = True
        out.append(line)
        continue
    if pending and re.match(r"^        \(.*\),$", line):
        out.append('        ' + NEW[idx] + ',')
        idx += 1
        pending = False
        continue
    pending = False
    out.append(line)
assert idx == 32, idx
p.write_text('\n'.join(out), encoding='utf-8')
print('replaced', idx)
