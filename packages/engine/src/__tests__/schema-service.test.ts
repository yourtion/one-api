import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Errors } from '@1api/shared';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { SYSTEM_DB_MIGRATIONS } from '../system-db.js';
import { MetadataStore } from '../metadata.js';
import { SchemaService } from '../schema-service.js';
import { readTableSchema } from '../schema-reader.js';

describe('SchemaService', () => {
  let dbs: TestDbs;
  let svc: SchemaService;
  beforeEach(async () => {
    dbs = await createTestDbs();
    for (const m of SYSTEM_DB_MIGRATIONS) dbs.systemRaw.exec(m);
    const store = new MetadataStore(dbs.systemDb, dbs.businessRaw);
    svc = new SchemaService(dbs.businessRaw, store);
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  describe('importExisting', () => {
    it('正常导入单主键表（label 留空待填）', async () => {
      dbs.businessRaw.exec('CREATE TABLE FooBar (id INTEGER PRIMARY KEY, name TEXT)');
      const meta = await svc.importExisting('FooBar');
      expect(meta.name).toBe('FooBar'); // 保留实际表名
      expect(meta.label).toBe(''); // 留空待填
      expect(meta.primaryKey).toBe('id');
    });
    it('无主键表 → 透传 TABLE_NO_PRIMARY_KEY', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (a INTEGER, b INTEGER)');
      await expect(svc.importExisting('t')).rejects.toThrow(Errors.tableNoPrimaryKey('t'));
    });
    it('复合主键表 → 透传 TABLE_COMPOSITE_PRIMARY_KEY', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (a INTEGER, b INTEGER, PRIMARY KEY(a,b))');
      await expect(svc.importExisting('t')).rejects.toThrow(
        Errors.tableCompositePrimaryKey('t'),
      );
    });
    it('表不存在 → TABLE_NOT_FOUND', async () => {
      await expect(svc.importExisting('nope')).rejects.toThrow(Errors.tableNotFound('nope'));
    });
    it('重复导入 → TABLE_ALREADY_EXISTS', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      await svc.importExisting('t');
      await expect(svc.importExisting('t')).rejects.toThrow(Errors.tableAlreadyExists('t'));
    });
  });

  describe('createModel 名称校验', () => {
    it('保留请求的逻辑类型和展示配置，并以真实结构为准，重载缓存后仍保留', async () => {
      const meta = await svc.createModel({
        name: 'events',
        label: '事件',
        fields: [
          { name: 'active', jsonType: 'boolean', label: '启用', isHidden: true, isReadonly: true },
          { name: 'scheduled', jsonType: 'datetime', label: '排期', nullable: false },
          {
            name: 'status',
            jsonType: 'string',
            label: '状态',
            enumValues: ['draft', 'published'],
            nullable: false,
            defaultValue: 'draft',
            isHidden: true,
          },
          { name: 'created_at', jsonType: 'string', isReadonly: false },
        ],
      });
      const expected = [
        { name: 'active', jsonType: 'boolean', label: '启用', isHidden: true, isReadonly: true },
        { name: 'scheduled', jsonType: 'datetime', label: '排期', sqliteType: 'TEXT', nullable: false },
        {
          name: 'status',
          label: '状态',
          jsonType: 'string',
          enumValues: ['draft', 'published'],
          defaultValue: 'draft',
          nullable: false,
          isHidden: true,
        },
        { name: 'created_at', jsonType: 'string', isReadonly: false },
      ];
      expect(meta.fields.slice(1)).toMatchObject(expected);
      const reflected = readTableSchema(dbs.businessRaw, 'events');
      for (const field of meta.fields) {
        const physical = reflected.fields.find((f) => f.name === field.name)!;
        expect(field).toMatchObject({
          sqliteType: physical.sqliteType,
          nullable: physical.nullable,
          defaultValue: physical.defaultValue,
          isPrimary: physical.isPrimary,
          isAutoIncrement: physical.isAutoIncrement,
        });
      }
      await svc.refresh('events');
      await svc.refresh('events');
      const restartedStore = new MetadataStore(dbs.systemDb, dbs.businessRaw);
      await restartedStore.warmup();
      expect((await restartedStore.getMetaByName('events'))!.fields.slice(1)).toMatchObject(expected);
    });

    it('合法名建表 + 读回真实结构 + 存元数据', async () => {
      const meta = await svc.createModel({
        name: 'posts',
        label: '文章',
        fields: [{ name: 'title', jsonType: 'string', nullable: false }],
        autoTimestamps: true,
      });
      expect(meta.name).toBe('posts');
      expect(meta.fields.map((f) => f.name)).toEqual(['id', 'title', 'created_at', 'updated_at']);
    });
    it('大写名 → INVALID_NAME', async () => {
      await expect(svc.createModel({ name: 'Posts', label: 'X', fields: [] })).rejects.toThrow(
        Errors.invalidName('Posts'),
      );
    });
    it('数字开头 → INVALID_NAME', async () => {
      await expect(svc.createModel({ name: '1posts', label: 'X', fields: [] })).rejects.toThrow(
        Errors.invalidName('1posts'),
      );
    });
    it('保留字 schema → RESERVED_NAME', async () => {
      await expect(svc.createModel({ name: 'schema', label: 'X', fields: [] })).rejects.toThrow(
        Errors.reservedName('schema'),
      );
    });
    it.each(['Uppercase', '1field', 'has-dash'])('非法字段名 %s 在建表前拒绝', async (name) => {
      await expect(
        svc.createModel({ name: 'invalid_fields', label: 'X', fields: [{ name, jsonType: 'string' }] }),
      ).rejects.toThrow(Errors.invalidName(name));
      expect(
        dbs.businessRaw.prepare("SELECT name FROM sqlite_master WHERE name = 'invalid_fields'").get(),
      ).toBeUndefined();
    });
    it.each(['schema', 'records', 'incr'])('保留字段名 %s 在建表前拒绝', async (name) => {
      await expect(
        svc.createModel({ name: 'invalid_fields', label: 'X', fields: [{ name, jsonType: 'string' }] }),
      ).rejects.toThrow(Errors.reservedName(name));
      expect(
        dbs.businessRaw.prepare("SELECT name FROM sqlite_master WHERE name = 'invalid_fields'").get(),
      ).toBeUndefined();
    });
    it('业务库已存在同名表（但未导入）→ TABLE_ALREADY_EXISTS', async () => {
      dbs.businessRaw.exec('CREATE TABLE existing (id INTEGER PRIMARY KEY)');
      await expect(
        svc.createModel({ name: 'existing', label: 'X', fields: [] }),
      ).rejects.toThrow(Errors.tableAlreadyExists('existing'));
    });
  });

  describe('addField', () => {
    it('新增字段保留逻辑类型、label、枚举和显隐/只读配置，refresh 和重载后不丢失', async () => {
      await svc.createModel({ name: 'events', label: '事件', fields: [] });
      await svc.addField('events', {
        name: 'active',
        jsonType: 'boolean',
        label: '启用',
        isHidden: true,
        isReadonly: true,
      });
      await svc.addField('events', { name: 'scheduled', jsonType: 'datetime', label: '排期' });
      await svc.addField('events', {
        name: 'status',
        jsonType: 'string',
        label: '状态',
        enumValues: ['draft', 'published'],
      });
      await svc.refresh('events');
      const after = await svc.refresh('events');
      const expected = [
        {
          name: 'active',
          jsonType: 'boolean',
          label: '启用',
          isHidden: true,
          isReadonly: true,
          sqliteType: 'INTEGER',
        },
        { name: 'scheduled', jsonType: 'datetime', label: '排期', sqliteType: 'TEXT' },
        { name: 'status', jsonType: 'string', label: '状态', enumValues: ['draft', 'published'] },
      ];
      expect(after.fields.slice(1)).toMatchObject(expected);
      const restartedStore = new MetadataStore(dbs.systemDb, dbs.businessRaw);
      await restartedStore.warmup();
      expect((await restartedStore.getMetaByName('events'))!.fields.slice(1)).toMatchObject(expected);
    });

    it('追加字段 + refresh', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      await svc.importExisting('t');
      await svc.addField('t', { name: 'age', jsonType: 'integer', nullable: true });
      const after = await svc.refresh('t');
      expect(after.fields.map((f) => f.name)).toEqual(['id', 'age']);
    });
    it('非法字段名 → INVALID_NAME', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      await svc.importExisting('t');
      await expect(svc.addField('t', { name: 'Age', jsonType: 'integer' })).rejects.toThrow(
        Errors.invalidName('Age'),
      );
    });
    it('字段已存在 → VALIDATION_FAIL', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
      await svc.importExisting('t');
      await expect(svc.addField('t', { name: 'id', jsonType: 'integer' })).rejects.toThrow(
        /VALIDATION_FAIL|字段已存在/,
      );
    });
    it('目标表未导入 → TABLE_NOT_FOUND', async () => {
      await expect(
        svc.addField('nope', { name: 'age', jsonType: 'integer' }),
      ).rejects.toThrow(Errors.tableNotFound('nope'));
    });
  });

  describe('refresh', () => {
    it('业务库演进后元数据同步', async () => {
      dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)');
      await svc.importExisting('t');
      dbs.businessRaw.exec('ALTER TABLE t ADD COLUMN b TEXT');
      const after = await svc.refresh('t');
      expect(after.fields.map((f) => f.name)).toEqual(['id', 'a', 'b']);
    });
  });
});
