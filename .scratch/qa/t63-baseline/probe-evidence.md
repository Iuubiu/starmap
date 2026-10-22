# contrast-check.mjs 补盲区：改前 / 补断言后 / 修值后 三态留证

任务：captain 2026-10-22 指示「这两个盲区现在就补，不要等 t63 claim」。
文件：`skills/web-design-engineer/references/contrast-check.mjs`（t63 inScope）。

## 状态 0：改之前（假绿）

```
$ node skills/web-design-engineer/references/contrast-check.mjs
  rules: 46, all pass: true          ← 两套主题
TOTAL FAILURES: 0
```
sha256 `d380ffa0d02af37a12728a253f910e83885150f04f382d1a990afa0096663b57`
原文见 `probe-before.txt`。

**它是假绿**：`text-disabled` 只断言了对 `bg-surface`/`bg-hover`/`bg-selected`，
漏了 `bg-canvas`；`option-idle-border` 一条断言都没有。

## 状态 1：只补断言、不动值（立刻变红，证明断言写对了）

```
$ node .../contrast-check.mjs
FAIL 选项未选边 option-idle-border / bg-surface        1.66  (>= 3)  WCAG 1.4.11
FAIL 选项未选边 option-idle-border / bg-canvas         1.76  (>= 3)  WCAG 1.4.11
FAIL 选项未选边 option-idle-border / bg-surface        1.55  (>= 3)  WCAG 1.4.11
FAIL 选项未选边 option-idle-border / bg-canvas         1.41  (>= 3)  WCAG 1.4.11
  rules: 49, all pass: false
TOTAL FAILURES: 4
exit=1
```
原文见 `probe-after-assertions.txt`。

`text-disabled / bg-canvas` 没红（3.23 深 / 3.45 亮，达标）—— 它只是**漏了断言**，
值本身没问题。红的 4 条全是 `option-idle-border`。

## 状态 2：查根因 —— 不是值不对，是**这个文件的值抄旧了**

```
$ node -e '<从 SKILL.md 表格抽 30 个 token 与 tokens.ts 比对>'
DIFF option-idle-border spec #333C49/#C9D0DB impl #6B7787/#7C8695
spec keys: 30 diffs: 1
```

- `apps/web/src/theme/tokens.ts:127` → `'option-idle-border': '#6B7787'`（深）
- `apps/web/src/theme/tokens.ts:183` → `'option-idle-border': '#7C8695'`（亮）
- `apps/web/src/theme/tokens.css:152/209` → `#6b7787` / `#7c8695`（与 ts 一致）

即：**实现侧早就是 `border-control` 那组值（3.68–4.30:1），而规范侧的
`contrast-check.mjs` 与 `SKILL.md §1.5` 还停留在旧稿 `#333C49`/`#C9D0DB`（1.41–1.76:1）**。
以真源（`tokens.ts`，`tokens.test.ts` 保证它与 `tokens.css` 逐字相等）为准，
把规范侧两处值改成实现侧的值。

> 这个方向很关键：如果反过来「让实现去满足规范」，就要把选项未选边改成 1.4:1 ——
> 那是把已经合格的东西改坏。规范的职责是描述对的事，不是坚持自己抄错的那份。

## 状态 3：改完（绿）

```
$ node .../contrast-check.mjs
  rules: 49, all pass: true          ← 两套主题
TOTAL FAILURES: 0
exit=0
```
原文见 `probe-final.txt`。新增/变化的关键行：
```
ok   禁用 text-disabled / bg-canvas                 4.63  (>= 3)
ok   禁用 text-disabled / bg-canvas                 3.72  (>= 3)
ok   选项未选边 option-idle-border / bg-surface        4.05  (>= 3)
ok   选项未选边 option-idle-border / bg-canvas          4.3  (>= 3)
ok   选项未选边 option-idle-border / bg-surface        3.68  (>= 3)
ok   选项未选边 option-idle-border / bg-canvas         3.35  (>= 3)
```
`worst-per-role` 新增一行 `"选项未选边 option-idle-border": 4.05`。

## 反向验证（证明断言真的会因回归而红）

把两处 `option-idle-border` 临时改回旧稿 `#333C49`/`#C9D0DB` 再跑：

```
reverse exit=1
4 条 FAIL
TOTAL FAILURES: 4
```
还原后 `restored exit=0`。即「改坏 → 立刻红；改回 → 立刻绿」双向成立。

## 一致性（改完后两个方向都逐字相等）

```
$ node -e '<SKILL.md 表格 vs tokens.ts>'
spec keys 30 diffs 0

$ node -e '<probe palette vs tokens.ts>'
probe keys 33 diffs 0
```

## 连带改动（同一份数据的三处，必须一起改）

| 文件 | 改动 |
|---|---|
| `skills/web-design-engineer/references/contrast-check.mjs` | 断言 46→49 条；补 `text-disabled/bg-canvas`、`option-idle-border/bg-surface`、`option-idle-border/bg-canvas`；`option-idle-border` 两主题值改为 `#6B7787`/`#7C8695`；`worstByRole` 加一行；文件头补「假绿教训」段 |
| `skills/web-design-engineer/SKILL.md` §1.5 | `--sm-option-idle-border` 两主题值改为 `#6B7787`/`#7C8695`，备注写清旧稿为何废 |
| `skills/web-design-engineer/SKILL.md` §1.6 + §命令 | 「46 条 × 2 = 92 条」→「49 条 × 2 = 98 条」；最差值表加 `选项未选边` 一行 |

## 对 t63 的影响

`apps/web/src/level/` 里 `option-idle-border` **零使用点**（`grep` 无命中）——
`QuestionView.tsx:89` 的待提交条用的是 `colorNeutralStroke2`（→ 实施时换 `--sm-border-control`）。
所以这次改值不改变我那张改造清单里的任何一行目标 token，只是把「为什么要换成
`--sm-border-control` 而不是 `--sm-option-idle-border`」这条论证从「两主题都不达标」
更正为「两者现在是同一组值，选语义更准的那个」。
