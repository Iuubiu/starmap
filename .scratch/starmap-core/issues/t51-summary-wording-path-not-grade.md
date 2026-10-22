# t51：关卡小结把「路线」说成了「成绩」

**状态**：已修（措辞 + 颜色 + 防回归测试 + 截图取证）

## 缺陷

`/level/lv-ai-kp-tangbin-1-2`（AI 题目关卡，5 道题）只答对 1 题，小结仍然写着：

- 徽章：「一次通过」（绿色 `success`）
- 正文：「一次通过，5 道作答全部计入掌握度。」

而**同一张卡**的「本关证据」正写着「作答 5 / 答对 1」。两句话互相打脸。

## 根因

`apps/web/src/pages/LevelPage.tsx` 的小结面板用 `flow.tookRemediation` 决定措辞：

```tsx
color={flow.tookRemediation ? 'informative' : 'success'}
{flow.tookRemediation ? '走了深究路径' : '一次通过'}
```

但 `tookRemediation` 的语义**只有一件事**：有没有进入过「深究」段。它由 `apps/web/src/level/flow.ts` 的 `advance()` 在「简单问题未达标」时置真：

```ts
const tookRemediation = entering?.kind === 'deepen' ? true : state.tookRemediation;
```

它与答对率毫无关系。而 `lv-ai-*` 这类题目关卡只有「判定 → 小结」两段 —— 根本没有简单问题 / 深究 / 进一步讲解段，于是这个标志**恒为 false**，徽章与正文恒定输出「一次通过」，无论答对几题。

颜色同理：绿色（`success`）是在替学习者下「你考得不错」的结论，而这条标志根本不知道答对率。

## 修法

**不动判据，只动措辞。** `tookRemediation` 的语义、`flow.ts` 的一行、状态机与引擎全部保持不变（`tools/eval` 与 `flow.test.ts` 的行为断言都依赖它）。

### 1. 文案陈述路径

`apps/web/src/pages/LevelPage.tsx` 新增一个纯函数：

```ts
export function summaryPathBadge(tookRemediation: boolean): {
  label: string;
  color: 'subtle' | 'informative';
} {
  return tookRemediation
    ? { label: '走了深究路径', color: 'informative' }
    : { label: '直达路径', color: 'subtle' };
}
```

- `直达路径` = 简单问题一次达标，跳过了深究与进一步讲解。
- `走了深究路径` = 简单问题没过，进了深究与进一步讲解。
- 两句都只说路线，都不含「通过」「全部答对」这类评价词。

正文同步：

- 直达：「这一趟没触发深究，走的是直达路径。N 道作答都计入掌握度（答错也算证据）。这一关判没判过，看下面的出口门控。」
- 深究：「这一趟走了深究路径。深究与进一步讲解里的作答不计入掌握度，所以真正进 BKT 证据序列的是 N 道。」

### 2. 颜色不用 `success`

返回类型**刻意写死**成 `'subtle' | 'informative'` —— 于是 `success` 在这里连编译都过不去。绿色会把「没进深究」读成「表现好」，而这是两种路线，不是两个等级。

### 3. 测试

`apps/web/src/pages/LevelPage.test.tsx`：

- 原「走完全程后显示小结」用例的两条断言跟着改：`直达路径` / `这一趟没触发深究，走的是直达路径`。
- 新增 `题目关卡一道没答对、也没触发深究时，小结不能说「通过」或「全部答对」`：用一份与库里 `lv-ai-*` 同构的题目关卡 spec（两道题、正确项都是 0、只有「判定 → 小结」两段），全选错项走到小结，断言证据卡里明写着「作答 2 / 答对 0」，且不含 `一次通过` / `全部答对` / `通过了` / `恭喜`。
- 新增 `小结徽章只用中性色`：直接跑 `summaryPathBadge`，钉住两种路线的颜色落在 `subtle` / `informative`，且两个措辞都不含 `/通过|全对|答对/`。

`apps/web/src/level/flow.test.ts`：用例名从「一次通过的分支」改为「直达路径的分支」，**行为断言一行未动**（`skippedStepIds` 与 `tookRemediation === false`）。

## 取证

真实关卡 `/level/lv-ai-kp-tangbin-1-2`，5 道题故意只答对第 1 题（正确答案从 `GET /api/v1/levels/:id` 拿，不在页面上猜），Playwright 截图：

`.scratch/qa/shots/t51-summary-1-of-5.png`

页面实测文本：

```
本关小结 直达路径
本关证据  作答 5   答对 1   已记入档案 4   计入掌握度 5
这一趟没触发深究，走的是直达路径。5 道作答都计入掌握度（答错也算证据）。这一关判没判过，看下面的出口门控。
历史最高（不回落，用于解锁）62%   当前熟练度（会随时间回落，用于推荐）17%   状态 刚接触
```

## 验证

- `pnpm --filter @starmap/web test` → **33 files / 468 tests passed**
- `pnpm --filter @starmap/web typecheck` → 通过
- `git diff --stat -- apps/web/src/level/flow.ts` → 空（`flow.ts` 一行未改）

## 改动文件

- `apps/web/src/pages/LevelPage.tsx`
- `apps/web/src/pages/LevelPage.test.tsx`
- `apps/web/src/level/flow.test.ts`

## 遗留观察（不在本票范围）

`tookRemediation` 这个字段名本身就是误导的源头：它叫「took remediation」，读者容易理解成「做了补救 = 表现不好」，实际它同时承载了「跳过深究」这一半信息，而「跳过」在别的语境里是好事。若要彻底消除误读，应把它拆成两个正交事实（`enteredDeepen: boolean` 与 `probePassed: boolean`），但那会牵动 `flow.ts` 的返回类型、`tools/eval` 的阶段断言与票 04 的既有测试 —— 属于重构，不是修文案，留给后续。
