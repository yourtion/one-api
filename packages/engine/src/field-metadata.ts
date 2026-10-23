import { jsonTypeToSqliteType, type FieldMeta, type FieldMetaInput } from '@1api/shared';

/** 结构以反射为准；兼容的逻辑类型及用户展示配置来自建模输入或已保存的元数据。 */
export function mergeFieldMetadata(reflected: FieldMeta[], savedFields: FieldMetaInput[]): FieldMeta[] {
  const savedByName = new Map(savedFields.map((field) => [field.name, field]));
  return reflected.map((field) => {
    const saved = savedByName.get(field.name);
    if (!saved) return field;

    const merged: FieldMeta = {
      ...field,
      jsonType:
        jsonTypeToSqliteType(saved.jsonType) === field.sqliteType ? saved.jsonType : field.jsonType,
      label: saved.label ?? field.label,
      isHidden: saved.isHidden ?? field.isHidden,
      isReadonly: saved.isReadonly ?? field.isReadonly,
    };
    // enumValues 只适用于文本字符串；物理类型变化后不保留失效的校验配置。
    if (merged.jsonType === 'string' && merged.sqliteType === 'TEXT' && saved.enumValues !== undefined) {
      merged.enumValues = saved.enumValues;
    }
    return merged;
  });
}
