import type Database from 'better-sqlite3';
import {
  buildCreateColumnSql,
  jsonTypeToSqliteType,
  type CreateModelOptions,
  type FieldMeta,
  type FieldMetaInput,
} from '@1api/shared';

/** FieldMetaInput（建模输入）→ FieldMeta（完整），补齐 sqliteType 与默认标记 */
export function inputToField(input: FieldMetaInput): FieldMeta {
  const sqliteType = jsonTypeToSqliteType(input.jsonType);
  const field: FieldMeta = {
    name: input.name,
    label: input.label ?? input.name,
    sqliteType,
    jsonType: input.jsonType,
    nullable: input.nullable ?? true,
    defaultValue: input.defaultValue ?? null,
    isPrimary: input.isPrimary ?? false,
    isAutoIncrement: input.isAutoIncrement ?? false,
    isHidden: input.isHidden ?? false,
    isReadonly: input.isReadonly ?? false,
  };
  // exactOptionalPropertyTypes：仅在显式提供时挂载 enumValues
  if (input.enumValues !== undefined) field.enumValues = input.enumValues;
  return field;
}

/** CREATE TABLE（含主键约定 + 可选时间戳），执行后由调用方反射读回 */
export function createTable(db: Database.Database, opts: CreateModelOptions): void {
  const cols: string[] = [];

  const hasExplicitPk = opts.fields.some((f) => f.isPrimary);
  // 默认主键：id INTEGER PRIMARY KEY AUTOINCREMENT
  if (!hasExplicitPk) {
    cols.push('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
  }
  for (const input of opts.fields) {
    cols.push(buildCreateColumnSql(inputToField(input)));
  }
  if (opts.autoTimestamps) {
    cols.push('"created_at" INTEGER');
    cols.push('"updated_at" INTEGER');
  }

  const sql = `CREATE TABLE "${opts.name}" (${cols.join(', ')})`;
  db.exec(sql);
}

/** ALTER TABLE ... ADD COLUMN（标识符双引号包裹，支持非 snake_case） */
export function addColumn(db: Database.Database, tableName: string, field: FieldMeta): void {
  const colSql = buildCreateColumnSql(field);
  // ADD COLUMN 不支持 PRIMARY KEY/AUTOINCREMENT，剥离
  const colSafe = colSql.replace(/\s+PRIMARY KEY(\s+AUTOINCREMENT)?/i, '');
  db.exec(`ALTER TABLE "${tableName}" ADD COLUMN ${colSafe}`);
}
