import type { Generated } from 'kysely';

/** table_meta 行（系统库，snake_case） */
export interface TableMetaRow {
  id: Generated<number>;
  name: string;
  label: string;
  primary_key: string;
  fields: string; // JSON: FieldMeta[]
  is_published: number; // 0/1
  is_editable: number; // 0/1
  note: string | null;
  created_at: number; // 毫秒时间戳
  updated_at: number;
}

/**
 * 系统库类型。Phase 1 只覆盖 table_meta（engine 唯一接入的系统表）。
 * admin / api_token 属鉴权层，Phase 2 扩展。
 */
export interface SystemDB {
  table_meta: TableMetaRow;
}

/** 系统库建表 SQL（Phase 1 仅 table_meta） */
export const SYSTEM_DB_MIGRATIONS = [
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
