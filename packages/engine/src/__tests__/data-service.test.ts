import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Errors, type TableMeta } from '@1api/shared';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { SYSTEM_DB_MIGRATIONS } from '../system-db.js';
import { MetadataStore } from '../metadata.js';
import { DynamicSql } from '../dynamic-sql.js';
import { DataService } from '../data-service.js';

function meta(over: Partial<TableMeta> = {}): TableMeta {
  return {
    id: 1,
    name: 'posts',
    label: '文章',
    primaryKey: 'id',
    isPublished: true,
    isEditable: true,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    fields: [
      {
        name: 'id',
        label: 'ID',
        sqliteType: 'INTEGER',
        jsonType: 'integer',
        nullable: false,
        defaultValue: null,
        isPrimary: true,
        isAutoIncrement: true,
        isHidden: false,
        isReadonly: true,
      },
      {
        name: 'title',
        label: '标题',
        sqliteType: 'TEXT',
        jsonType: 'string',
        nullable: false,
        defaultValue: null,
        isPrimary: false,
        isAutoIncrement: false,
        isHidden: false,
        isReadonly: false,
      },
      {
        name: 'views',
        label: '浏览',
        sqliteType: 'INTEGER',
        jsonType: 'integer',
        nullable: false,
        defaultValue: 0,
        isPrimary: false,
        isAutoIncrement: false,
        isHidden: false,
        isReadonly: false,
      },
    ],
    ...over,
  };
}

describe('DataService', () => {
  let dbs: TestDbs;
  let svc: DataService;
  beforeEach(async () => {
    dbs = await createTestDbs();
    for (const m of SYSTEM_DB_MIGRATIONS) dbs.systemRaw.exec(m);
    dbs.businessRaw.exec(
      'CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0)',
    );
    dbs.businessRaw.prepare('INSERT INTO posts (title, views) VALUES (?, ?)').run('a', 1);
    const store = new MetadataStore(dbs.systemDb, dbs.businessRaw);
    const dyn = new DynamicSql(dbs.businessDb);
    svc = new DataService(store, dyn);
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  async function seedMeta(over: Partial<TableMeta> = {}) {
    const store = (svc as unknown as { store: MetadataStore }).store;
    return store.createMeta({
      name: 'posts',
      label: '文章',
      primaryKey: 'id',
      fields: meta(over).fields,
      isPublished: over.isPublished ?? true,
      isEditable: over.isEditable ?? true,
    });
  }

  describe('is_published / is_editable 约束', () => {
    it('list 未发布表（默认）→ TABLE_NOT_FOUND；internal:true → 放行', async () => {
      await seedMeta({ isPublished: false });
      await expect(svc.list('posts')).rejects.toThrow();
      const r = await svc.list('posts', {}, { internal: true });
      expect(r.total).toBe(1);
    });
    it('create 不可编辑表（默认）→ TABLE_NOT_EDITABLE；internal:true → 放行', async () => {
      await seedMeta({ isEditable: false });
      await expect(svc.create('posts', { title: 'x' })).rejects.toThrow(
        Errors.tableNotEditable('posts'),
      );
      const id = await svc.create('posts', { title: 'x' }, { internal: true });
      expect(id).toBeDefined();
    });
  });

  describe('incr 校验', () => {
    it('integer 字段自增 OK', async () => {
      await seedMeta();
      await svc.incr('posts', 1, 'views', 5);
      const row = await svc.get('posts', 1);
      expect(row?.views).toBe(6);
    });
    it('对 TEXT 字段自增 → VALIDATION_FAIL', async () => {
      await seedMeta();
      await expect(svc.incr('posts', 1, 'title', 1)).rejects.toThrow(/非数值类型/);
    });
  });

  describe('时间戳自动维护（engine 填 Date.now()）', () => {
    it('insert 时 created_at/updated_at 被填入；update 时 updated_at 刷新', async () => {
      // 用含时间戳的表
      dbs.businessRaw.exec(
        'CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, msg TEXT, created_at INTEGER, updated_at INTEGER)',
      );
      const store = (svc as unknown as { store: MetadataStore }).store;
      await store.createMeta({
        name: 'logs',
        label: '日志',
        primaryKey: 'id',
        fields: [
          {
            name: 'id',
            label: 'id',
            sqliteType: 'INTEGER',
            jsonType: 'integer',
            nullable: false,
            defaultValue: null,
            isPrimary: true,
            isAutoIncrement: true,
            isHidden: false,
            isReadonly: true,
          },
          {
            name: 'msg',
            label: 'msg',
            sqliteType: 'TEXT',
            jsonType: 'string',
            nullable: true,
            defaultValue: null,
            isPrimary: false,
            isAutoIncrement: false,
            isHidden: false,
            isReadonly: false,
          },
          {
            name: 'created_at',
            label: 'created_at',
            sqliteType: 'INTEGER',
            jsonType: 'datetime',
            nullable: true,
            defaultValue: null,
            isPrimary: false,
            isAutoIncrement: false,
            isHidden: false,
            isReadonly: true,
          },
          {
            name: 'updated_at',
            label: 'updated_at',
            sqliteType: 'INTEGER',
            jsonType: 'datetime',
            nullable: true,
            defaultValue: null,
            isPrimary: false,
            isAutoIncrement: false,
            isHidden: false,
            isReadonly: true,
          },
        ],
      });
      const before = Date.now();
      const row = await svc.create('logs', { msg: 'hi' }, { internal: true });
      const created = Number(row.created_at);
      const updated0 = Number(row.updated_at);
      expect(created).toBeGreaterThanOrEqual(before);
      expect(updated0).toBe(created);

      // 等 1ms 后 update，updated_at 应变大
      await new Promise((r) => setTimeout(r, 5));
      await svc.update('logs', row.id, { msg: 'hi2' }, { internal: true });
      const after = await svc.get('logs', row.id, { internal: true });
      expect(Number(after!.updated_at)).toBeGreaterThan(updated0);
      // created_at 不变
      expect(Number(after!.created_at)).toBe(created);
    });
  });

  describe('describe', () => {
    it('返回 TableMeta', async () => {
      await seedMeta();
      const m = await svc.describe('posts');
      expect(m.name).toBe('posts');
    });
    it('未知表 → TABLE_NOT_FOUND', async () => {
      await expect(svc.describe('nope')).rejects.toThrow(Errors.tableNotFound('nope'));
    });
  });
});
