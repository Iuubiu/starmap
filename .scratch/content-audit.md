# 内容管线全量复核（captain，12 本书 × toc.json + chunks.jsonl）

复核对象：`content/*/toc.json` 与 `content/*/chunks.jsonl`（已落盘产物，不是流水线中间态）。
复核方式：只读脚本统计，脚本口径见本节末。

## 一、结论：目录解析的三类系统性缺陷

### A. 章级节点整体丢失（最严重）

| 书 | depth==1 节点 | 小节节点数 | 小节中挂在缺失章下的 |
|---|---|---|---|
| analog-electronics-kanghuaguang-5e | **0** | 77 | **77 / 77** |
| analog-electronics-tongshibai-5e | 10（缺第 1 章） | 229 | 21 / 229 |

`analog-electronics-kanghuaguang-5e` 的 `kp-1` … `kp-11` **一个都不存在**，
77 个 `kp-N-M` 全部 depth=2、parentId=null，于是 `import-content.ts:195` 的
`n.depth === 1 ? n.microKpId : findChapterId(...) ?? chapters[0]?.microKpId`
必然走 `chapters[0]` 兜底 —— 而 `chapters` 是 `nodes.filter(n => n.depth === 1)`，
在该书上是**空数组**，于是 `chapterOf` 为 undefined，`:197` 直接 `continue`。
**这本书的知识点会一个都导不进去。**

tongshibai 缺 `kp-1` / `kp-1-1` / `kp-1-2`：`kp-1-3`…`kp-1-7` 成孤儿，
对应印刷页 1–27 的 334 个 chunk 无归属（占全书 4%）。

### B. 编号与标题错位（重复 microKpId）

| 书 | 重复 id | 两行分别是什么 |
|---|---|---|
| circuit-analysis-lihansun-5e-vol1 | `kp-1` ×2、`kp-2` ×2 | `kp-1` 一次是章名「总论和电阻电路的分析」，一次是节名「集总参数电路中电压、电流的约束关系」；`kp-2` 一次是「网孔分析和节点分析，」，一次是「云」（OCR 噪声） |
| digital-electronics-yanshi-6e | `kp-55` ×2 | 「5定时器及其应用」与「5定时器的电路结构和功能」—— 原文是「555 定时器」，`_ENTRY` 把 `555` 拆成 `55` + 标题 `5定时器…` |

后果：`import-content.ts:203` 是 `ON CONFLICT (id) DO UPDATE`，**后一条静默覆盖前一条**，
不报错、不告警，一条知识点凭空消失。

### C. 章节附件被当成叶知识点

`isLeaf=true` 且名字命中「目录 / 附录 / 参考文献 / 索引」的节点：

- `analog-electronics-tongshibai-5e`：`kp-p28-目录`（Ⅱ目录）、`kp-p136-V目录`、`kp-p229-目录`（И目录）、`kp-p480-X目录`
- `digital-electronics-yanshi-6e`：`kp-p428-V目录`
- `nuclear-electronics-wangzhiying-1989`：`kp-p30-附录`（［附录］）

`toc.py` 的 `_APPENDIX_EXACT` 只认整串「附录」，`［附录］` 带全角方括号所以没命中；
「目录」根本不在集合里。这些节点会出现在地图上、可被「掌握」、可被 `pickTargets` 出题。

## 二、页偏移缺陷（printed_page 为负）

| 书 | 负页码 chunk 数 | 最小 printed_page | pageOffset |
|---|---|---|---|
| nuclear-physics-experiment-methods-1997 | 233 | **-13** | 0（`pageOffsetConfident` 应为 false） |
| nuclear-radiation-measurement-tangbin | 43 | -1 | auto |

`books.ocr.json` 里 `nuclear-physics-experiment-methods-1997` 的 `firstPage` 是 8、
`tocRange` 是 `[0, 8]`，偏移探测返回 0。PDF 第 278 页算出 printed_page = -13，
说明真实偏移是 +291 不是 0 —— 探测失败但被当成成功。

## 三、chunk 归属（orphan 率）

| 书 | orphan / total | 说明 |
|---|---|---|
| analog-electronics-tongshibai-5e | 334 / 8086（4%） | 章 1 丢失 |
| nuclear-physics-experiment-methods-1997 | 233 / 7871（3%） | 负页码那批 |
| nuclear-radiation-measurement-tangbin | 189 / 6969（2%） | 同上 |
| nuclear-electronics-wangjingjin-1983 | 89 / 2821（3%） | 目录从第九章起（上册），1–6 页无归属 |
| analog-electronics-kanghuaguang-5e | 6 / 7946 | 可忽略 |

## 四、修复优先级建议

1. **先补 chapter 级节点**（缺陷 A）：`build_tree` 里当遇到 `N.M` 而 `N` 未被解析时，
   若目录原文里该章标题存在（形如「N　标题⋯⋯页码」但 `_ENTRY` 因标题首字符是数字
   或空格没吃下），用「按编号前缀补祖先」策略合成章节点，而不是留孤儿。
2. **`microKpId` 去重**（缺陷 B）：`nodes_from_flat` 出口加断言 —— 重复 id 直接抛错，
   不允许静默覆盖。`digital-electronics-yanshi-6e` 的 `555` 是 `_ENTRY` 的
   `(?P<num>\d+(?:\.\d+)*)` 贪婪吃掉三位数字所致，要在标题侧要求 `num` 与 `title`
   之间有分隔（空格或非数字）。
3. **附件词表补全**（缺陷 C）：`_APPENDIX_EXACT` 加「目录」；`_clean_title` 或
   `is_appendix_title` 先剥全角方括号 `［］【】` 再匹配。
4. **页偏移置信度**（缺陷二）：`detect_page_offset` 返回 0 时若书有明确 `firstPage`，
   必须置 `pageOffsetConfident=false` 并在 chunk 侧把 `printed_page` 置 null 而不是负值。

## 五、脚本口径

```python
# 章级缺失：num 形如 "3.1" 的节点，其 "3" 是否有同名 num 的节点
secs  = [n for n in ns if n.get('num') and '.' in str(n['num'])]
chaps = {str(n['num']) for n in ns if n.get('num') and '.' not in str(n['num'])}
missing = {str(n['num']).split('.')[0] for n in secs} - chaps
```
