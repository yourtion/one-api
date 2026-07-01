/** 系统库建表 SQL（幂等 IF NOT EXISTS）。table_meta 与 engine 的 SYSTEM_DB_MIGRATIONS 对齐，幂等建。 */
export const SYSTEM_DDL = [
  `CREATE TABLE IF NOT EXISTS admin (
     id                   INTEGER PRIMARY KEY AUTOINCREMENT,
     name                 TEXT NOT NULL UNIQUE,
     nickname             TEXT NOT NULL,
     password_hash        TEXT NOT NULL,
     must_change_password INTEGER NOT NULL DEFAULT 0,
     created_at           INTEGER NOT NULL,
     updated_at           INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS api_token (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     name         TEXT NOT NULL,
     token_hash   TEXT NOT NULL UNIQUE,
     token_prefix TEXT NOT NULL,
     permissions  TEXT NOT NULL,
     is_active    INTEGER NOT NULL DEFAULT 1,
     expires_at   INTEGER,
     last_used_at INTEGER,
     created_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL
   )`,
  // table_meta 与 engine 对齐，幂等建（若 engine 未先建则补建）
  `CREATE TABLE IF NOT EXISTS table_meta (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     name         TEXT NOT NULL UNIQUE,
     label        TEXT NOT NULL,
     primary_key  TEXT NOT NULL,
     fields       TEXT NOT NULL,
     is_published INTEGER NOT NULL DEFAULT 1,
     is_editable  INTEGER NOT NULL DEFAULT 1,
     note         TEXT,
     created_at   INTEGER NOT NULL,
     updated_at   INTEGER NOT NULL
   )`,
] as const;
