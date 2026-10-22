"""把目录解析留下的碎片节点修回完整标题（t61）。

## 两类碎片，两种处置 —— 不要用同一套判据

**A 类（实测 10 处）：`name` 以标点开头。**

    `、晶体三极管模型及其参数`     `。中子探测方法和常用探测器`
    `、带电粒子在靶物质中的慢化`   `，光导纤维光导`     `：工作原理`

它们**不是折行**。证据在兄弟行里：tongshibai-5e 的相邻条目是
`二极管模型及其参数` / `三、场效应管模型及其参数` / `四、集成运放模型及其参数`
—— 缺的正是 `二、` 的「二」。OCR 把编号字吃掉了，只剩顿号。
chenboxian-2011 的 `。中子探测方法和常用探测器` 更是带着完整编号 `13.4`，
前后 13.3 / 13.5 都在，`。` 是纯噪声。

→ 处置 = **去掉起首标点**，节点本身保留。不合并：它是一条真条目，
合并会把两节的正文并进一个知识点。

**B 类（实测 1 处）：`name` 不以标点开头，但确实是上一条的续行。**

    `核探测技术在核科学研究、核试验测试、核技术应用中的` + `作用与地位`

→ 处置 = **并进前一个兄弟**，并把碎片名下的 chunk 改挂到保留节点
（`folded_into()` 给出映射，见下面的「为什么 chunk 也要改挂」）。

## B 类的判据：四条同时成立

1. 前一个兄弟的 `name` 以**悬空连接词**结尾（的/与/和/及/或/在/对/把/从/向/
   以/之/为/于/而/并）—— 中文标题不会以这些字结尾，后面必然还有内容；
2. 本节点 `num` 为空 —— 有编号就是独立条目；
3. 与前一兄弟**同父、同 `printedPage`** —— 跨页的续行更像真条目，不猜；
4. 本节点 `name` 不以标点开头。

单靠「不以标点开头」识别是不行的：那会命中所有正常节点。而单靠「前一条以
悬空连接词结尾」也不行 —— 得同时要求无编号且同页。

## C 类误报必须排除（票面点名，判据 1 天然排除）

    `附录A…` / `附录B…`                        （同级真附录，不以连接词结尾）
    `二、同轴型HPGe…` / `三、HPGe探测器…`        （同级真条目）
    `二、探测器望远镜…` / `三、超灵敏加速器质谱仪`  （同级真条目）

三条都以「、」「、」之外的实词结尾，判据 1 就不成立。`report_changes()` 会把
「被看过但没动」的相邻对也列出来，让人能核对这些排除是判据做的、不是漏做。

## 为什么 chunk 也要改挂

B 类合并后碎片节点从 `toc.json` 消失。`import-content.ts` 对 chunk 是
`ON CONFLICT (id) DO UPDATE`，而知识点行若被 `--prune-kp` 删掉，外键
`ON DELETE SET NULL` 会把那些 chunk 的 `micro_kp_id` 置空 —— 票面 AC④
「chunk 归属不丢（`micro_kp_id IS NULL` 不增加）」就破了。所以必须把
`chunks.jsonl` 里的 `micro_kp_id` 先改到保留节点上，让归属在导入前就正确。

## 为什么不改 `ocr.py` 的 `_clean_title`

`toc.py` 被 12 本中文书共用，票面明令不许动它的既有判据；`ocr.py` 的清洗同理
——在那里剥标点会连带改掉正文块的清洗口径。而且 B 类的「并进前一个兄弟」是
**树结构操作**，不是标题清洗，放不进 `_clean_title`。这一步与
`naming.disambiguate_duplicate_names()` 同一层：解析之后的产物规格归一化，
四个写 `toc.json` 的入口各调一次。

## 调用顺序：放在 `disambiguate_duplicate_names()` 之前

去标点是**可能造出重名**的操作：剥掉起首标点后，一个叶节点可能与同书另一个
叶节点同名，那就该由 `disambiguate_duplicate_names()` 拼编号分开；反序则这类
新造出来的重名不会被发现。

**实测当前 11 处改动没有造成任何重名**（对五本书跑 `disambiguate_duplicate_names()`
得到 0 处改名：methods-1997 里其余含「概述」的节点叫 `一概述` / `第一节概述`，
与 `概述` 不同名）。所以顺序在这里是**为将来兜底**，不是当下修了什么 —— 不要
把这句话读成「有 11 处重名被修掉了」。

四个入口里两者的相对顺序见各自调用点。
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

#: 起首标点：与票面 acceptance 的 SQL `name ~ '^[、，。；：）)]'` 逐字对齐。
LEADING_PUNCT = '、，。；：）)'

#: 中文标题不会以这些字结尾 —— 它们是连接词/助词，后面必然还有内容。
DANGLING = '的与和及或在对把从向以之为于而并'

#: 被改动节点的 `(kind, microKpId, 旧名, 新名)`，供测试与审计对账。
#: 由 `merge_fragments()` 填充（调用方每次重算，不跨书累积）。
LAST_CHANGES: list[dict] = []


def _name(node: dict) -> str:
    return (node.get('name') or '').strip()


def _num(node: dict) -> str:
    return (node.get('num') or '').strip()


def is_leading_punct_fragment(node: dict) -> bool:
    """A 类：`name` 以标点开头。"""
    name = _name(node)
    return bool(name) and name[0] in LEADING_PUNCT


def _siblings(nodes: list[dict]) -> dict[str | None, list[int]]:
    """父 id → 该父下节点在 `nodes` 里的下标（按出现顺序，不排序）。

    不按 `printedPage` 排序：`toc.json` 里节点的数组顺序就是目录顺序，
    同页多条时页码分不出先后，排序反而会打乱。
    """
    groups: dict[str | None, list[int]] = {}
    for i, node in enumerate(nodes):
        groups.setdefault(node.get('parentId'), []).append(i)
    return groups


def find_fold_candidates(nodes: list[dict]) -> list[tuple[int, int]]:
    """返回 `(保留节点下标, 碎片节点下标)` 列表（B 类）。"""
    pairs: list[tuple[int, int]] = []
    for _parent, idxs in _siblings(nodes).items():
        for k in range(1, len(idxs)):
            prev = nodes[idxs[k - 1]]
            cur = nodes[idxs[k]]
            prev_name = _name(prev)
            cur_name = _name(cur)
            if not prev_name or not cur_name:
                continue
            if is_leading_punct_fragment(cur):
                continue
            if prev_name[-1] not in DANGLING:
                continue
            if _num(cur):
                continue
            if cur.get('printedPage') != prev.get('printedPage'):
                continue
            pairs.append((idxs[k - 1], idxs[k]))
    return pairs


def merge_fragments(nodes: list[dict]) -> list[dict]:
    """就地修碎片，返回改动列表（空列表 = 无需改，幂等）。

    每项：`{kind: 'strip'|'fold', microKpId, before, after, keeperId?}`。
    `fold` 项的 `microKpId` 在返回后已从 `nodes` 里移除，`keeperId` 是它的新家。
    """
    changes: list[dict] = []

    # ---- A 类：去起首标点 ----
    for node in nodes:
        name = _name(node)
        if not is_leading_punct_fragment(node):
            continue
        stripped = name.lstrip(LEADING_PUNCT).strip()
        if not stripped:
            # 整名就是一个标点：不是标题，交给人工。不猜。
            continue
        node['name'] = stripped
        changes.append(
            {'kind': 'strip', 'microKpId': node.get('microKpId'), 'before': name, 'after': stripped}
        )

    # ---- B 类：并进前一个兄弟 ----
    # 先把 pairs 算出来再改：`nodes` 会被删元素，下标会失效。
    pairs = find_fold_candidates(nodes)
    drop: set[int] = set()
    for keep_i, frag_i in pairs:
        keeper = nodes[keep_i]
        frag = nodes[frag_i]
        merged = f'{_name(keeper)}{_name(frag)}'
        changes.append(
            {
                'kind': 'fold',
                'microKpId': frag.get('microKpId'),
                'before': _name(frag),
                'after': merged,
                'keeperId': keeper.get('microKpId'),
            }
        )
        keeper['name'] = merged
        drop.add(frag_i)

    if drop:
        nodes[:] = [n for i, n in enumerate(nodes) if i not in drop]

    LAST_CHANGES[:] = changes
    return changes


def find_near_misses(nodes: list[dict]) -> list[dict]:
    """列出「差点被当成续行、但被某条判据拒掉」的相邻对，并写明拒的理由。

    票面 AC③ 要求「脚本输出里逐条列出被排除的候选及排除理由」—— 只报改了几处
    是不够的：**没改的那些必须也能被审计**，否则读报告的人无法区分「判据排除了
    它」和「脚本压根没看到它」。

    这里的候选定义刻意比 `find_fold_candidates()` 宽松：只要「同父、本节点无编号、
    页码差 ≤1」就算候选（这三条都过了才可能被误判成续行），然后逐条记下是哪条
    判据拒的。票面点名的三对 C 类（`附录A/附录B`、`二、同轴型HPGe/三、HPGe探测器`、
    `二、探测器望远镜/三、超灵敏加速器质谱仪`）都在这个集合里，理由统一是
    「前一条不以悬空连接词结尾」—— 它们是同级真条目，合了会捏坏两个知识点。
    """
    out: list[dict] = []
    for _parent, idxs in _siblings(nodes).items():
        for k in range(1, len(idxs)):
            prev = nodes[idxs[k - 1]]
            cur = nodes[idxs[k]]
            prev_name = _name(prev)
            cur_name = _name(cur)
            if not prev_name or not cur_name:
                continue
            # A 类会被去标点，不算「被排除的续行候选」。
            if is_leading_punct_fragment(cur):
                continue
            if _num(cur):
                continue
            prev_page = prev.get('printedPage')
            cur_page = cur.get('printedPage')
            if prev_page is None or cur_page is None:
                continue
            delta = cur_page - prev_page
            if abs(delta) > 1:
                continue
            if prev_name[-1] in DANGLING and delta == 0:
                # 真被合并的不会走到这里（`find_fold_candidates` 已经把它拿掉了）。
                continue
            if prev_name[-1] not in DANGLING:
                reason = '前一条不以悬空连接词结尾'
            else:
                reason = f'与前一条不同页（差 {delta} 页，跨页续行不猜）'
            out.append(
                {
                    'prevId': prev.get('microKpId'),
                    'prevName': prev_name,
                    'curId': cur.get('microKpId'),
                    'curName': cur_name,
                    'pageDelta': delta,
                    'reason': reason,
                }
            )
    return out


def format_exclusions(entries: list[dict]) -> list[str]:
    """逐条一行，供 `--explain-exclusions` 打印。"""
    return [
        f"  排除 {e['curId']}（{e['curName']!r}）：{e['reason']}"
        f" —— 前一条 {e['prevId']}（{e['prevName']!r}），页码差 {e['pageDelta']}"
        for e in entries
    ]


def summarize_exclusions(entries: list[dict]) -> str:
    """默认只打一行：分组计数。全量明细要 `--explain-exclusions`。"""
    if not entries:
        return '被排除的续行候选 0 处'
    by_reason: dict[str, int] = {}
    for e in entries:
        by_reason[e['reason']] = by_reason.get(e['reason'], 0) + 1
    parts = '；'.join(f'{k} {v} 处' for k, v in sorted(by_reason.items(), key=lambda kv: -kv[1]))
    return f'被排除的续行候选 {len(entries)} 处（{parts}）—— 逐条理由见 --explain-exclusions'


def folded_into(changes: list[dict]) -> dict[str, str]:
    """`碎片 microKpId → 保留节点 microKpId`，供改写 chunk 归属用。"""
    return {c['microKpId']: c['keeperId'] for c in changes if c['kind'] == 'fold'}


def report_changes(changes: list[dict]) -> str:
    """一行摘要，供入口打印（静默改产物等于没法审计）。"""
    if not changes:
        return '碎片 0 处'
    strips = [c for c in changes if c['kind'] == 'strip']
    folds = [c for c in changes if c['kind'] == 'fold']
    return f'碎片 {len(changes)} 处（去标点 {len(strips)}、合并续行 {len(folds)}）'


def format_changes(changes: list[dict]) -> list[str]:
    """逐条明细（票面 AC③ 要求逐条可核对）。"""
    lines = []
    for c in changes:
        if c['kind'] == 'strip':
            lines.append(f"  去标点 {c['microKpId']}: {c['before']!r} → {c['after']!r}")
        else:
            lines.append(
                f"  合并续行 {c['microKpId']} → {c['keeperId']}: "
                f"{c['before']!r} 并入 {c['after']!r}"
            )
    return lines


# ---- 产物修复（独立 CLI）：toc.json + chunks.jsonl + edges.json ----------------


def _detect_eol(path: Path) -> str:
    """沿用文件现有的换行：`content/**` 里的产物在 Windows 上是 CRLF。

    `books_batch.py` / `toc_batch.py` 用 `io.open(..., 'w')`（没有 `newline=''`），
    在 Windows 上会把 `\\n` 翻成 `\\r\\n`，所以仓库里的 `toc.json` / `chunks.jsonl`
    是 CRLF。这里若强行写 LF，diff 会变成「整个文件都改了」—— 11 处真改动被
    埋进上万行换行噪声里，评审没法看，`git blame` 也废了。所以先探测再沿用。
    """
    raw = path.read_bytes() if path.exists() else b''
    return '\r\n' if b'\r\n' in raw else '\n'


def _write_preserving_eol(path: Path, text: str) -> None:
    """按原文件换行写回（`newline=''` 关掉 Python 自己的翻译）。

    连**结尾有没有换行**也沿用原文件：`json.dumps` 不带尾换行，而仓库里的
    `toc.json` 是带尾换行的（`json.dump` 写进文件后由编辑器/脚本补的）。不沿
    用就会多出一条 `\\ No newline at end of file` 的 diff —— 不是错，但会让
    评审多看一眼无关的地方。
    """
    raw = path.read_bytes() if path.exists() else b''
    eol = '\r\n' if b'\r\n' in raw else '\n'
    had_trailing = raw.endswith(b'\n')
    text = text.rstrip('\n')
    if had_trailing:
        text += '\n'
    if eol != '\n':
        text = text.replace('\n', eol)
    with io.open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def _repoint(path: Path, mapping: dict[str, str], *, dry_run: bool) -> int:
    """把 `chunks.jsonl` / `edges.json` 里指向碎片的 id 改到保留节点。返回改动条数。"""
    if not mapping or not path.exists():
        return 0
    if path.suffix == '.jsonl':
        lines = io.open(path, encoding='utf-8').read().splitlines()
        changed = 0
        out = []
        for line in lines:
            if not line.strip():
                continue
            rec = json.loads(line)
            owner = rec.get('micro_kp_id')
            if owner in mapping:
                rec['micro_kp_id'] = mapping[owner]
                changed += 1
            out.append(json.dumps(rec, ensure_ascii=False))
        if changed and not dry_run:
            _write_preserving_eol(path, '\n'.join(out) + '\n')
        return changed

    doc = json.loads(path.read_text(encoding='utf-8'))
    edges = doc.get('edges')
    if not isinstance(edges, list):
        return 0
    changed = 0
    for edge in edges:
        for key in ('fromId', 'toId'):
            if edge.get(key) in mapping:
                edge[key] = mapping[edge[key]]
                changed += 1
    # 改挂后可能出现自环（碎片与保留节点原本各有一条边）：自环不是先修关系，丢掉。
    before = len(edges)
    doc['edges'] = [e for e in edges if e.get('fromId') != e.get('toId')]
    dropped = before - len(doc['edges'])
    if dropped:
        doc.setdefault('summary', {})['edgeCount'] = len(doc['edges'])
    if (changed or dropped) and not dry_run:
        _write_preserving_eol(path, json.dumps(doc, ensure_ascii=False, indent=2))
    return changed + dropped


def fix_one(toc_path: Path, *, dry_run: bool, explain: bool = False) -> list[dict]:
    """改一本书的三个产物文件，返回改动列表。"""
    toc = json.loads(toc_path.read_text(encoding='utf-8'))
    nodes = toc.get('nodes', [])
    # 排除清单要在 `merge_fragments()` 之前算：它会把碎片节点从 `nodes` 里删掉，
    # 之后再去数「差点被合并的对」就数不到了。
    near_misses = find_near_misses(nodes)
    changes = merge_fragments(nodes)
    if explain:
        # 取证模式：每条都打，逐条可核对。
        for line in format_exclusions(near_misses):
            print(line)
    elif changes and near_misses:
        # 常规模式：只有真改了东西的书才提一句，27 本书都打会淹掉改动明细。
        print(summarize_exclusions(near_misses))
    if not changes:
        return []
    mapping = folded_into(changes)
    if mapping:
        book = toc_path.parent
        _repoint(book / 'chunks.jsonl', mapping, dry_run=dry_run)
        _repoint(book / 'edges.json', mapping, dry_run=dry_run)
    if not dry_run:
        # `nodeCount` 要跟着变：合并会减少节点数。
        payload = {**toc, 'nodeCount': len(nodes), 'nodes': nodes}
        _write_preserving_eol(toc_path, json.dumps(payload, ensure_ascii=False, indent=2))
    return changes


def main() -> int:
    ap = argparse.ArgumentParser(description='修目录碎片：去起首标点 + 合并折行续行（重写 toc.json）')
    ap.add_argument('--content', default='content', help='content 根目录')
    ap.add_argument('--only', nargs='*', help='只处理这些 sourceId')
    ap.add_argument('--dry-run', action='store_true', help='只报告，不写文件')
    ap.add_argument(
        '--explain-exclusions',
        action='store_true',
        help='逐条列出被排除的续行候选及理由（票面 AC③ 的取证口径）',
    )
    args = ap.parse_args()

    paths = sorted(Path(args.content).glob('*/toc.json'))
    if args.only:
        keep = set(args.only)
        paths = [p for p in paths if p.parent.name in keep]
    if not paths:
        print('没有找到 content/*/toc.json', file=sys.stderr)
        return 1

    total = 0
    for path in paths:
        sid = path.parent.name
        changes = fix_one(path, dry_run=args.dry_run, explain=args.explain_exclusions)
        if changes:
            total += len(changes)
            print(f'[{sid}] {report_changes(changes)}')
            for line in format_changes(changes):
                print(line)
    print(f'\n合计 {total} 处（{"dry-run，未写盘" if args.dry_run else "已重写产物"}）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
