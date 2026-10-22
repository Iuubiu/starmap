-- 0051: 把「书首前置页」伪知识点降级为容器（t24 第二件）
--
-- ## 缺陷
--
-- 目录解析把「无编号标题」挂到 stack[0]，于是整本书的卷名/目录/前言这一页会被
-- 建成一个 **depth=0 的叶知识点**。学习者在地图上看到一个叫「上册」的格子，
-- 点进去是第一章第 2 页的正文；推荐接口把它当成「下一课」推荐出来。
--
-- 实测 5 条（captain 独立复验，全部零引用：无子节点、无入边、无关卡、无作答）：
--
--   kp-lihansun-5e-vol1-p2-上册        | 上册       | depth 0 | 10 chunk
--   kp-yanshi-6e-p1-绪论               | 绪论       | depth 0 | 35 chunk
--   kp-wangzhiying-1989-p1-目電录      | 目電录     | depth 0 | 19 chunk   「目录」的 OCR 错字
--   kp-wangzhiying-1989-p1-绪论        | 绪论       | depth 0 | 12 chunk
--   kp-jichangsong-1990-p1-概念与术语  | 概念与术语 | depth 0 | 62 chunk
--
-- ## 为什么是降级不是删除
--
-- 这 5 条**各挂着 10–62 个 chunk**（书首的序、目录、术语表正文），删了会让
-- 138 个 chunk 变成 orphan。降级成 `is_leaf = false` 后：
--
--   * 地图（`graph.controller.ts` 只取 is_leaf）、掌握度（非叶走聚合）、出题
--     （`generation` 只挑 is_leaf）、推荐（`recommend.service.ts` 只取 is_leaf）
--     **四处消费方都自动不再把它当可掌握知识点**；
--   * chunk 仍挂在这个节点下，`content.controller.ts` 的 `WITH RECURSIVE subtree`
--     仍能查到 —— 内容不丢；
--   * 与 `jichangsong` 的「序言」（同一页、同类东西，本来就是 `is_leaf = false`）
--     形态一致。这是**同类东西的正确形态**，本迁移把它推广到剩下 5 条。
--
-- ## 为什么不是改名
--
-- 「上册」就算改成「电路分析基础·上册 前言」，它仍然是一个可以被「掌握」的
-- 知识点、仍然会出现在掌握度分母里、仍然会被推荐。「概念与术语」在 4 本书里
-- 含义完全不同（jichangsong 的 p1/p189/p384/p443 四份术语表），改名解决不了
-- 「它不该是一个学习目标」这件事。
--
-- ## 幂等
--
-- `WHERE` 带完整条件（id 列表 + `is_leaf = true`），重复执行影响 0 行。
-- 不回滚学习者数据 —— 这 5 条全部零引用，改的只是一个布尔。
UPDATE app.knowledge_points
   SET is_leaf = false
 WHERE id IN (
         'kp-lihansun-5e-vol1-p2-上册',
         'kp-yanshi-6e-p1-绪论',
         'kp-wangzhiying-1989-p1-目電录',
         'kp-wangzhiying-1989-p1-绪论',
         'kp-jichangsong-1990-p1-概念与术语'
       )
   AND is_leaf = true;
