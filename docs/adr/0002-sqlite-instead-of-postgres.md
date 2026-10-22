# 本地单用户用 SQLite/libSQL，不用 PostgreSQL

**Status: Superseded by [ADR-0005](0005-postgres-instead-of-sqlite.md)**

> 本决定已被推翻。保留原文仅作历史记录，不要按本文实现。现行方案见 ADR-0005。

项目默认技术方向是 PostgreSQL，但本应用是单机、单用户、无登录、无并发写入者的学习工具，运维成本会全部落在学习者自己身上。这里改用 SQLite/libSQL 单文件库，Mastra 的存储层用同库不同域，零运维、可整库复制备份。

## Considerations

PostgreSQL 会带来进程管理、端口、初始数据目录、备份脚本，以及「换个电脑怎么办」的问题；而本项目在一台笔记本上跑，写入只发生在一个人敲键盘时，读多写少的负载远低于任何需要独立数据库的门槛。向量检索方面两个端点都没有 embeddings，检索以 BM25 起步，也不构成选 PostgreSQL 的理由。

## Consequences

- 未来的向量检索要么用自托管 ONNX 模型在进程内算，要么接受扩展受限；换 Postgres 需要重做迁移与 Mastra 存储配置。
- 好处是整库就是一个文件，备份、迁移、开新分支做实验都是拷文件。
- 明确不做：这一条不适用于将来「接学校数据库」的场景，那属于另一个写入者与权限模型。

## Why it was reverted

「零运维」这个收益被高估了：本地开发环境下 Postgres 与 SQLite 的启动成本差别是一次 `docker compose up -d`，而代价是技术栈偏离项目默认方向、且与未来「接学校数据库」的目标异构。详见 ADR-0005。
