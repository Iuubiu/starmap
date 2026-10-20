"""Probe 8: how do we get throughput — parallel pages on OpenVINO CPU?

Single-page OV CPU is ~3.1 s (det 1.46 + cls 0.05 + rec 1.48). The box has 22 logical
cores, so the real question is whether page-level parallelism scales, and whether an
OpenVINO throughput hint helps a single stream.
"""
import sys
import time

import numpy as np
import openvino as ov
import pymupdf
from concurrent.futures import ThreadPoolExecutor

SITE = 'C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime/'
MODELS = SITE + 'models/'
sys.path.insert(0, SITE)
from rapidocr_onnxruntime import RapidOCR

BOOK = '资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf'
PAGES = list(range(60, 70))


class OVSession:
    def __init__(self, model_path, device, meta, cfg=None):
        core = ov.Core()
        m = core.read_model(model_path)
        self.compiled = core.compile_model(m, device, cfg or {})
        self.i = [x.get_any_name() for x in self.compiled.inputs][0]
        self.o = [x.get_any_name() for x in self.compiled.outputs][0]
        self.meta = meta

    def __call__(self, x):
        return [self.compiled({self.i: x})[self.o]]

    def have_key(self, key='character'):
        return key in self.meta

    def get_character_list(self, key='character'):
        return self.meta[key].splitlines()


def make_engine(device='CPU', cfg=None):
    eng = RapidOCR()
    meta = eng.text_recognizer.session.session.get_modelmeta().custom_metadata_map
    for mod, name in [(eng.text_detector, 'ch_PP-OCRv3_det_infer.onnx'),
                      (eng.text_cls, 'ch_ppocr_mobile_v2.0_cls_infer.onnx'),
                      (eng.text_recognizer, 'ch_PP-OCRv3_rec_infer.onnx')]:
        mod.session = OVSession(MODELS + name, device, meta, cfg)
    return eng


def render(doc, i, dpi=200):
    pix = doc[i].get_pixmap(dpi=dpi)
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    return np.ascontiguousarray(a[:, :, :3][:, :, ::-1])


if __name__ == '__main__':
    doc = pymupdf.open(BOOK)
    imgs = [render(doc, i) for i in PAGES]
    print('pages', len(imgs), imgs[0].shape)

    for label, cfg in [
        ('default', None),
        ('throughput', {'PERFORMANCE_HINT': 'THROUGHPUT'}),
        ('latency', {'PERFORMANCE_HINT': 'LATENCY'}),
        ('streams4', {'NUM_STREAMS': 4}),
        ('threads4', {'INFERENCE_NUM_THREADS': 4}),
    ]:
        eng = make_engine('CPU', cfg)
        t0 = time.time()
        n = 0
        for im in imgs[:3]:
            r, _ = eng(im)
            n += len(r or [])
        dt = (time.time() - t0) / 3
        print(f'{label}: {dt:.2f}s/page rows~{n/3:.0f}')

    # parallel pages, one engine per worker
    for workers in (2, 4, 6, 8):
        engines = [make_engine('CPU', {'NUM_STREAMS': 1}) for _ in range(workers)]

        def work(k):
            r, _ = engines[k % workers](imgs[k])
            return len(r or [])

        t0 = time.time()
        with ThreadPoolExecutor(max_workers=workers) as ex:
            rows = list(ex.map(work, range(len(imgs))))
        dt = (time.time() - t0) / len(imgs)
        print(f'parallel workers={workers}: {dt:.2f}s/page rows~{sum(rows)/len(rows):.0f}')
