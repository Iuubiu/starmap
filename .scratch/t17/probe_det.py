import sys, glob, time
sys.path.insert(0, 'tools/ingest')
import pymupdf
from ocr import OcrEngine, ocr_page, RAPIDOCR_SITE

DET = str(RAPIDOCR_SITE / 'models' / 'ch_PP-OCRv3_det_infer.onnx')
pdf = glob.glob('资源库/books/01_*.pdf')[0]
doc = pymupdf.open(pdf)
PAGES = (60, 61, 100)

eng = OcrEngine()
base = [ocr_page(eng, doc, i) for i in PAGES]
print('base', [(p.page, round(p.elapsed, 2), round(p.mean_conf, 3), p.line_count) for p in base])
bt = [p.text for p in base]

eng2 = OcrEngine(det_model_path=DET, det_limit_type='max', det_limit_side_len=960)
fast = [ocr_page(eng2, doc, i) for i in PAGES]
print('fast', [(p.page, round(p.elapsed, 2), round(p.mean_conf, 3), p.line_count) for p in fast])
for a, b in zip(bt, [p.text for p in fast]):
    print('  same' if a == b else f'  DIFF {len(a)} vs {len(b)}')

eng3 = OcrEngine(det_model_path=DET, det_limit_type='max', det_limit_side_len=1280)
mid = [ocr_page(eng3, doc, i) for i in PAGES]
print('max1280', [(p.page, round(p.elapsed, 2), round(p.mean_conf, 3), p.line_count) for p in mid])
