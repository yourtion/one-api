import type { FieldMeta } from '@1api/shared';

/**
 * 系统管理字段：自增主键 / created_at / updated_at。
 * 这类字段在数据编辑表单中应只读（值由系统维护）。
 */
export function isSystemManaged(field: FieldMeta): boolean {
  if (field.isAutoIncrement && field.isPrimary) return true;
  return field.name === 'created_at' || field.name === 'updated_at';
}

interface EditorSchema {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required: string[];
}

/**
 * FieldMeta[] → vue-json-ui-editor 可用的 JSON Schema。
 *
 * widget 决定规则（来自 vue-json-ui-editor/src/parser.ts 源码确认）：
 *  - parser 把 `schema.attrs` 整体当作 field，`field.type` 决定 widget
 *  - `field.type` 一旦在 attrs 中设定就不会被 parser 默认值覆盖
 *  - 故通过 `attrs.type` 强制 widget：'switch'(el-switch) / 'date'(el-date-picker) / 'select'(el-select)
 *
 * 各 jsonType 处理：
 *  - datetime → type:string + attrs.type='date'（parser 不识别 format:date-time，必须显式 date）
 *  - boolean  → type:boolean + attrs.type='switch'（默认是 checkbox）
 *  - integer/number → 对应 JSON Schema type（parser 自动映射为 number widget → el-input-number）
 *  - string   → type:string；若有 enumValues → 加 enum + attrs.type='select'
 *               （注：parser 的 select 选项填充在 array 分支，string+select 的选项填充
 *                需在 Task 15 DataBrowse 集成时验证；若选项为空，届时迭代）
 *
 * 其他规则：
 *  - isHidden → 不出现在 properties
 *  - isReadonly / 系统管理字段 → readOnly:true
 *  - nullable=false → required
 */
export function fieldsToEditorSchema(fields: FieldMeta[], opts?: { excludeSystem?: boolean }): EditorSchema {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const field of fields) {
    if (field.isHidden) continue;
    // 新增模式：完全跳过系统管理字段（自增主键/created_at/updated_at），
    // 这些字段由系统维护，用户不应填写，出现在 required 里会导致 validate 失败。
    if (opts?.excludeSystem && isSystemManaged(field)) continue;

    const prop: Record<string, unknown> = { title: field.label || field.name };
    let attrs: Record<string, unknown> | undefined;

    if (field.jsonType === 'datetime') {
      prop['type'] = 'string';
      prop['format'] = 'date-time';
      attrs = { type: 'date' };
    } else if (field.jsonType === 'integer') {
      prop['type'] = 'integer';
    } else if (field.jsonType === 'number') {
      prop['type'] = 'number';
    } else if (field.jsonType === 'boolean') {
      prop['type'] = 'boolean';
      attrs = { type: 'switch' };
    } else {
      // string
      prop['type'] = 'string';
      if (field.enumValues && field.enumValues.length > 0) {
        prop['enum'] = field.enumValues;
        attrs = { type: 'select' };
      }
    }

    // nullable：进 required 与否
    if (!field.nullable) {
      required.push(field.name);
    }

    // 只读（编辑模式下系统字段仍展示但禁用）
    if (field.isReadonly || isSystemManaged(field)) {
      prop['readOnly'] = true;
    }

    // exactOptionalPropertyTypes：仅当 attrs 存在时挂载
    if (attrs !== undefined) {
      prop['attrs'] = attrs;
    }

    properties[field.name] = prop;
  }

  return { type: 'object', properties, required };
}
