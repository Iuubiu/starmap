"""课程层映射的测试（票 18 AC2）。

三条要求（captain 原文）：
1. 27 个 sourceId 全有映射；
2. 每个 layerId 都在 `course-map.json` 声明的层里；
3. ordinal 严格递增无重复。

此外守四条容易悄悄坏掉的不变式：
- `LAYERS` 常量与迁移 `0061_course_layers.sql` 的种子逐字段一致（迁移是单一真源，
  改一边不改另一边会让 API 读到的层与库里的行对不上）；
- 仓库里实际存在的书（`content/*/toc.json`）与常量表**双向相等** —— 新书没加
  映射会静默留 `course_layer_id = NULL`，地图上落到「未归层」没人发现；
- 每本书的理由非空且不是占位文字；
- 票 18 AC2 的核心断言：数字电子技术（ordinal 30）严格排在核电子学（50）之前，
  中间隔着原子核物理（40）；且 `advanced-digital` 是终点。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import course_map as cm  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
MIGRATION = REPO / 'apps' / 'api' / 'migrations' / '0061_course_layers.sql'


@pytest.fixture(scope='module')
def payload() -> dict:
    return cm.build()


def test_all_27_books_are_mapped(payload):
    """27 本书一本不少，且每本都有非空的层。"""
    books = payload['books']
    assert len(books) == 27, f'映射了 {len(books)} 本，应为 27'
    assert {b['sourceId'] for b in books} == set(cm.BOOK_TO_LAYER)
    for book in books:
        assert book['layerId'], f"{book['sourceId']} 没有层"


def test_every_layer_id_is_declared(payload):
    """每本书的层都在 layers 声明里，且 layers 与 LAYERS 常量一致。"""
    declared = {layer['id'] for layer in payload['layers']}
    assert declared == set(cm.LAYER_BY_ID)
    for book in payload['books']:
        assert book['layerId'] in declared, f"{book['sourceId']} → {book['layerId']} 不在 layers 里"


def test_ordinals_are_strictly_increasing_and_unique(payload):
    """ordinal 严格递增无重复，且学期区间不反。"""
    ordinals = [layer['ordinal'] for layer in payload['layers']]
    assert ordinals == sorted(ordinals), f'ordinal 未升序：{ordinals}'
    assert len(set(ordinals)) == len(ordinals), f'ordinal 有重复：{ordinals}'
    for layer in payload['layers']:
        assert layer['semesterFrom'] <= layer['semesterTo'], f"{layer['id']} 学期区间反了"


def test_validate_rejects_a_missing_book(payload):
    """`validate()` 必须能发现「少一本」—— 否则它只是装饰。"""
    broken = cm.build([b['sourceId'] for b in payload['books'][:-1]])
    problems = cm.validate(broken)
    assert any('缺的书' in p for p in problems), problems


def test_validate_rejects_an_unknown_layer():
    payload = cm.build()
    payload['books'][0]['layerId'] = 'no-such-layer'
    problems = cm.validate(payload)
    assert any('不在 layers 声明里' in p for p in problems), problems


def test_validate_rejects_an_empty_reason():
    payload = cm.build()
    payload['books'][3]['reason'] = '   '
    problems = cm.validate(payload)
    assert any('没有写理由' in p for p in problems), problems


def test_validate_rejects_duplicate_ordinals():
    payload = cm.build()
    payload['layers'][1]['ordinal'] = payload['layers'][0]['ordinal']
    problems = cm.validate(payload)
    assert any('ordinal' in p for p in problems), problems


def test_every_book_on_disk_is_mapped(payload):
    """仓库里实际有的书必须与常量表双向相等。

    单向检查（「常量表里的书都有映射」）不够：新加一本书却忘了加映射时，
    产物里根本不会出现它，单向检查仍然绿 —— 而库里那本书的模块
    `course_layer_id` 全是 NULL。
    """
    on_disk = set(cm.discover_books())
    assert on_disk, '没有扫到任何 content/*/toc.json，测试环境不对'
    mapped = {b['sourceId'] for b in payload['books']}
    assert on_disk - mapped == set(), f'仓库里有但没映射的书：{sorted(on_disk - mapped)}'
    assert mapped - on_disk == set(), f'映射了但仓库里没有的书：{sorted(mapped - on_disk)}'


def test_reasons_are_substantive(payload):
    """每条理由都要有实质内容（不能是「因为是 A 层」这种同义反复）。"""
    for book in payload['books']:
        reason = book['reason']
        assert len(reason) >= 20, f"{book['sourceId']} 的理由太短：{reason!r}"
        assert 'TODO' not in reason and '待补' not in reason, f"{book['sourceId']} 的理由是占位"


def test_layers_match_the_migration_seed(payload):
    """`LAYERS` 必须与迁移 0061 的种子逐字段一致。

    迁移是课程层的单一真源（它带 `note` 证据与回滚），Python 这边只是同一批
    事实的最小副本。改了一边不改另一边 → 这条测试红。
    """
    assert MIGRATION.exists(), f'找不到迁移 {MIGRATION}'
    sql = MIGRATION.read_text(encoding='utf-8')
    seed = sql.split('INSERT INTO app.course_layers', 1)
    assert len(seed) == 2, '迁移里找不到 course_layers 的 INSERT 种子'
    body = seed[1]
    # 每行种子形如：'circuit-analysis', '电路分析', 2, 3, 10, 'foundation',
    rows = re.findall(
        r"'\s*([a-z][a-z0-9-]+)\s*'\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'([a-z]+)'",
        body,
    )
    assert len(rows) == len(cm.LAYERS), f'迁移里有 {len(rows)} 条种子，常量表有 {len(cm.LAYERS)} 层'
    from_migration = {
        r[0]: (r[1], int(r[2]), int(r[3]), int(r[4]), r[5]) for r in rows
    }
    for layer in cm.LAYERS:
        assert layer.id in from_migration, f'迁移里没有层 {layer.id}'
        assert from_migration[layer.id] == (
            layer.name, layer.semester_from, layer.semester_to, layer.ordinal, layer.kind
        ), f'{layer.id} 与迁移种子不一致：{from_migration[layer.id]}'


def test_digital_layer_precedes_nuclear_electronics(payload):
    """票 18 AC2 的核心断言：数字（30）在核电子学（50）之前，中间隔着原子核物理（40）。"""
    ordinal = {layer['id']: layer['ordinal'] for layer in payload['layers']}
    assert ordinal['digital-electronics'] < ordinal['nuclear-electronics']
    assert ordinal['analog-electronics'] < ordinal['nuclear-electronics']
    assert ordinal['circuit-analysis'] < ordinal['analog-electronics']
    assert (
        ordinal['digital-electronics']
        < ordinal['atomic-nuclear-physics']
        < ordinal['nuclear-electronics']
    ), '原子核物理（40）必须夹在数字（30）与核电子学（50）之间'


def test_advanced_digital_is_the_terminal_layer(payload):
    """advanced-digital 是最后一层（研究生），没有比它更晚的层。"""
    ordinals = {layer['id']: layer['ordinal'] for layer in payload['layers']}
    assert max(ordinals.values()) == ordinals['advanced-digital']
    assert ordinals['advanced-digital'] > ordinals['radiation-measurement-methods']


def test_kinds_are_from_the_allowed_vocabulary(payload):
    """kind 只能是迁移里 CHECK 允许的四个值。"""
    allowed = {'foundation', 'core', 'advanced', 'method'}
    for layer in payload['layers']:
        assert layer['kind'] in allowed, f"{layer['id']} 的 kind={layer['kind']} 不合法"
    kinds = {layer['kind'] for layer in payload['layers']}
    assert kinds == allowed, f'四个 kind 没有都用上：{kinds}'


def test_no_book_maps_to_advanced_digital():
    """`advanced-digital` 没有整本对口教材 —— 这正是 0060 声明的内容缺口。

    这条不是「必须为空」的教条，而是**记录当前事实**：如果将来补了一本数字脉冲
    处理的教材并映射进来，这条测试会红，提醒改 0060 的缺口声明。
    """
    mapped = set(cm.BOOK_TO_LAYER.values())
    assert 'advanced-digital' not in mapped, (
        '有书映射到 advanced-digital 了：请同步更新 0060_content_gaps 的 gap-digital-pulse'
    )


def test_generated_file_matches_the_module():
    """`content/course-map.json` 与 `course_map.build()` 的内容一致（除时间戳）。

    产物是**提交进仓库**的（`import-content.ts` 读它），所以它必须与代码同步。
    只比时间戳之外的部分：`generatedAt` 每次生成都变。
    """
    path = REPO / 'content' / 'course-map.json'
    if not path.exists():
        pytest.skip('content/course-map.json 还没生成')
    on_disk = json.loads(path.read_text(encoding='utf-8'))
    fresh = cm.build()
    assert on_disk['layers'] == fresh['layers']
    assert on_disk['books'] == fresh['books']
    assert on_disk['version'] == fresh['version']
