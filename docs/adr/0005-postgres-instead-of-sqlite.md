# 用 PostgreSQL，不用 SQLite/libSQL

本地单用户、无并发写入者的应用通常会被推向 SQLite：单文件、零运维、拷走即备份。本项目仍然选 PostgreSQL，理由是「零运维」在本地开发环境里的实际收益远小于它的隐性代价。

## Considerations

三个具体理由：

1. **技术栈一致性优先于单点最优**。项目默认数据库是 PostgreSQL，偏离默认必须有压倒性理由。这里没有——本地 Postgres 的启动成本是一次 `docker compose up -d`，之后与 SQLite 的开发体验无差别。
2. **未来要接学校数据库**。那是 PostgreSQL 生态（或至少是服务端 RDBMS 模型）。现在用 SQLite，将来那一步就是换引擎 + 重写迁移 + 重配 Mastra 存储，而不是加一个连接。
3. **Mastra 存储有原生 `PostgresStore`**。`@mastra/pg` 是官方维护的一等存储后端，SQLite 虽然也有 `LibSQLStore`，但把业务表与框架表放在两个 schema（`app.*` 与 `mastra.*`）里，隔离比「同库不同域」的约定更硬。

被放弃的方案是「开发用 SQLite、生产用 Postgres」的双引擎路线——明确拒绝，因为双引擎会让迁移文件与方言差异成为永久负担，而这个项目的「生产」就是开发者自己的笔记本。

## Consequences

- 本地开发需要 Postgres 实例。仓库提供 `docker-compose.yml`，`pnpm db:up` 一条命令拉起；CI 用 service container。
- 测试隔离从「每个测试一个临时文件」变成「每个测试一个临时 schema」（`CREATE SCHEMA app_test_<random>` + 跑完 `DROP SCHEMA ... CASCADE`）。这比临时文件更快，也不会在磁盘上留垃圾。
- 备份从「拷文件」变成 `pg_dump`。对单用户应用这是可接受的一行脚本。
- 向量检索将来可以直接上 `pgvector`，不必自建索引结构。
- 明确不做：不引入 Prisma。ORM 选型按 Drizzle，理由是它生成 SQL 可读、迁移是纯 SQL 文件，与 schema 分离的迁移策略（见下）配合更自然。

## Related

- [ADR-0002](0002-sqlite-instead-of-postgres.md)（已被本决定取代）
