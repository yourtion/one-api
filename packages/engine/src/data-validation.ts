import { Errors, fieldToZod, type FieldMeta, type TableMeta } from '@1api/shared';

type Row = Record<string, unknown>;

function isManagedTimestamp(name: string): boolean {
  return name === 'created_at' || name === 'updated_at';
}

/** 校验并复制写入数据；只读字段兼容管理表单回传，系统值始终由引擎维护。 */
export function validateWriteData(meta: TableMeta, input: Row, mode: 'create' | 'update'): Row {
  const data = Object.create(null) as Row;
  for (const [name, value] of Object.entries(input)) {
    const field = meta.fields.find((f) => f.name === name);
    if (!field) throw Errors.validationFail(`字段不存在: ${name}`);
    if (field.isReadonly || isManagedTimestamp(name) || (mode === 'update' && field.isPrimary)) {
      continue;
    }
    if (field.sqliteType === 'BLOB') {
      throw Errors.validationFail(`字段 ${name} 为 BLOB 类型，不支持写入`);
    }
    if (field.isPrimary && !field.isAutoIncrement && value === null) {
      throw Errors.validationFail(`字段 ${name} 为主键，不能为 null`);
    }
    const parsed = fieldToZod(field).safeParse(value);
    if (!parsed.success) throw Errors.validationFail(`字段 ${name} 的值不合法`);
    data[name] = typeof parsed.data === 'boolean' ? (parsed.data ? 1 : 0) : parsed.data;
  }

  if (mode === 'create') {
    for (const field of meta.fields) {
      const hasDefault = field.defaultValue !== null && field.defaultValue !== undefined;
      const required = field.isPrimary || (!field.nullable && !hasDefault);
      if (
        required &&
        !field.isAutoIncrement &&
        !isManagedTimestamp(field.name) &&
        !Object.hasOwn(data, field.name)
      ) {
        throw Errors.validationFail(`字段 ${field.name} 为必填字段`);
      }
    }
  }

  const now = Date.now();
  for (const field of meta.fields) {
    if (field.name === 'updated_at' || (mode === 'create' && field.name === 'created_at')) {
      data[field.name] = now;
    }
  }
  return data;
}

/** 自增保持原子 SQL，只允许可写数值字段及合法增量。 */
export function validateIncrement(field: FieldMeta, n: number): void {
  if (field.jsonType !== 'integer' && field.jsonType !== 'number') {
    throw Errors.validationFail(`字段 ${field.name} 非数值类型，不可自增`);
  }
  if (field.isReadonly || field.isPrimary || isManagedTimestamp(field.name)) {
    throw Errors.validationFail(`字段 ${field.name} 不可自增`);
  }
  if (!Number.isFinite(n) || (field.jsonType === 'integer' && !Number.isInteger(n))) {
    throw Errors.validationFail(`字段 ${field.name} 的自增值不合法`);
  }
}
