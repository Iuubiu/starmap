"""t46 改前/改后度量：答案块数量、formula 误判、prose-like formula、中文书对比。

用法：python .scratch/t46/measure.py [--label 改后]
直接重放 content/*/chunks.jsonl（不需要重跑 OCR），用 assign.is_answer_block
与 extract._looks_like_formula 现场判定。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools' / 'ingest'))
from assign import is_answer_block  # noqa: E402
from extract import _looks_like_formula  # noqa: E402

CONTENT = ROOT / 'content'

ZH_BOOKS = {
    'analog-electronics-kanghuaguang-5e', 'analog-electronics-tongshibai-5e',
    'circuit-analysis-lihansun-5e-vol1', 'digital-electronics-yanshi-6e',
    'digital-kanghua-5e', 'nuclear-electronics-wangjingjin-1983',
    'nuclear-electronics-wangzhiying-1989', 'nuclear-physics-experiment-methods-1997',
    'nuclear-radiation-measurement-tangbin', 'nuclear-radiation-physics-chenboxian-2011',
    'radiation-detector-handbook-jichangsong-1990', 'radiation-detectors-dinghonglin-2010',
}


def toc_names(source_id: str) -> list[str]:
    """该书的叶节点名（作为答案块的「知识点术语」）。"""
    p = CONTENT / source_id / 'toc.json'
    if not p.exists():
        return []
    nodes = json.loads(p.read_text(encoding='utf-8')).get('nodes', [])
    return [n.get('name') or '' for n in nodes if n.get('isLeaf')]


def main() -> None:
    label = sys.argv[2] if len(sys.argv) > 2 else '当前'
    rows = []
    for cdir in sorted(CONTENT.iterdir()):
        f = cdir / 'chunks.jsonl'
        if not f.exists():
            continue
        sid = cdir.name
        terms = toc_names(sid)
        total = ans = formula = formula_prose = 0
        for line in f.read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            c = json.loads(line)
            total += 1
            if is_answer_block(c.get('text') or '', c.get('kind') or 'text', terms):
                ans += 1
            if c.get('kind') == 'formula':
                formula += 1
                t = (c.get('text') or '').strip()
                if len(t) > 200 and not any('\u4e00' <= ch <= '\u9fff' for ch in t):
                    formula_prose += 1
        rows.append((sid, sid in ZH_BOOKS, total, ans, formula, formula_prose))

    print(f'== {label} ==')
    print(f'{"sourceId":46s} {"zh":2s} {"chunks":>7s} {"answer":>7s} {"占比":>7s} {"formula":>8s} {"prose":>6s}')
    zh_t = zh_a = en_t = en_a = 0
    for sid, zh, total, ans, formula, prose in rows:
        share = ans / total * 100 if total else 0.0
        print(f'{sid:46s} {"中" if zh else "英":2s} {total:7d} {ans:7d} {share:6.1f}% {formula:8d} {prose:6d}')
        if zh:
            zh_t += total; zh_a += ans
        else:
            en_t += total; en_a += ans
    print(f'{"中文书小计":46s} {"":2s} {zh_t:7d} {zh_a:7d} {zh_a / zh_t * 100 if zh_t else 0:6.1f}%')
    print(f'{"英文书小计":46s} {"":2s} {en_t:7d} {en_a:7d} {en_a / en_t * 100 if en_t else 0:6.1f}%')
    gt, ga = zh_t + en_t, zh_a + en_a
    print(f'{"合计":46s} {"":2s} {gt:7d} {ga:7d} {ga / gt * 100 if gt else 0:6.1f}%')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
