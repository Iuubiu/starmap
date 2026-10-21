"""`translate.py` 的兜底形态与词典覆盖测试（t42）。

守的是**产物里不能再出现「未收录术语（…）」**，以及三条容易被「顺手改一下」
破坏的标题解析规则。每条断言都对应一个真实节点，不是假想的边界。

## 为什么需要这条测试

`translate_title()` 的兜底是 `未收录术语（<原文>）`。它含汉字，所以 D10 的
「名字必须是中文」拦不住它 —— 生产库里攒了 213 个这样的知识点，学生看到的
章节名就是「未收录术语（The ADC）」。这类错误不会报错，只会表现为「名字怪怪的」。

分三类处置（票面 Comments 有完整统计表）：

1. **176 条只是产物过期**：词典早就认识这些词，重跑就译出来了。
2. **12 条是真译不出**：`The ADC` / `ISOCS` / `GESPECOR` / `ADCs` / `ROOT` /
   `MATLAB` / `MDA: …` / `R´esum´e` / `9．3．1 1＋1≠2` / `B.4 Wilkinson ADC` /
   `A.4 The Laplace transform`。纯缩写与软件名补进 `names.zh.json`
   （`load_overrides()` 读它），其余靠下面三条规则修。
3. **25 条是索引页假节点**（spieler-2005 的 `A`–`Z`）：不是译名问题，
   靠重跑书签路径让 `toc_books._OUTLINE_DROP_SUBTREE` 的 `'index'` 规则剔除。

## 三条规则各自防什么

- **字母段编号**：`B.4 Wilkinson ADC` / `10.1.A ROOT` 是 ahmed-2e 附录小节的
  写法。`_LEAD_NUMBER` 原来只认 `1.2.3` 与 `IV.`，这两种剥不掉，编号被当成
  正文送进逐词匹配，整条标题因此译不出来。
- **前导冠词**：`The ADC` 里 `The` 不在 `DROP_TOKENS`，不剥就永远凑不出汉字。
- **冒号左侧必须有字母**：`6:2 Preservation of timing information` 的冒号是
  「章:节」分隔符不是主副标题分隔符，按冒号切开只会得到
  「未收录术语（6）：定时信息的保持」—— 编号当标题，比不译更糟。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from translate import (  # noqa: E402
    load_overrides,
    make_translator,
    translate_title,
)

ROOT = Path(__file__).resolve().parents[2]
CONTENT = ROOT / 'content'

#: 兜底形态的标记。出现在任何 `name` 里都算失败 —— 学生看到的就是这一列。
FORBIDDEN = ('未收录术语', '未譯', 'TODO', '（原文）')

#: 全库允许的纯 ASCII 名（不含任何汉字）。逐条都是正确的化学式/器件缩写。
#: 写成 `==` 而不是 `<=`：新增一条就该红，让加书的人回来看一眼是不是漏译。
#:
#: 从 17 条降到 15 条是 t45 的结果，不是放宽：原来的 `1131` 与 `g:1343`
#: 是王经瑾那本书的 OCR 残片（`11.3.1` 丢点号、`§13.4.3` 的 `§` 认成 `g:`），
#: 已按缺陷 C 合并进真标题 `道宽选择` / `多路脉冲幅度分析`，节点本身被删掉了。
PURE_ASCII_IDS = {
    'kp-kanghuaguang-5e-p43-SPICE',
    'kp-kanghuaguang-5e-p205-MOSFET',
    'kp-kanghuaguang-5e-p211-MOSFET',
    'kp-kanghuaguang-5e-p467-SPICE7',
    'kp-kanghuaguang-5e-11-2',
    'kp-jichangsong-1990-6-2-1',
    'kp-jichangsong-1990-6-2-3',
    'kp-jichangsong-1990-6-2-4',
    'kp-jichangsong-1990-6-2-5',
    'kp-jichangsong-1990-6-2-6',
    'kp-jichangsong-1990-6-2-7',
    'kp-jichangsong-1990-7-2-3',
    'kp-jichangsong-1990-7-2-5',
    'kp-jichangsong-1990-7-2-6',
    'kp-jichangsong-1990-7-2-7',
}

_HAN = re.compile(r'[\u4e00-\u9fff]')


def _tocs() -> list[Path]:
    return sorted(CONTENT.glob('*/toc.json'))


# ---- 规则：三条标题解析分支 ------------------------------------------------


@pytest.mark.parametrize(
    'title, expected',
    [
        # 字母段编号在尾（ahmed-2e 的 `10.1.A` / `10.1.C`）
        ('2.1.A Inverse square law', '平方反比定律'),
        ('1.3.C Composite radionuclides', '复合放射性核素'),
        # 字母段编号在头（ahmed-2e 的 `B.4`）
        ('B.4 Wilkinson ADC', '未收录术语（Wilkinson ADC）'),
        # 冠词：`The` 要剥掉，剩下的 `ADC` 仍无中文 → 兜底，但不再是 `The ADC`
        ('The ADC', '未收录术语（ADC）'),
        # 冠词在编号之后：`A.4 The Laplace transform`。t45 给 GLOSSARY 补了
        # `laplace` 之后，这条不再是兜底串 —— 判据没放宽，是词典补上了。
        ('A.4 The Laplace transform', '拉普拉斯变换'),
        # 冒号左侧无字母 → 不按主副标题切
        ('6:2 Preservation of timing information', '定时信息的保持'),
        # 冒号左侧有字母 → 仍按主副标题切；但左半边 `MDA` 译不出时先试整串
        # 逐词（`MDA` 保留原文 + 右半边译出），不能把兜底串拼进结果
        ('MDA: efficiency, background and counting', 'MDA效率本底与计数'),
    ],
)
def test_title_rules_that_t42_added(title: str, expected: str) -> None:
    """三条新分支各守一个真实节点（见模块 docstring 的归因）。"""
    assert translate_title(title) == expected


def test_chinese_titles_pass_through_unchanged() -> None:
    """中文原题原样返回：再切词只会破坏。

    注意判据是「含汉字」，不是「含中文标点」：郭江的 `9．3．1 1＋1≠2` 里只有
    全角数字与 `≠`、一个汉字都没有，所以它会走到兜底 —— 这条靠
    `names.zh.json` 覆盖（见 `test_overrides_cover_every_hard_case`），不是靠
    这条规则。这里用一个真的含汉字的标题来守「原样返回」。
    """
    assert translate_title('9．3．1 超重元素') == '9．3．1 超重元素'
    assert translate_title('计算机控制电子学：CAMAC') == '计算机控制电子学：CAMAC'


# ---- 词典：names.zh.json 必须能修掉那 12 条真失败 --------------------------


def test_overrides_file_is_loadable() -> None:
    """`names.zh.json` 存在且能被 `load_overrides()` 读成 11 条。"""
    overrides = load_overrides()
    assert len(overrides) == 11, f'期望 11 条，实际 {len(overrides)}：{sorted(overrides)}'


@pytest.mark.parametrize(
    'title, expected',
    [
        ('B.4 Wilkinson ADC', 'Wilkinson 型 ADC'),
        ('10.1.A ROOT', 'ROOT 数据分析框架'),
        ('10.1.C MATLAB', 'MATLAB 数值计算软件'),
        ('The ADC', 'ADC 模数转换器'),
        ('ISOCS', 'ISOCS 无源效率刻度软件'),
        ('GESPECOR', 'GESPECOR 符合修正软件'),
        ('MDA: efficiency, background and counting', 'MDA（最小可探测活度）：效率、本底与计数'),
        ('R´esum´e', '摘要'),
        ('9．3．1 1＋1≠2', '1＋1≠2（超重元素稳定岛）'),
        ('ADCs', 'ADC 模数转换器'),
        ('A.4 The Laplace transform', '拉普拉斯变换'),
    ],
)
def test_overrides_cover_every_hard_case(title: str, expected: str) -> None:
    """11 条真失败全部被词典接住 —— 少一条就会在产物里重新长出兜底串。"""
    translate = make_translator(load_overrides())
    assert translate(title) == expected


def test_overrides_win_over_rules() -> None:
    """词典优先于规则：`translate()` 先查表，查不到才走 `translate_title`。"""
    translate = make_translator({'The ADC': '自定义译名'})
    assert translate('The ADC') == '自定义译名'
    assert translate('  The   ADC  ') == '自定义译名', '查表前要先 _normalize（压空白）'


# ---- 产物：27 本 toc.json 里不许再有兜底串 --------------------------------


@pytest.mark.skipif(not _tocs(), reason='没有已生成的内容目录')
def test_no_fallback_name_survives_in_any_book() -> None:
    """任何 `name` 里都不许出现 `FORBIDDEN` 的标记。

    这是 t42 的主判据。失败时点名 `sourceId + microKpId + name`，因为
    「有 3 条兜底」这种消息在 27 本书里根本没法定位。
    """
    bad: list[str] = []
    for path in _tocs():
        toc = json.loads(path.read_text(encoding='utf-8'))
        for node in toc.get('nodes', []):
            name = node.get('name') or ''
            for marker in FORBIDDEN:
                if marker in name:
                    bad.append(f'{path.parent.name} | {node["microKpId"]} | {name}')
                    break
    assert not bad, '这些节点还是兜底名，说明产物没重出或词典没覆盖：\n' + '\n'.join(bad)


@pytest.mark.skipif(not _tocs(), reason='没有已生成的内容目录')
def test_pure_ascii_names_are_the_known_fifteen() -> None:
    """纯 ASCII 名（一个汉字都没有）只能是这 15 条，一条都不能多。

    它们是正确的化学式/器件缩写（`NaI(TI)` / `ZnS(Ag)` / `BiGeO,(BGO)` …）
    与康华光那 5 条 `SPICE`/`MOSFET` 系列。断言用 `==` 不用 `<=`：
    新增一条就该红，让加书的人回来看一眼是不是漏译。
    """
    # 断言集合与 `PURE_ASCII_IDS` 完全相等（见上：`==` 不是 `<=`）
    pure: dict[str, str] = {}
    for path in _tocs():
        toc = json.loads(path.read_text(encoding='utf-8'))
        for node in toc.get('nodes', []):
            name = node.get('name') or ''
            if name and not _HAN.search(name):
                pure[node['microKpId']] = name
    extra = sorted(set(pure) - PURE_ASCII_IDS)
    missing = sorted(PURE_ASCII_IDS - set(pure))
    assert not extra, f'新增了纯 ASCII 名（是漏译还是真的专有名词？）：{[ (i, pure[i]) for i in extra ]}'
    assert not missing, f'白名单里的节点不见了（产物被改坏？）：{missing}'


@pytest.mark.skipif(not _tocs(), reason='没有已生成的内容目录')
def test_spieler_index_letters_are_gone() -> None:
    """spieler-2005 的 25 个单字母索引假节点必须消失。

    它们是书末 `Index` 的 `A`–`Z` 书签被误当章节收进来的（页码 478–489，
    而第 9 章正文只到 434 页）。处置是重跑书签路径让
    `toc_books._OUTLINE_DROP_SUBTREE` 的 `'index'` 规则剔除，不是补词典 ——
    把 `A` 译成「A」毫无意义。
    """
    path = CONTENT / 'spieler-2005' / 'toc.json'
    if not path.exists():
        pytest.skip('没有 spieler-2005 的产物')
    toc = json.loads(path.read_text(encoding='utf-8'))
    letters = [
        node['microKpId']
        for node in toc.get('nodes', [])
        if re.fullmatch(r'[A-Z]', (node.get('nameOriginal') or '').strip())
    ]
    assert not letters, f'spieler-2005 还有单字母索引节点：{letters}'
