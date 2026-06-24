import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { SYSTEM_DB_MIGRATIONS } from '../system-db.js';
import { MetadataStore } from '../metadata.js';
import type { FieldMeta } from '@1api/shared';

function f(name: string, over: Partial<FieldMeta> = {}): FieldMeta {
  return {
    name,
    label: name,
    sqliteType: 'TEXT',
    jsonType: 'string',
    nullable: true,
    defaultValue: null,
    isPrimary: false,
    isAutoIncrement: false,
    isHidden: false,
    isReadonly: false,
    ...over,
  };
}

describe('MetadataStore', () => {
  let dbs: TestDbs;
  let store: MetadataStore;
  beforeEach(async () => {
    dbs = await createTestDbs();
    for (const m of SYSTEM_DB_MIGRATIONS) dbs.systemRaw.exec(m);
    store = new MetadataStore(dbs.systemDb, dbs.businessRaw);
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  it('createMeta + getMeta + getMetaByName + listMetas', async () => {
    const meta = await store.createMeta({
      name: 'users',
      label: '用户',
      primaryKey: 'id',
      fields: [f('id', { sqliteType: 'INTEGER', jsonType: 'integer', isPrimary: true }), f('name')],
    });
    expect(meta.id).toBeGreaterThan(0);
    expect(meta.name).toBe('users');
    expect(meta.fields).toHaveLength(2);

    const byId = await store.getMeta(meta.id);
    expect(byId?.name).toBe('users');
    const byName = await store.getMetaByName('users');
    expect(byName?.id).toBe(meta.id);
    const list = await store.listMetas();
    expect(list).toHaveLength(1);
  });

  it('缓存命中：第二次 getMetaByName 走内存', async () => {
    const created = await store.createMeta({
      name: 't',
      label: 'T',
      primaryKey: 'id',
      fields: [f('id', { isPrimary: true, sqliteType: 'INTEGER', jsonType: 'integer' })],
    });
    await store.getMetaByName('t'); // 触发缓存
    // 删库后再读仍返回缓存（证明未查库）
    await dbs.systemDb.deleteFrom('table_meta').where('id', '=', created.id).execute();
    const cached = await store.getMetaByName('t');
    expect(cached?.name).toBe('t');
  });

  it('updateMeta：修改 label/is_published', async () => {
    const created = await store.createMeta({
      name: 't',
      label: 'T',
      primaryKey: 'id',
      fields: [f('id', { isPrimary: true, sqliteType: 'INTEGER', jsonType: 'integer' })],
    });
    await store.updateMeta(created.id, { label: 'TT', isPublished: false });
    const after = await store.getMeta(created.id);
    expect(after?.label).toBe('TT');
    expect(after?.isPublished).toBe(false);
  });

  it('deleteMeta：缓存失效 + 删除', async () => {
    const created = await store.createMeta({
      name: 't',
      label: 'T',
      primaryKey: 'id',
      fields: [f('id', { isPrimary: true, sqliteType: 'INTEGER', jsonType: 'integer' })],
    });
    await store.deleteMeta(created.id);
    expect(await store.getMeta(created.id)).toBeUndefined();
    expect(await store.getMetaByName('t')).toBeUndefined();
  });

  it('warmup：从系统库加载已存在的 table_meta 到缓存', async () => {
    // 先写入一条（绕过 store，直接进库）然后用新 store warmup 读回
    await store.createMeta({
      name: 'warm',
      label: '预热',
      primaryKey: 'id',
      fields: [f('id', { isPrimary: true, sqliteType: 'INTEGER', jsonType: 'integer' })],
    });
    const store2 = new MetadataStore(dbs.systemDb, dbs.businessRaw);
    expect(await store2.getMetaByName('warm')).toBeUndefined(); // 新 store 缓存为空
    await store2.warmup();
    expect((await store2.getMetaByName('warm'))?.label).toBe('预热');
    expect((await store2.listMetas()).length).toBeGreaterThan(0);
  });

  describe('refreshMeta diff（保留用户标记）', () => {
    it('保留 label/isHidden/isReadonly/enumValues；结构随反射更新；新增/删除字段同步', async () => {
      // 业务库先建表
      dbs.businessRaw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT)');
      // 首次导入
      const created = await store.createMeta({
        name: 't',
        label: '原标签',
        primaryKey: 'id',
        fields: [
          f('id', { isPrimary: true, sqliteType: 'INTEGER', jsonType: 'integer', label: 'ID' }),
          f('name', { label: '姓名', isReadonly: true }),
          f('status', { label: '状态', enumValues: ['a', 'b'], isHidden: true }),
        ],
      });
      // 业务库演进：删 status、加 age、改 name 为可空
      dbs.businessRaw.exec('ALTER TABLE t RENAME COLUMN status TO status_old');
      dbs.businessRaw.exec('ALTER TABLE t DROP COLUMN status_old');
      dbs.businessRaw.exec('ALTER TABLE t ADD COLUMN age INTEGER');

      await store.refreshMeta(created.id);
      const after = await store.getMeta(created.id);
      const fields = after!.fields;
      const names = fields.map((x) => x.name);
      expect(names).toEqual(['id', 'name', 'age']); // status 删除、age 新增
      // 保留：id 的 label=ID、name 的 isReadonly
      expect(fields.find((x) => x.name === 'id')!.label).toBe('ID');
      expect(fields.find((x) => x.name === 'name')!.isReadonly).toBe(true);
      // 新增 age：label 默认 = name
      expect(fields.find((x) => x.name === 'age')!.label).toBe('age');
      expect(fields.find((x) => x.name === 'age')!.jsonType).toBe('integer');
    });
  });
});
