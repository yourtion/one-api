import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { TokenPermissions } from '@1api/shared';

/** sha256 hex（与 server utils/token.ts 的 hashToken 一致）。 */
export function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/**
 * 确保系统库含 table_meta + api_token + admin 表（本地直连模式前置）。
 * 用 IF NOT EXISTS 幂等。DDL 与 server db/migrations.ts 的 SYSTEM_DDL 对齐。
 */
export function ensureSystemDb(systemDbPath: string): void {
  const db = new Database(systemDbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS table_meta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      primary_key TEXT NOT NULL,
      fields TEXT NOT NULL,
      is_published INTEGER NOT NULL DEFAULT 1,
      is_editable INTEGER NOT NULL DEFAULT 1,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_token (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      permissions TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at INTEGER,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.close();
}

/**
 * 本地 token 校验：sha256 比对 + is_active + 未过期。无效返回 null。
 * 与 server middlewares/token-store.ts 的 resolveToken 语义一致（CLI 自实现最小版本，不跨包依赖 server）。
 */
export async function resolveLocalToken(
  systemDbPath: string,
  plain: string,
): Promise<{ id: number; name: string; permissions: TokenPermissions } | null> {
  const db = new Database(systemDbPath, { readonly: true });
  try {
    const row = db
      .prepare(`SELECT id, name, permissions, is_active, expires_at FROM api_token WHERE token_hash = ?`)
      .get(hashToken(plain)) as
      | {
          id: number;
          name: string;
          permissions: string;
          is_active: number;
          expires_at: number | null;
        }
      | undefined;
    if (!row) return null;
    if (row.is_active !== 1) return null;
    if (row.expires_at !== null && row.expires_at < Date.now()) return null;
    return {
      id: row.id,
      name: row.name,
      permissions: JSON.parse(row.permissions) as TokenPermissions,
    };
  } finally {
    db.close();
  }
}
