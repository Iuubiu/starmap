import { defineConfig } from 'orval';

/**
 * Orval 配置：openapi.yaml → TanStack Query hooks。
 *
 * `mode: 'tags-split'` 让每个 OpenAPI tag 生成一个文件，避免全部堆进一个
 * 越来越大的文件；`httpClient: 'fetch'` 不引 axios，因为只需要一个基础客户端。
 *
 * 生成物提交进仓库（`src/api/generated`），CI 用 `contract:check` 比对
 * 生成结果与提交结果是否一致 —— 手改生成物会在 CI 挂掉。
 */
export default defineConfig({
  starmap: {
    input: './openapi.yaml',
    output: {
      target: './../../apps/web/src/api/generated/endpoints.ts',
      schemas: './../../apps/web/src/api/generated/model',
      mode: 'tags-split',
      client: 'react-query',
      httpClient: 'fetch',
      mock: false,
      clean: true,
      prettier: true,
      override: {
        mutator: {
          path: './../../apps/web/src/api/fetcher.ts',
          name: 'customFetch',
        },
        query: {
          useQuery: true,
          signal: true,
          // Orval 从 cwd 向上找 package.json 判断 react-query 版本，找到的是
          // 契约包（没有 react-query），于是默认按 v4 生成。v5 的 query 对象
          // 语义变了（部分参数可省略），显式声明才不会生成过时的类型。
          version: 5,
        },
      },
    },
  },
});
