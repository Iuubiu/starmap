/**
 * 依赖方向守卫（docs/architecture.md §依赖方向）。
 * 反向 import 必须让 CI 失败，否则分层的说法只是注释。
 *
 * 两个实测出来的坑，规则写错了会「通过」但什么都没检查：
 *
 * 1. **transpiler 必须是 swc**。本仓库用 TypeScript 7（Go 原生端口），
 *    `require('typescript')` 只剩 version，dependency-cruiser 认不出
 *    `>=7`，会跳过全部 `.ts` 并且**仍然报 "no violations found"**。
 *    装 `@swc/core` 后它才有 `.ts/.tsx` 解析能力。
 *
 * 2. **外部包不会被解析成路径**。`import { Mastra } from '@mastra/core/mastra'`
 *    的 `resolved` 就是 `@mastra/core/mastra` 本身，不是
 *    `node_modules/@mastra/...`。所以 `to.path` 必须同时匹配裸模块名，
 *    否则规则永远不触发。
 */
module.exports = {
  forbidden: [
    {
      name: 'engine-is-pure',
      comment:
        'packages/engine 是纯领域内核：不得 import @mastra/*、数据库、文件系统或 HTTP。' +
        '它必须能在没有进程、没有网络的情况下被单测。',
      severity: 'error',
      from: { path: '^packages/engine' },
      to: {
        path: '^(node_modules/)?(@mastra|drizzle-orm|drizzle-kit|pg|@libsql|@nestjs|fastify|express|hono)',
      },
    },
    {
      name: 'engine-no-io',
      comment: 'engine 不得依赖 Node 的文件/进程/网络模块。',
      severity: 'error',
      from: { path: '^packages/engine' },
      to: { path: '^(node:)?(fs|fs/promises|path|os|http|https|net|child_process|worker_threads)$' },
    },
    {
      name: 'engine-no-apps',
      comment: 'engine 是被 apps/api 依赖的，反向依赖会成环。',
      severity: 'error',
      from: { path: '^packages/engine' },
      to: { path: '^(apps|packages/(api-contract|shared/node_modules))' },
    },
    {
      name: 'shared-is-leaf',
      comment: 'packages/shared 只能依赖 zod，不能依赖 engine、契约包或 apps。',
      severity: 'error',
      from: { path: '^packages/shared' },
      to: { path: '^(apps|packages/(engine|api-contract))' },
    },
    {
      name: 'contract-does-not-know-apps',
      comment:
        'packages/api-contract 只描述对外契约，不能 import 后端实现或前端源码 ——' +
        '否则「契约驱动前端」会退化成「前端类型跟着后端改」。',
      severity: 'error',
      from: { path: '^packages/api-contract' },
      to: { path: '^(apps|packages/engine)' },
    },
    {
      name: 'web-no-api-import',
      comment: 'apps/web 不得 import 后端源码；只允许走 packages/api-contract。',
      severity: 'error',
      from: { path: '^apps/web' },
      to: { path: '^apps/api' },
    },
    {
      name: 'api-no-web-import',
      comment: 'apps/api 不得 import 前端源码。',
      severity: 'error',
      from: { path: '^apps/api' },
      to: { path: '^apps/web' },
    },
    {
      name: 'no-circular',
      comment: '循环依赖会让模块边界失效。',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist|coverage|\\.scratch)' },
    tsConfig: { fileName: 'tsconfig.base.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node'],
    },
  },
};
