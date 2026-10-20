"""Probe: can OpenVINO drive the RapidOCR ONNX models on the Arc iGPU, and how fast?"""
import time, sys
import numpy as np
import pymupdf, cv2
import openvino as ov

MODELS = 'C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime/models/'
det = MODELS + 'ch_PP-OCRv3_det_infer.onnx'
rec = MODELS + 'ch_PP-OCRv3_rec_infer.onnx'
cls = MODELS + 'ch_ppocr_mobile_v2.0_cls_infer.onnx'

core = ov.Core()
for dev in ['CPU', 'GPU']:
    for path, name in [(det, 'det'), (rec, 'rec')]:
        t0 = time.time()
        cm = core.compile_model(path, dev)
        print(f'{name}@{dev} compile {time.time()-t0:.2f}s')
        for inp in cm.inputs:
            print('   in', inp.get_any_name(), inp.partial_shape, inp.get_element_type())
        for out in cm.outputs:
            print('   out', out.get_any_name(), out.partial_shape)
