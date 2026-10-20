"""Probe 4: why is the iGPU slow, and can static shapes fix it?

The rec model has a dynamic width (max over the batch), so every new batch shape makes
OpenVINO re-compile on the GPU. Try reshaping to a fixed width and re-benchmark.
"""
import sys
import time

import numpy as np
import openvino as ov

SITE = 'C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime/'
MODELS = SITE + 'models/'
sys.path.insert(0, SITE)

import pymupdf
from rapidocr_onnxruntime import RapidOCR


def load_page(pdf, index, dpi=200):
    doc = pymupdf.open(pdf)
    pix = doc[index].get_pixmap(dpi=dpi)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    return img[:, :, :3][:, :, ::-1].copy()


class OVSession:
    def __init__(self, model, device='CPU', meta=None, static=None):
        core = ov.Core()
        m = core.read_model(model)
        if static:
            m.reshape(static)
        self.compiled = core.compile_model(m, device)
        self.in_names = [i.get_any_name() for i in self.compiled.inputs]
        self.out_names = [o.get_any_name() for o in self.compiled.outputs]
        self._meta = meta or {}

    def __call__(self, x):
        return [self.compiled({self.in_names[0]: x})[self.out_names[0]]]

    def have_key(self, key='character'):
        return key in self._meta

    def get_character_list(self, key='character'):
        return self._meta[key].splitlines()


def bench(label, engine, img):
    t0 = time.time()
    res, elapse = engine(img)
    dt = time.time() - t0
    print(f'{label}: {dt:.2f}s rows={len(res or [])} elapse={[round(e,2) for e in (elapse or [])]}')
    return [r[1] for r in (res or [])]


if __name__ == '__main__':
    img = load_page('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf', 60)

    base = RapidOCR()
    meta = base.text_recognizer.session.session.get_modelmeta().custom_metadata_map

    # GPU with dynamic shapes: measure first page and a second page (new widths)
    for dev, static in [('GPU', None), ('GPU', True), ('CPU', None)]:
        eng = RapidOCR()
        t0 = time.time()
        if static:
            det_m = ov.Core().read_model(MODELS + 'ch_PP-OCRv3_det_infer.onnx')
            # det output stride 32, input must be multiple of 32; page is 2423x1740 -> min side 736
            eng.text_detector.session = OVSession(
                MODELS + 'ch_PP-OCRv3_det_infer.onnx', dev, meta,
                static={1: [1, 3, 736, 1024]})
            # rec: batch 6 x 48 x 480
            eng.text_recognizer.session = OVSession(
                MODELS + 'ch_PP-OCRv3_rec_infer.onnx', dev, meta,
                static={0: [6, 3, 48, 480]})
            eng.text_recognizer.rec_batch_num = 6
            eng.text_cls.session = OVSession(
                MODELS + 'ch_ppocr_mobile_v2.0_cls_infer.onnx', dev, meta)
        else:
            for mod, name in [(eng.text_detector, 'ch_PP-OCRv3_det_infer.onnx'),
                              (eng.text_cls, 'ch_ppocr_mobile_v2.0_cls_infer.onnx'),
                              (eng.text_recognizer, 'ch_PP-OCRv3_rec_infer.onnx')]:
                mod.session = OVSession(MODELS + name, dev, meta)
        print(f'== {dev} static={bool(static)} compile {time.time()-t0:.1f}s')
        try:
            bench('  page60', eng, img)
            bench('  page60 again', eng, img)
        except Exception as e:
            print('  FAILED:', type(e).__name__, str(e)[:300])
