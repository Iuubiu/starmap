"""Probe 9: (a) can we OCR a scanned TOC page and feed it to parse_toc_text?
(b) rec_batch_num tuning on OpenVINO CPU."""
import sys, time
import numpy as np, openvino as ov, pymupdf

SITE = 'C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime/'
MODELS = SITE + 'models/'
sys.path.insert(0, SITE)
sys.path.insert(0, 'tools/ingest')
from rapidocr_onnxruntime import RapidOCR
from toc import parse_toc_text


class OVSession:
    def __init__(self, path, device='CPU', meta=None, cfg=None):
        core = ov.Core()
        self.compiled = core.compile_model(core.read_model(path), device, cfg or {})
        self.i = [x.get_any_name() for x in self.compiled.inputs][0]
        self.o = [x.get_any_name() for x in self.compiled.outputs][0]
        self.meta = meta or {}
    def __call__(self, x):
        return [self.compiled({self.i: x})[self.o]]
    def have_key(self, key='character'):
        return key in self.meta
    def get_character_list(self, key='character'):
        return self.meta[key].splitlines()


def make_engine(rec_batch=6):
    eng = RapidOCR()
    meta = eng.text_recognizer.session.session.get_modelmeta().custom_metadata_map
    for mod, name in [(eng.text_detector, 'ch_PP-OCRv3_det_infer.onnx'),
                      (eng.text_cls, 'ch_ppocr_mobile_v2.0_cls_infer.onnx'),
                      (eng.text_recognizer, 'ch_PP-OCRv3_rec_infer.onnx')]:
        mod.session = OVSession(MODELS + name, 'CPU', meta)
    eng.text_recognizer.rec_batch_num = rec_batch
    return eng


def render(doc, i, dpi=200):
    pix = doc[i].get_pixmap(dpi=dpi)
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    return np.ascontiguousarray(a[:, :, :3][:, :, ::-1])


doc = pymupdf.open('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf')
eng = make_engine()
for i in range(0, 16):
    t = doc[i].get_text().strip()
    nimg = len(doc[i].get_images())
    print(f'p{i}: text={len(t)} imgs={nimg}')

print('\n--- OCR of pages 5..13 (looking for 目录) ---')
for i in range(5, 14):
    r, el = eng(render(doc, i))
    txt = '\n'.join(row[1] for row in (r or []))
    ents = parse_toc_text(txt)
    print(f'p{i}: rows={len(r or [])} chars={len(txt)} tocEntries={len(ents)}')
    if ents:
        for e in ents[:6]:
            print('   ', e)
