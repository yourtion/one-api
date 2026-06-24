import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { SystemDB } from './system-db.js';

export interface TestDbs {
  businessDbPath: string;
  systemDbPath: string;
  businessRaw: Database.Database; // better-sqlite3 原生（反射/DDL）
  businessDb: Kysely<Record<string, never>>; // 动态业务库（无静态 schema）
  systemRaw: Database.Database;
  systemDb: Kysely<SystemDB>;
  cleanup: () => Promise<void>;
}

let counter = 0;

/** 创建临时业务库 + 系统库（每次唯一路径），返回句柄与 cleanup。 */
export async function createTestDbs(): Promise<TestDbs> {
  const dir = mkdtempSync(join(tmpdir(), `1api-${randomBytes(4).toString('hex')}-`));
  const businessDbPath = join(dir, `biz-${counter}.db`);
  const systemDbPath = join(dir, `sys-${counter}.db`);
  counter += 1;

  const businessRaw = new Database(businessDbPath);
  businessRaw.pragma('journal_mode = WAL');
  const systemRaw = new Database(systemDbPath);

  const businessDb = new Kysely<Record<string, never>>({
    dialect: new SqliteDialect({ database: businessRaw }),
  });
  const systemDb = new Kysely<SystemDB>({
    dialect: new SqliteDialect({ database: systemRaw }),
  });

  return {
    businessDbPath,
    systemDbPath,
    businessRaw,
    businessDb,
    systemRaw,
    systemDb,
    cleanup: async () => {
      await businessDb.destroy();
      await systemDb.destroy();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
