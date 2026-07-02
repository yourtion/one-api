import { describe, expect, it } from 'vitest';
import type { FieldMeta } from '@1api/shared';
import { fieldsToEditorSchema, isSystemManaged } from '../lib/schema-adapter.js';

const f = (over: Partial<FieldMeta> & Pick<FieldMeta, 'name' | 'jsonType'>): FieldMeta => {
  const field: FieldMeta = {
    name: over.name,
    label: over.label ?? over.name,
    sqliteType: over.sqliteType ?? 'TEXT',
    jsonType: over.jsonType,
    nullable: over.nullable ?? false,
    defaultValue: over.defaultValue ?? null,
    isPrimary: over.isPrimary ?? false,
    isAutoIncrement: over.isAutoIncrement ?? false,
    isHidden: over.isHidden ?? false,
    isReadonly: over.isReadonly ?? false,
  };
  // exactOptionalPropertyTypes：仅当存在时挂载可选属性
  if (over.enumValues !== undefined) field.enumValues = over.enumValues;
  return field;
};

describe('fieldsToEditorSchema', () => {
  it('isHidden 字段不出现在 properties', () => {
    const s = fieldsToEditorSchema([f({ name: 'a', jsonType: 'string' }), f({ name: 'sec', jsonType: 'string', isHidden: true })]);
    expect(s.properties).toHaveProperty('a');
    expect(s.properties).not.toHaveProperty('sec');
  });

  it('datetime 字段 → attrs.type=date（触发 el-date-picker）', () => {
    const s = fieldsToEditorSchema([f({ name: 't', jsonType: 'datetime' })]);
    const prop = s.properties['t']!;
    expect(prop.attrs).toMatchObject({ type: 'date' });
    expect(prop.type).toBe('string');
  });

  it('boolean 字段 → attrs.type=switch（触发 el-switch）', () => {
    const s = fieldsToEditorSchema([f({ name: 'b', jsonType: 'boolean' })]);
    const prop = s.properties['b']!;
    expect(prop.attrs).toMatchObject({ type: 'switch' });
  });

  it('字符串 enumValues → enum + attrs.type=select', () => {
    const s = fieldsToEditorSchema([f({ name: 'st', jsonType: 'string', enumValues: ['draft', 'pub'] })]);
    const prop = s.properties['st']!;
    expect(prop.enum).toEqual(['draft', 'pub']);
    expect(prop.attrs).toMatchObject({ type: 'select' });
  });

  it('integer/number 字段 → type 对应', () => {
    const s = fieldsToEditorSchema([f({ name: 'n', jsonType: 'integer' }), f({ name: 'f', jsonType: 'number' })]);
    expect(s.properties['n']!.type).toBe('integer');
    expect(s.properties['f']!.type).toBe('number');
  });

  it('nullable=false → 进 required', () => {
    const s = fieldsToEditorSchema([f({ name: 'a', jsonType: 'string', nullable: false }), f({ name: 'b', jsonType: 'string', nullable: true })]);
    expect(s.required).toContain('a');
    expect(s.required).not.toContain('b');
  });

  it('isReadonly → readOnly: true', () => {
    const s = fieldsToEditorSchema([f({ name: 'r', jsonType: 'string', isReadonly: true })]);
    expect(s.properties['r']!.readOnly).toBe(true);
  });

  it('title 取自 label', () => {
    const s = fieldsToEditorSchema([f({ name: 'a', jsonType: 'string', label: '标题' })]);
    expect(s.properties['a']!.title).toBe('标题');
  });

  it('excludeSystem:true → 系统管理字段不出现', () => {
    const s = fieldsToEditorSchema(
      [
        f({ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }),
        f({ name: 'title', jsonType: 'string' }),
        f({ name: 'created_at', jsonType: 'datetime' }),
        f({ name: 'updated_at', jsonType: 'datetime' }),
      ],
      { excludeSystem: true },
    );
    expect(s.properties).not.toHaveProperty('id');
    expect(s.properties).not.toHaveProperty('created_at');
    expect(s.properties).not.toHaveProperty('updated_at');
    expect(s.properties).toHaveProperty('title');
    expect(s.required).not.toContain('id');
    expect(s.required).toContain('title');
  });
});

describe('isSystemManaged', () => {
  it('自增主键/created_at/updated_at 视为系统管理', () => {
    expect(isSystemManaged(f({ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }))).toBe(true);
    expect(isSystemManaged(f({ name: 'created_at', jsonType: 'datetime' }))).toBe(true);
    expect(isSystemManaged(f({ name: 'updated_at', jsonType: 'datetime' }))).toBe(true);
    expect(isSystemManaged(f({ name: 'title', jsonType: 'string' }))).toBe(false);
  });
});
