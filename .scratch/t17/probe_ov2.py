"""Probe 2: OpenVINO-backed inference session driving RapidOCR's PP-OCRv3 models.

Answers three questions before committing to an implementation:
  1. does OpenVINO expose the ONNX `character` metadata that the rec CTC decoder needs?
  2. how fast is one full page on CPU vs the Arc iGPU, end-to-end?
  3. do the two paths produce the same text (i.e. is the swap faithful)?
"""
import sys
import time

import numpy as np
import openvino as ov
import pymupdf
import cv2

SITE = 'C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime/'
MODELS = SITE + 'models/'
sys.path.insert(0, SITE)

# ---- Q1: metadata ----
core = ov.Core()
rec = core.read_model(MODELS + 'ch_PP-OCRv3_rec_infer.onnx')
rt = rec.get_rt_info()
print('rt_info keys:', list(rt.keys())[:20])
for k, v in rt.items():
    s = str(v)
    print('  ', k, '->', s[:120].replace('\n', '\\n'))
