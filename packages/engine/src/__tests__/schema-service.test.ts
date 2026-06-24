import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Errors } from '@1api/shared';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { SYSTEM_DB_MIGRATIONS } from '../system-db.js';
import { MetadataStore } from '../metadata.js';
import { SchemaService } from '../schema-service.js';

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
  });

  describe('addField', () => {
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
