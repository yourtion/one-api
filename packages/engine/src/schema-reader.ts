import type Database from 'better-sqlite3';
import { Errors, type FieldMeta, type JsonType, type SqliteType } from '@1api/shared';

interface PragmaRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

const DATETIME_NAME_RE = /(^|_)(at|time)$/i;

/** 列出业务库所有用户表（排除 sqlite_ 内部表） */
export function listTables(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

/** 主键策略：只接受单主键 */
function resolvePrimaryKey(rows: PragmaRow[], tableName: string): { pkField: string } {
  const pkRows = rows.filter((r) => r.pk > 0);
  if (pkRows.length === 0) throw Errors.tableNoPrimaryKey(tableName);
  if (pkRows.length > 1) throw Errors.tableCompositePrimaryKey(tableName);
  return { pkField: pkRows[0]!.name };
}

/** SQLite 原生类型串归一为五类之一 */
function normalizeSqliteType(raw: string): SqliteType {
  const t = raw.toUpperCase();
  if (t === '') return 'BLOB'; // 无类型声明 → BLOB 亲和
  if (t.includes('INT')) return 'INTEGER';
  if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'TEXT';
  if (t.includes('BLOB')) return 'BLOB';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'REAL';
  return 'NUMERIC';
}

/** jsonType 推断（含命名启发式） */
function inferJsonType(
  sqliteType: SqliteType,
  colName: string,
  defaultValue: string | null,
): JsonType {
  const lower = colName.toLowerCase();
  const isBooleanish =
    (lower.startsWith('is_') || lower.startsWith('has_')) && sqliteType === 'INTEGER';
  if (isBooleanish && (defaultValue === '0' || defaultValue === '1')) return 'boolean';
  if (sqliteType === 'INTEGER') return 'integer';
  if (sqliteType === 'REAL' || sqliteType === 'NUMERIC') return 'number';
  if (sqliteType === 'BLOB') return 'string'; // BLOB 作为 string 读取（不接受输入由上层校验）
  // TEXT
  if (DATETIME_NAME_RE.test(lower)) return 'datetime';
  return 'string';
}

/** 反射单表 → FieldMeta[] + 主键 */
export function readTableSchema(
  db: Database.Database,
  tableName: string,
): { fields: FieldMeta[]; primaryKey: string } {
  const rows = db.prepare(`PRAGMA table_info(${JSON.stringify(tableName)})`).all() as PragmaRow[];
  if (rows.length === 0) throw Errors.tableNotFound(tableName);
  const { pkField } = resolvePrimaryKey(rows, tableName);

  const fields: FieldMeta[] = rows
    .sort((a, b) => a.cid - b.cid)
    .map((r) => {
      const sqliteType = normalizeSqliteType(r.type);
      const jsonType = inferJsonType(sqliteType, r.name, r.dflt_value);
      const isPrimary = r.name === pkField;
      const lower = r.name.toLowerCase();
      const isReadonly =
        jsonType === 'datetime' && (lower === 'created_at' || lower === 'updated_at');
      return {
        name: r.name,
        label: r.name,
        sqliteType,
        jsonType,
        nullable: r.notnull === 0,
        defaultValue: parseDefaultValue(r.dflt_value, jsonType),
        isPrimary,
        isAutoIncrement: isPrimary && sqliteType === 'INTEGER',
        isHidden: false,
        isReadonly,
      } satisfies FieldMeta;
    });

  return { fields, primaryKey: pkField };
}

/** 解析默认值字面量；SQL 表达式保留原文，由 SQLite 在插入时求值。 */
function parseDefaultValue(raw: string | null, jsonType: JsonType): unknown {
  if (raw === null) return null;
  const v = raw.trim();
  if (/^NULL$/i.test(v)) return null;
  if (jsonType === 'boolean') return v === '1' ? true : v === '0' ? false : raw;
  if (jsonType === 'integer' || jsonType === 'number') {
    const n = Number(v);
    return v !== '' && Number.isFinite(n) ? n : raw;
  }
  // 仅对完整的单引号字符串字面量去引号；拼接等 SQL 表达式保持原样。
  return /^'(?:[^']|'')*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : raw;
}
