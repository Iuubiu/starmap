import { describe, expect, it } from 'vitest';
import { createTestSchema } from '../../test/test-schema.js';
import { DatabaseService } from '../db/database.service.js';

describe('DatabaseService 测试隔离', () => {
  it('切换 schema 后能读到测试 schema 里的数据，而不是落在默认 app 上', async () => {
    const schema = await createTestSchema();
    const db = new DatabaseService();
    try {
      await db.useSchema(schema.name);

      const sp = await db.query<{ search_path: string }>('SHOW search_path');
      expect(sp[0]?.search_path).toContain(schema.name);

      await db.query(`INSERT INTO subjects (id, name) VALUES ('s1', '测试学科')`);
      const rows = await db.query<{ id: string }>('SELECT id FROM subjects');
      expect(rows.map((r) => r.id)).toContain('s1');
    } finally {
      await db.onModuleDestroy();
      await schema.drop();
    }
  }, 60_000);
});
