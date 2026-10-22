/**
 * `sql.ts` 的每一条 SQL 都必须写全限定表名 `app.xxx`。
 *
 * ## 这条测试防的是什么
 *
 * psql 子进程的会话 `search_path` 是默认的 `"$user", public`，不是 `app, public`
 * （那是 `apps/api/src/db/database.service.ts` 的连接池自己设的，psql 不继承）。
 * 漏写前缀的表名会直接 `relation "xxx" does not exist`。
 *
 * 危险之处在于**错误被吞掉**：`pickMasteredKp()` 拿不到行就返回 `null`，
 * 阶段据此报「本机没有已掌握的知识点，复验阶段未覆盖」—— 看起来像「这台机器
 * 上确实没数据」，实际是 SQL 一直失败。实跑踩过：库里两个 mastered 节点，
 * 复验阶段却一直说未覆盖。
 *
 * 这类缺陷单测抓不到（单测不打库），只能静态扫描。扫描规则刻意宽松（正则找
 * `FROM` / `JOIN` 后面的标识符），因为它要防的是「忘写前缀」这个具体错误，
 * 不是解析 SQL。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../src/layer2/sql.ts'), 'utf8');

/** 从源码里抽出所有 `FROM <ident>` / `JOIN <ident>` 的表名。 */
function tableReferences(text: string): string[] {
  const names: string[] = [];
  const pattern = /\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)/gi;
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

describe('sql.ts 的表名', () => {
  it('每一条 FROM / JOIN 都写全限定名 app.xxx', () => {
    const names = tableReferences(source);
    /* 至少扫到几张表 —— 否则说明正则失效了，这条测试变成永远通过的空壳。 */
    expect(names.length).toBeGreaterThanOrEqual(4);

    const unqualified = names.filter((name) => !name.startsWith('app.'));
    expect(
      unqualified,
      `这些表名没有 app. 前缀，psql 会话的 search_path 里找不到它们：${unqualified.join(', ')}`,
    ).toEqual([]);
  });

  it('只有 makeReviewDue 一条写操作，且没有 DELETE / INSERT / DDL', () => {
    const statements = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(UPDATE|DELETE|INSERT|DROP|ALTER|CREATE|TRUNCATE)\b/i.test(line));
    /* UPDATE app.mastery 出现在模板字符串里，行首是反引号，所以单独找。 */
    const writes = source.match(/\b(UPDATE|DELETE|INSERT|DROP|ALTER|CREATE|TRUNCATE)\s+app\./gi) ?? [];
    expect(writes.map((entry) => entry.split(/\s+/)[0]?.toUpperCase())).toEqual(['UPDATE']);
    expect(statements).toEqual([]);
  });
});
