import { describe, expect, it } from 'vitest';
import { createTestDbs } from '../test-helpers.js';

describe('createTestDbs', () => {
  it('创建临时库且可执行原生 DDL', async () => {
    const dbs = await createTestDbs();
    expect(dbs.businessDbPath).toMatch(/\.db$/);
    expect(dbs.systemDbPath).toMatch(/\.db$/);
    // 原生 better-sqlite3 句柄可建表
    dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    dbs.businessRaw.prepare('INSERT INTO t (name) VALUES (?)').run('a');
    expect(dbs.businessRaw.prepare('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 1 });
    await dbs.cleanup();
  });
});
