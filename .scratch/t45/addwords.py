import io, sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

P = Path('tools/ingest/translate.py')
src = io.open(P, encoding='utf-8', newline='').read()

# 73 个缺词（由 .scratch/t45/missing_groups.txt 实测得出），补齐后 44 组塌缩应全部消解
WORDS = {
    'based': '基于', 'thermoluminescent': '热释光', 'true': '真', 'absence': '无',
    'acquisition': '采集', 'aliasing': '混叠', 'antialiasing': '抗混叠', 'bf': 'BF',
    'biased': '偏置', 'binary': '二进制', 'bubble': '气泡', 'capacitive': '电容性',
    'cavity': '空腔', 'chain': '链', 'coaxial': '同轴', 'complex': '复合',
    'conductivity': '电导率', 'consideration': '考量', 'control': '控制',
    'crossing': '过零', 'crystalline': '晶体', 'custom': '自研', 'dataway': '数据通道',
    'desirable': '理想', 'diamond': '金刚石', 'direct': '直接', 'ecl': '电磁量能器',
    'edge': '前沿', 'emerging': '新兴', 'extrinsic': '非本征', 'fast': '快',
    'fet': '场效应管', 'film': '胶片', 'gaining': '获得', 'ideal': '理想',
    'importance': '重要性', 'indirect': '间接', 'ip': 'IP', 'kinematic': '运动学',
    'leading': '前沿', 'loop': '环路', 'lossless': '无损', 'made': '制',
    'maintaining': '保持', 'microstrip': '微条', 'multiple': '多',
    'optical': '光学', 'optically': '光', 'packaging': '封装', 'powered': '供电',
    'precise': '精密', 'presence': '存在', 'resistive': '电阻性', 'reverse': '反向',
    'routine': '例程', 'sal': 'SAL', 'self': '自', 'semi': '半', 'software': '软件',
    'space': '空间', 'spatial': '空间', 'specific': '特定', 'stimulated': '受激',
    'synchronization': '同步', 'tcp': 'TCP', 'telescopic': '套筒', 'transimpedance': '跨阻',
    'triangular': '三角', 'unbiased': '无偏', 'zero': '零', 'gamma': 'γ',
}

anchor = "    'the': '',\n}\n"
assert anchor in src, 'anchor not found'
block = ''.join(f"    {k!r}: {v!r},\n" for k, v in WORDS.items())
src = src.replace(anchor, "    'the': '',\n" + block + "}\n", 1)
io.open(P, 'w', encoding='utf-8', newline='').write(src)
print('added', len(WORDS), 'words; new size', len(src.encode('utf-8')))
