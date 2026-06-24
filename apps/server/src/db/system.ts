import { Kysely, SqliteDialect } from 'kysely';
import Database from 'better-sqlite3';
import { hashPassword } from '../utils/password.js';
import type { ServerSystemDB } from './types.js';
import { SYSTEM_DDL } from './migrations.js';

export interface SystemDbHandle {
  /** 原生 better-sqlite3 句柄（DDL/反射/批量用） */
  raw: Database.Database;
  /** Kysely 实例（typed query 用） */
  db: Kysely<ServerSystemDB>;
  close: () => Promise<void>;
}

/**
 * 初始化系统库：建库文件 → DDL（admin/api_token/table_meta 幂等）→ 首启插入默认 admin。
 * 幂等：表已存在不报错；admin 已存在不重复插。
 */
export async function initSystemDb(
  path: string,
  defaultAdmin: { name: string; password: string } = { name: 'admin', password: '123456' },
): Promise<SystemDbHandle> {
  const raw = new Database(path);
  for (const sql of SYSTEM_DDL) raw.exec(sql);

  // 首启插入默认 admin（若不存在）
  const exists = raw
    .prepare('SELECT COUNT(*) AS c FROM admin WHERE name = ?')
    .get(defaultAdmin.name) as { c: number };
  if (exists.c === 0) {
    const now = Date.now();
    raw
      .prepare(
        'INSERT INTO admin (name, nickname, password_hash, must_change_password, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      )
      .run(defaultAdmin.name, defaultAdmin.name, hashPassword(defaultAdmin.password), now, now);
  }

  const db = new Kysely<ServerSystemDB>({ dialect: new SqliteDialect({ database: raw }) });
  return {
    raw,
    db,
    close: async () => {
      await db.destroy();
      raw.close();
    },
  };
}
