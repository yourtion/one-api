import type { FieldMeta, JsonType, SqliteType } from '../types.js';
import { coerceBool, coerceInt, coerceNum } from './parsers.js';
import { z } from 'zod';

/** SQLite 存储类型 → 逻辑类型（结构性，不含命名推断；datetime 由反射层按列名判定） */
export function sqliteTypeToJsonType(sqliteType: SqliteType, _enumValues?: string[]): JsonType {
  switch (sqliteType) {
    case 'INTEGER':
      return 'integer';
    case 'REAL':
    case 'NUMERIC':
      return 'number';
    case 'TEXT':
      return 'string';
    case 'BLOB':
      throw new Error('BLOB 类型不支持映射（无法编辑/校验）');
  }
}

/** 逻辑类型 → SQLite 建表类型 */
export function jsonTypeToSqliteType(jsonType: JsonType): SqliteType {
  switch (jsonType) {
    case 'integer':
    case 'boolean':
      return 'INTEGER';
    case 'number':
      return 'REAL';
    case 'string':
    case 'datetime':
      return 'TEXT';
  }
}

/** 单字段 → JSON Schema 片段（供 vue-json-ui-editor） */
export function fieldToJsonSchema(f: FieldMeta): Record<string, unknown> {
  let base: Record<string, unknown>;
  switch (f.jsonType) {
    case 'integer':
      base = { type: 'integer' };
      break;
    case 'boolean':
      base = { type: 'boolean' };
      break;
    case 'number':
      base = { type: 'number' };
      break;
    case 'datetime':
      base = { type: 'string', format: 'date-time' };
      break;
    case 'string':
    default:
      base =
        f.enumValues && f.enumValues.length > 0
          ? { type: 'string', enum: f.enumValues }
          : { type: 'string' };
  }
  if (f.nullable) {
    const t = base['type'];
    base['type'] = Array.isArray(t) ? [...t, 'null'] : [t, 'null'];
  }
  return base;
}

/** 字段数组 → 完整 object JSON Schema */
export function fieldsToJsonSchema(fields: FieldMeta[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    properties[f.name] = fieldToJsonSchema(f);
    if (!f.nullable) required.push(f.name);
  }
  return { type: 'object', properties, required };
}

/** 单字段 → Zod schema（引擎写入与各消费端共用） */
export function fieldToZod(f: FieldMeta): z.ZodType {
  let s: z.ZodType;
  switch (f.jsonType) {
    case 'integer':
      s = coerceInt;
      break;
    case 'boolean':
      s = coerceBool;
      break;
    case 'number':
      s = coerceNum;
      break;
    case 'datetime':
      s = z.string().datetime();
      break;
    case 'string':
    default:
      s =
        f.enumValues && f.enumValues.length > 0
          ? z.enum(f.enumValues as [string, ...string[]])
          : z.string();
  }
  return f.nullable ? s.nullable() : s;
}

/** 字段默认值 → SQL 字面量片段（null/undefined 视为无默认值，不生成子句） */
function defaultValueLiteral(f: FieldMeta): string | null {
  const v = f.defaultValue;
  if (v === undefined || v === null) return null; // 无默认值
  if (f.jsonType === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  return null; // 对象/数组等不支持作为列默认值
}

/** FieldMeta → CREATE TABLE 列定义片段（标识符双引号包裹） */
export function buildCreateColumnSql(f: FieldMeta): string {
  const sqliteType = f.sqliteType;
  // 主键自增（仅 INTEGER 主键支持 AUTOINCREMENT）
  if (f.isPrimary && f.isAutoIncrement) {
    return `"${f.name}" ${sqliteType} PRIMARY KEY AUTOINCREMENT`;
  }
  if (f.isPrimary) {
    return `"${f.name}" ${sqliteType} PRIMARY KEY`;
  }
  const parts = [`"${f.name}"`, sqliteType];
  if (!f.nullable) parts.push('NOT NULL');
  const def = defaultValueLiteral(f);
  if (def !== null) parts.push(`DEFAULT ${def}`);
  return parts.join(' ');
}
