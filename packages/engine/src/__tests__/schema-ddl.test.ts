import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { addColumn, createTable } from '../schema-ddl.js';
import { readTableSchema } from '../schema-reader.js';
import type { CreateModelOptions } from '@1api/shared';

describe('schema-ddl', () => {
  let dbs: TestDbs;
  beforeEach(async () => {
    dbs = await createTestDbs();
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  it('createTable：主键 + 字段 + 时间戳', () => {
    const opts: CreateModelOptions = {
      name: 'posts',
      label: '文章',
      fields: [
        { name: 'title', jsonType: 'string', nullable: false },
        { name: 'views', jsonType: 'integer', nullable: false, defaultValue: 0 },
      ],
      autoTimestamps: true,
    };
    createTable(dbs.businessRaw, opts);
    const { fields, primaryKey } = readTableSchema(dbs.businessRaw, 'posts');
    expect(primaryKey).toBe('id');
    const names = fields.map((f) => f.name);
    expect(names).toEqual(['id', 'title', 'views', 'created_at', 'updated_at']);
    expect(fields.find((f) => f.name === 'title')!.nullable).toBe(false);
    expect(fields.find((f) => f.name === 'views')!.defaultValue).toBe(0);
  });

  it('createTable：自定义主键字段', () => {
    const opts: CreateModelOptions = {
      name: 't',
      label: 'T',
      fields: [{ name: 'code', jsonType: 'string', nullable: false, isPrimary: true }],
    };
    createTable(dbs.businessRaw, opts);
    const { primaryKey } = readTableSchema(dbs.businessRaw, 't');
    expect(primaryKey).toBe('code');
  });

  it('addColumn：追加字段后可反射读回', () => {
    createTable(dbs.businessRaw, {
      name: 't',
      label: 'T',
      fields: [{ name: 'a', jsonType: 'string' }],
    });
    addColumn(dbs.businessRaw, 't', {
      name: 'b',
      label: 'b',
      sqliteType: 'TEXT',
      jsonType: 'string',
      nullable: true,
      defaultValue: null,
      isPrimary: false,
      isAutoIncrement: false,
      isHidden: false,
      isReadonly: false,
    });
    const { fields } = readTableSchema(dbs.businessRaw, 't');
    expect(fields.map((f) => f.name)).toEqual(['id', 'a', 'b']);
  });
});
