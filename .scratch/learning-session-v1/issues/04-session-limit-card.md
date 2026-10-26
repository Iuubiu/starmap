# 04 · 右栏「本档上限」卡

Status: ready-for-agent
Spec: `../spec.md` §2 T4

## 输入

- `apps/web/src/components/StudySidebar.tsx`
- `apps/web/src/api/queries/tier.ts` 的 `useTierSessionPlan()`（只读，已存在）

## 做什么

右栏新增一行卡：「一次最多推进 N 个新知识点」（N = `session-plan.limit`）；
`deferred > 0` 时追加「还有 N 个，下次会话再开」。

## 输出

卡片 + 测试。

## 判据

1. `deferred=0` 与 `>0` 两态各有测试。
2. limit 数字来自接口（测试 mock 断言透传；前端不得出现字面量 2/3/4——tier.ts 头注释的纪律）。
3. 接口 pending/失败时的占位与右栏其他卡一致（「—」类降级，不红错）。
4. `pnpm --filter @starmap/web test` 相关文件全绿。
