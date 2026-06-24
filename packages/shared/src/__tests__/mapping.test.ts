import { describe, expect, it } from 'vitest';
import {
  sqliteTypeToJsonType,
  jsonTypeToSqliteType,
  fieldToJsonSchema,
  fieldsToJsonSchema,
  fieldToZod,
  buildCreateColumnSql,
} from '../index.js';
import type { FieldMeta } from '../index.js';

function field(over: Partial<FieldMeta>): FieldMeta {
  return {
    name: 'f',
    label: 'F',
    sqliteType: 'TEXT',
    jsonType: 'string',
    nullable: false,
    defaultValue: null,
    isPrimary: false,
    isAutoIncrement: false,
    isHidden: false,
    isReadonly: false,
    ...over,
  };
}

describe('sqliteTypeToJsonType', () => {
  it('INTEGER → integer', () => {
    expect(sqliteTypeToJsonType('INTEGER')).toBe('integer');
  });
  it('REAL / NUMERIC → number', () => {
    expect(sqliteTypeToJsonType('REAL')).toBe('number');
    expect(sqliteTypeToJsonType('NUMERIC')).toBe('number');
  });
  it('TEXT → string（枚举存在仍为 string）', () => {
    expect(sqliteTypeToJsonType('TEXT')).toBe('string');
    expect(sqliteTypeToJsonType('TEXT', ['a', 'b'])).toBe('string');
  });
  it('BLOB → 抛错（不支持）', () => {
    expect(() => sqliteTypeToJsonType('BLOB')).toThrow();
  });
});

describe('jsonTypeToSqliteType（建表用）', () => {
  it('boolean/integer → INTEGER', () => {
    expect(jsonTypeToSqliteType('integer')).toBe('INTEGER');
    expect(jsonTypeToSqliteType('boolean')).toBe('INTEGER');
  });
  it('number → REAL', () => {
    expect(jsonTypeToSqliteType('number')).toBe('REAL');
  });
  it('string/datetime → TEXT', () => {
    expect(jsonTypeToSqliteType('string')).toBe('TEXT');
    expect(jsonTypeToSqliteType('datetime')).toBe('TEXT');
  });
});

describe('fieldToJsonSchema', () => {
  it('integer', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'integer' }))).toEqual({ type: 'integer' });
  });
  it('boolean', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'boolean' }))).toEqual({ type: 'boolean' });
  });
  it('number', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'number' }))).toEqual({ type: 'number' });
  });
  it('string', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'string' }))).toEqual({ type: 'string' });
  });
  it('string + enum', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'string', enumValues: ['a', 'b'] }))).toEqual({
      type: 'string',
      enum: ['a', 'b'],
    });
  });
  it('datetime', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'datetime' }))).toEqual({
      type: 'string',
      format: 'date-time',
    });
  });
  it('nullable 产生 [type,"null"]', () => {
    expect(fieldToJsonSchema(field({ jsonType: 'string', nullable: true }))).toEqual({
      type: ['string', 'null'],
    });
  });
});

describe('fieldsToJsonSchema', () => {
  it('聚合为 object + required', () => {
    const schema = fieldsToJsonSchema([
      field({ name: 'id', jsonType: 'integer', nullable: false }),
      field({ name: 'name', jsonType: 'string', nullable: true }),
    ]);
    expect(schema).toEqual({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: ['string', 'null'] } },
      required: ['id'],
    });
  });
});

describe('fieldToZod', () => {
  it('integer（coerceInt）', () => {
    expect(fieldToZod(field({ jsonType: 'integer' })).parse('5')).toBe(5);
  });
  it('boolean（coerceBool，"false"→false）', () => {
    expect(fieldToZod(field({ jsonType: 'boolean' })).parse('false')).toBe(false);
    expect(() => fieldToZod(field({ jsonType: 'boolean' })).parse('yes')).toThrow();
  });
  it('number（coerceNum）', () => {
    expect(fieldToZod(field({ jsonType: 'number' })).parse('3.14')).toBe(3.14);
  });
  it('string', () => {
    expect(fieldToZod(field({ jsonType: 'string' })).parse('x')).toBe('x');
  });
  it('string + enum', () => {
    const s = fieldToZod(field({ jsonType: 'string', enumValues: ['a', 'b'] }));
    expect(s.parse('a')).toBe('a');
    expect(() => s.parse('c')).toThrow();
  });
  it('datetime', () => {
    const s = fieldToZod(field({ jsonType: 'datetime' }));
    expect(s.parse('2024-01-01T00:00:00Z')).toBe('2024-01-01T00:00:00Z');
    expect(() => s.parse('not-a-date')).toThrow();
  });
  it('nullable 接受 null', () => {
    expect(fieldToZod(field({ jsonType: 'string', nullable: true })).parse(null)).toBeNull();
  });
});

describe('buildCreateColumnSql', () => {
  it('主键自增', () => {
    expect(
      buildCreateColumnSql(
        field({
          name: 'id',
          sqliteType: 'INTEGER',
          jsonType: 'integer',
          isPrimary: true,
          isAutoIncrement: true,
        }),
      ),
    ).toBe('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
  });
  it('NOT NULL 字符串', () => {
    expect(
      buildCreateColumnSql(
        field({ name: 'title', sqliteType: 'TEXT', jsonType: 'string', nullable: false }),
      ),
    ).toBe('"title" TEXT NOT NULL');
  });
  it('可空 + 默认值（字符串转义）', () => {
    expect(
      buildCreateColumnSql(
        field({
          name: 'status',
          sqliteType: 'TEXT',
          jsonType: 'string',
          nullable: true,
          defaultValue: 'ok',
        }),
      ),
    ).toBe('"status" TEXT DEFAULT \'ok\'');
  });
  it('布尔默认 0/1', () => {
    expect(
      buildCreateColumnSql(
        field({
          name: 'is_active',
          sqliteType: 'INTEGER',
          jsonType: 'boolean',
          nullable: false,
          defaultValue: false,
        }),
      ),
    ).toBe('"is_active" INTEGER NOT NULL DEFAULT 0');
  });
  it('数字默认值', () => {
    expect(
      buildCreateColumnSql(
        field({ name: 'age', sqliteType: 'REAL', jsonType: 'number', nullable: false, defaultValue: 18 }),
      ),
    ).toBe('"age" REAL NOT NULL DEFAULT 18');
  });
});
