import json
import os

books = [
    ('02-nuclear-electronics-wangjingjin-1983', '02_核电子学_王经瑾上_原子能1983.pdf'),
    ('05-nuclear-radiation-measurement-tangbin', '05_核辐射测量原理_汤彬_哈工程.pdf'),
    ('06-nuclear-radiation-physics-chenboxian', '06_核辐射物理及探测学_陈伯显_张智_哈工程2011.pdf'),
    ('07-radiation-detectors-dinghonglin-2010', '07_核辐射探测器_丁洪林_哈工程2010.pdf'),
    ('18-nuclear-physics-experiment-methods-1997', '18_原子核物理实验方法_修订第3版_1997.pdf'),
    ('19-radiation-detector-handbook-jichangsong-1990', '19_核辐射探测器及其实验技术手册_汲长松_1990.pdf'),
    ('22-analog-electronics-kanghuaguang-5e', '22_电子技术基础_模拟部分_康华光_第5版.pdf'),
    ('23-digital-electronics-yanshi-6e', '23_数字电子技术基础_阎石_第6版.pdf'),
    ('24-analog-electronics-tongshibai-5e', '24_模拟电子技术基础_童诗白_华成英_第5版.pdf'),
    ('25-circuit-analysis-lihansun-5e-vol1', '25_电路分析基础_李瀚荪_第5版_上册.pdf'),
]
out = []
for sid, fn in books:
    p = os.path.join('资源库/books', fn)
    assert os.path.exists(p), p
    out.append({'id': sid, 'pdf': p.replace(os.sep, '/'), 'file': fn})
json.dump(out, open('.scratch/t17/books.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(out), 'books ok')
