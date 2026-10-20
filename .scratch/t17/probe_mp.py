"""多进程吞吐测试：每个进程限线程数，跑同样的页，比墙钟时间。"""
import sys, glob, os, time, json
sys.path.insert(0, 'tools/ingest')


def work(pages, threads, out):
    os.environ['OMP_NUM_THREADS'] = str(threads)
    import pymupdf
    from ocr import OcrEngine, ocr_page

    pdf = glob.glob('资源库/books/01_*.pdf')[0]
    doc = pymupdf.open(pdf)
    eng = OcrEngine()
    t0 = time.time()
    confs = []
    for i in [int(x) for x in pages]:
        p = ocr_page(eng, doc, i)
        confs.append((i, round(p.elapsed, 2), round(p.mean_conf, 3)))
    json.dump({'pages': confs, 'wall': round(time.time() - t0, 2)}, open(out, 'w'))


if __name__ == '__main__':
    from multiprocessing import Pool
    import numpy as np
    pages = list(range(200, 216))
    for threads, nproc in ((0, 1), (4, 4), (2, 8)):
        chunks = np.array_split(pages, nproc)
        t0 = time.time()
        with Pool(nproc) as pool:
            pool.starmap(work, [(list(c), threads, f'.scratch/t17/mp_{threads}_{i}.json') for i, c in enumerate(chunks)])
        wall = time.time() - t0
        print(f'threads={threads} procs={nproc}: wall {wall:.1f}s = {wall / len(pages):.2f} s/page')
