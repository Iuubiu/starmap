"""Probe 3: swap RapidOCR's onnxruntime session for an OpenVINO one and benchmark.

Goal: keep RapidOCR's det/cls/rec pre+post-processing untouched, replace only the
inference session, then compare CPU vs Arc iGPU against the onnxruntime baseline on
the same page image.
"""
import sys
import time

import numpy as np
import openvino as ov

SITE = 'C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime/'
sys.path.insert(0, SITE)

import pymupdf
from rapidocr_onnxruntime import RapidOCR


class OVSession:
    """Duck-typed replacement for rapidocr's OrtInferSession."""

    def __init__(self, model_path, device='CPU', meta=None):
        core = ov.Core()
        self.compiled = core.compile_model(model_path, device)
        self.in_names = [i.get_any_name() for i in self.compiled.inputs]
        self.out_names = [o.get_any_name() for o in self.compiled.outputs]
        self._meta = meta or {}

    def __call__(self, input_content):
        return [self.compiled({self.in_names[0]: input_content})[self.out_names[0]]]

    def have_key(self, key='character'):
        return key in self._meta

    def get_character_list(self, key='character'):
        return self._meta[key].splitlines()


def load_page(pdf, index, dpi=200):
    doc = pymupdf.open(pdf)
    pix = doc[index].get_pixmap(dpi=dpi)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n == 1:
        img = np.repeat(img, 3, axis=2)
    else:
        img = img[:, :, :3][:, :, ::-1].copy()
    return img


def timeit(label, engine, img, reps=1):
    texts = []
    best = 1e9
    for _ in range(reps):
        t0 = time.time()
        res, elapse = engine(img)
        dt = time.time() - t0
        best = min(best, dt)
        texts = res or []
    mean_conf = (np.mean([float(r[2]) for r in texts]) if texts else 0.0)
    print(f'{label}: {best:.2f}s rows={len(texts)} meanConf={mean_conf:.3f} elapse={[round(e,2) for e in (elapse or [])]}')
    return texts


if __name__ == '__main__':
    img = load_page('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf', 60)
    print('img', img.shape)

    print('--- baseline onnxruntime CPU ---')
    ort = RapidOCR()
    t_ort = timeit('ort-CPU', ort, img)

    for dev in ['CPU', 'GPU']:
        print(f'--- openvino {dev} ---')
        t0 = time.time()
        eng = RapidOCR()
        models = SITE + 'models/'
        meta = eng.text_recognizer.session.session.get_modelmeta().custom_metadata_map
        for mod, name in [(eng.text_detector, 'ch_PP-OCRv3_det_infer.onnx'),
                          (eng.text_cls, 'ch_ppocr_mobile_v2.0_cls_infer.onnx'),
                          (eng.text_recognizer, 'ch_PP-OCRv3_rec_infer.onnx')]:
            mod.session = OVSession(models + name, dev, meta)
        print(f'  swap+compile took {time.time()-t0:.1f}s')
        t_ov = timeit(f'ov-{dev}', eng, img)

    print('--- text diff vs baseline ---')
    a = [r[1] for r in t_ort]
    b = [r[1] for r in t_ov]
    print('same row count:', len(a) == len(b), len(a), len(b))
    diff = sum(1 for x, y in zip(a, b) if x != y)
    print(f'rows differing: {diff}/{len(a)}')
    for x, y in zip(a, b):
        if x != y:
            print('  ORT:', x)
            print('  OV :', y)
