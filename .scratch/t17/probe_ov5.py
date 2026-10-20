"""Probe 5: OpenVINO GPU with static shapes.

det/rec both have rank-dynamic inputs ([?,3,?,?]). reshape needs a plain list spec.
Measure: does static shape kill the per-batch recompile penalty on the Arc iGPU?
"""
import sys
import time

import numpy as np
import openvino as ov
import pymupdf

SITE = 'C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime/'
MODELS = SITE + 'models/'
sys.path.insert(0, SITE)

core = ov.Core()


def compile_static(path, device, shape):
    m = core.read_model(path)
    m.reshape(shape)
    t0 = time.time()
    cm = core.compile_model(m, device)
    return cm, time.time() - t0


for device in ['CPU', 'GPU']:
    print(f'=== {device}')
    for path, name, shape in [
        (MODELS + 'ch_PP-OCRv3_det_infer.onnx', 'det', [1, 3, 960, 1376]),
        (MODELS + 'ch_PP-OCRv3_rec_infer.onnx', 'rec', [6, 3, 48, 480]),
    ]:
        cm, dt = compile_static(path, device, shape)
        x = np.random.rand(*shape).astype(np.float32)
        outs = [o.get_any_name() for o in cm.outputs]
        ins = [i.get_any_name() for i in cm.inputs]
        # warm + measure
        for _ in range(2):
            r = cm({ins[0]: x})
        t0 = time.time()
        for _ in range(5):
            r = cm({ins[0]: x})
        el = (time.time() - t0) / 5
        print(f'  {name} {shape} compile={dt:.2f}s infer={el*1000:.0f}ms out={r[outs[0]].shape}')
