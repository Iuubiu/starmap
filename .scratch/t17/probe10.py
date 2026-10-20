import sys
import numpy as np, openvino as ov, pymupdf
SITE='C:/Users/Yhwhy/scoop/apps/python/current/Lib/site-packages/rapidocr_onnxruntime/'
MODELS=SITE+'models/'
sys.path.insert(0,SITE)
from rapidocr_onnxruntime import RapidOCR
class OVSession:
    def __init__(self, path, device='CPU', meta=None, cfg=None):
        core=ov.Core(); self.compiled=core.compile_model(core.read_model(path), device, cfg or {})
        self.i=[x.get_any_name() for x in self.compiled.inputs][0]; self.o=[x.get_any_name() for x in self.compiled.outputs][0]; self.meta=meta or {}
    def __call__(self,x): return [self.compiled({self.i:x})[self.o]]
    def have_key(self,key='character'): return key in self.meta
    def get_character_list(self,key='character'): return self.meta[key].splitlines()
eng=RapidOCR(); meta=eng.text_recognizer.session.session.get_modelmeta().custom_metadata_map
for mod,name in [(eng.text_detector,'ch_PP-OCRv3_det_infer.onnx'),(eng.text_cls,'ch_ppocr_mobile_v2.0_cls_infer.onnx'),(eng.text_recognizer,'ch_PP-OCRv3_rec_infer.onnx')]:
    mod.session=OVSession(MODELS+name,'CPU',meta)
doc=pymupdf.open('资源库/books/01_核电子技术原理_王芝英_原子能1989.pdf')
def render(i,dpi=200):
    pix=doc[i].get_pixmap(dpi=dpi); a=np.frombuffer(pix.samples,dtype=np.uint8).reshape(pix.h,pix.w,pix.n)
    return np.ascontiguousarray(a[:,:,:3][:,:,::-1])
for i in [8,10,11,12]:
    r,_=eng(render(i))
    print(f'===== p{i} =====')
    for row in (r or []):
        print(repr(row[1]), row[2][:4])
