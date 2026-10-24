import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { SYSTEM_DB_MIGRATIONS } from '../system-db.js';
import { MetadataStore } from '../metadata.js';
import { DynamicSql } from '../dynamic-sql.js';
import { DataService } from '../data-service.js';
import { SchemaService } from '../schema-service.js';

describe('DataService 写入校验（真实 SQLite）', () => {
  let dbs: TestDbs;
  let data: DataService;
  let schema: SchemaService;
  const valid = { title: 'ok', amount: 7 };

  beforeEach(async () => {
    dbs = await createTestDbs();
    for (const migration of SYSTEM_DB_MIGRATIONS) dbs.systemRaw.exec(migration);
    const store = new MetadataStore(dbs.systemDb, dbs.businessRaw);
    data = new DataService(store, new DynamicSql(dbs.businessDb));
    schema = new SchemaService(dbs.businessRaw, store);
    await schema.createModel({
      name: 'items', label: 'items', autoTimestamps: true,
      fields: [
        { name: 'title', jsonType: 'string', nullable: false },
        { name: 'amount', jsonType: 'integer', nullable: false },
        { name: 'price', jsonType: 'number', nullable: false, defaultValue: 1.5 },
        { name: 'state', jsonType: 'string', nullable: false, enumValues: ['draft', 'done'], defaultValue: 'draft' },
        { name: 'enabled', jsonType: 'boolean', nullable: false, defaultValue: false },
        { name: 'optional_count', jsonType: 'integer', nullable: true },
        { name: 'optional_enabled', jsonType: 'boolean', nullable: true },
        { name: 'due_at', jsonType: 'datetime', nullable: true },
        { name: 'locked', jsonType: 'string', isReadonly: true, defaultValue: 'database' },
        { name: 'locked_count', jsonType: 'integer', isReadonly: true, defaultValue: 5 },
      ],
    });
  });

  afterEach(async () => {
    await dbs.cleanup();
  });

  it.each([
    ['amount', 'not-a-number'], ['amount', 1.5], ['amount', true], ['amount', ''],
    ['amount', '  '], ['amount', []], ['amount', null], ['price', {}], ['price', Infinity],
    ['state', 'not-in-enum'], ['state', null], ['enabled', 'yes'], ['enabled', null],
    ['due_at', 'not-a-date'], ['title', null], ['title', 123],
  ])('create/update 拒绝字段 %s 的非法值 %j，且不落库', async (field, value) => {
    const expected = { code: 'VALIDATION_FAIL', message: expect.stringContaining(field as string) };
    await expect(data.create('items', { ...valid, [field as string]: value })).rejects.toMatchObject(expected);
    expect((await data.list('items')).total).toBe(0);

    const row = await data.create('items', valid);
    const before = dbs.businessRaw.prepare('SELECT * FROM items WHERE id = ?').get(row.id);
    await expect(data.update('items', row.id, { [field as string]: value })).rejects.toMatchObject(expected);
    expect(dbs.businessRaw.prepare('SELECT * FROM items WHERE id = ?').get(row.id)).toEqual(before);
  });

  it.each([false, true])('未知字段在 internal:%s 时也拒绝', async (internal) => {
    const expected = { code: 'VALIDATION_FAIL', message: expect.stringContaining('unknown') };
    await expect(data.create('items', { ...valid, unknown: 1 }, { internal })).rejects.toMatchObject(expected);
    const row = await data.create('items', valid);
    await expect(data.update('items', row.id, { unknown: 1 }, { internal })).rejects.toMatchObject(expected);
    expect((await data.get('items', row.id))?.amount).toBe(7);
  });

  it.each(['title', 'amount'])('create 缺失必填 %s 返回字段错误', async (field) => {
    const payload: Record<string, unknown> = { ...valid };
    delete payload[field];
    await expect(data.create('items', payload)).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining(field),
    });
  });

  it('数值字符串转换、默认值与补丁更新；输入对象保持原样', async () => {
    const payload = Object.freeze({ title: 'ok', amount: '42', price: '3.14' });
    const row = await data.create('items', payload);
    expect(row).toMatchObject({ amount: 42, price: 3.14, state: 'draft', enabled: false, optional_count: null });
    expect(payload).toEqual({ title: 'ok', amount: '42', price: '3.14' });
    const patch = Object.freeze({ amount: '43' });
    await data.update('items', row.id, patch);
    expect(await data.get('items', row.id)).toMatchObject({ title: 'ok', amount: 43 });
    expect(patch).toEqual({ amount: '43' });
    await data.update('items', row.id, {});
  });

  it.each([true, false, 1, 0, 'true', 'false', '1', '0'])('布尔输入 %j 写为 0/1，create/get/list 返回 boolean', async (input) => {
    const enabled = input === true || input === 1 || input === 'true' || input === '1';
    const row = await data.create('items', { ...valid, enabled: input });
    expect(row.enabled).toBe(enabled);
    expect(dbs.businessRaw.prepare('SELECT enabled FROM items WHERE id = ?').get(row.id)).toEqual({ enabled: enabled ? 1 : 0 });
    expect((await data.get('items', row.id))?.enabled).toBe(enabled);
    expect((await data.list('items')).rows[0]?.enabled).toBe(enabled);
    await data.update('items', row.id, { enabled: !enabled });
    expect((await data.get('items', row.id))?.enabled).toBe(!enabled);
  });

  it('nullable 数字、布尔、日期保留 null；ISO 日期可写入', async () => {
    const row = await data.create('items', { ...valid, optional_count: null, optional_enabled: null, due_at: '2026-10-23T00:00:00Z' });
    expect(row).toMatchObject({ optional_count: null, optional_enabled: null, due_at: '2026-10-23T00:00:00.000Z' });
    await data.update('items', row.id, { optional_count: '12', optional_enabled: 'false', due_at: null });
    expect(await data.get('items', row.id)).toMatchObject({ optional_count: 12, optional_enabled: false, due_at: null });
    await data.update('items', row.id, { optional_count: null, optional_enabled: null });
    expect((await data.list('items')).rows[0]).toMatchObject({ optional_count: null, optional_enabled: null });
  });

  it('导入或旧数据中的非法 boolean 原值可读取，null 仍保留', async () => {
    const inserted = dbs.businessRaw.prepare('INSERT INTO items (title, amount, enabled) VALUES (?, ?, ?)').run('legacy', 7, 2);
    expect(await data.get('items', Number(inserted.lastInsertRowid))).toMatchObject({ enabled: 2, optional_enabled: null });
    expect((await data.list('items')).rows[0]).toMatchObject({ enabled: 2, optional_enabled: null });
    await expect(data.create('items', { ...valid, enabled: 2 })).rejects.toMatchObject({ code: 'VALIDATION_FAIL' });
  });

  it('系统时间戳和只读输入不能覆盖引擎或数据库值，且不修改调用方对象', async () => {
    const payload = Object.freeze({ ...valid, locked: 'override', locked_count: 99, created_at: -1, updated_at: -2 });
    const before = Date.now();
    const row = await data.create('items', payload);
    expect(row).toMatchObject({ locked: 'database', locked_count: 5 });
    expect(row.created_at).toBeGreaterThanOrEqual(before);
    expect(row.updated_at).toBe(row.created_at);
    expect(payload.created_at).toBe(-1);
    const patch = Object.freeze({ id: 999, locked: 123, created_at: 'invalid', updated_at: 'invalid', title: 'changed' });
    await data.update('items', row.id, patch, { internal: true });
    const updated = await data.get('items', row.id);
    expect(updated).toMatchObject({ id: row.id, locked: 'database', created_at: row.created_at, title: 'changed' });
    expect(updated?.updated_at).toBeGreaterThanOrEqual(Number(row.updated_at));
    expect(patch.updated_at).toBe('invalid');
  });

  it('create 接受显式可写主键；update 忽略主键', async () => {
    const numeric = await data.create('items', { ...valid, id: '42' });
    expect(numeric.id).toBe(42);
    await schema.createModel({ name: 'keyed', label: 'keyed', fields: [{ name: 'code', jsonType: 'string', isPrimary: true }] });
    const row = await data.create('keyed', { code: 'custom' });
    expect(row.code).toBe('custom');
    await data.update('keyed', 'custom', { code: 'changed' });
    expect(await data.get('keyed', 'custom')).toMatchObject({ code: 'custom' });
    expect(await data.get('keyed', 'changed')).toBeUndefined();
  });

  it.each([undefined, null])('反射为 nullable 的文本主键也必须提供非 null 值：%j', async (code) => {
    const meta = await schema.createModel({ name: 'keyed', label: 'keyed', fields: [{ name: 'code', jsonType: 'string', isPrimary: true }] });
    expect(meta.fields[0]?.nullable).toBe(true);
    await expect(data.create('keyed', code === undefined ? {} : { code })).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining('code'),
    });
    expect((await data.list('keyed')).total).toBe(0);
  });

  it.each(['create', 'update'] as const)('导入表 __proto__ 列作为普通数据属性 %s', async (mode) => {
    dbs.businessRaw.exec('CREATE TABLE prototypes (id INTEGER PRIMARY KEY, "__proto__" TEXT NOT NULL)');
    await schema.importExisting('prototypes');
    const payload = Object.fromEntries([['__proto__', 'saved']]);
    if (mode === 'create') {
      expect((await data.create('prototypes', payload))['__proto__']).toBe('saved');
    } else {
      dbs.businessRaw.prepare('INSERT INTO prototypes ("__proto__") VALUES (?)').run('original');
      await data.update('prototypes', 1, payload);
      expect((await data.get('prototypes', 1))?.['__proto__']).toBe('saved');
    }
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    expect(payload['__proto__']).toBe('saved');
  });

  it('空输入支持 DEFAULT VALUES、只有自动主键或只有时间戳的表', async () => {
    await schema.createModel({ name: 'defaults', label: 'defaults', fields: [{ name: 'enabled', jsonType: 'boolean', nullable: false, defaultValue: true }] });
    expect(await data.create('defaults', Object.freeze({}))).toMatchObject({ id: 1, enabled: true });
    await schema.createModel({ name: 'empty', label: 'empty', fields: [] });
    expect(await data.create('empty', {})).toEqual({ id: 1 });
    await schema.createModel({ name: 'timestamps', label: 'timestamps', fields: [], autoTimestamps: true });
    const row = await data.create('timestamps', Object.freeze({}));
    expect(row.id).toBe(1);
    expect(row.created_at).toBeGreaterThan(0);
    expect(row.updated_at).toBe(row.created_at);
  });

  it('导入表的数值 SQL 默认表达式由 SQLite 计算，省略字段可创建', async () => {
    dbs.businessRaw.exec(`CREATE TABLE imported_defaults (
      id INTEGER PRIMARY KEY,
      amount INTEGER NOT NULL DEFAULT (abs(-5)),
      price REAL NOT NULL DEFAULT (1.5 + 2.5)
    )`);
    await schema.importExisting('imported_defaults');
    expect(await data.create('imported_defaults', {})).toEqual({ id: 1, amount: 5, price: 4 });
  });

  it('非自增主键的 SQL 默认表达式生成可回查的主键，显式 null 仍拒绝', async () => {
    dbs.businessRaw.exec(`CREATE TABLE generated_keys (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16))))
    )`);
    const meta = await schema.importExisting('generated_keys');
    expect(meta.fields[0]).toMatchObject({ isPrimary: true, isAutoIncrement: false, nullable: true });
    const first = await data.create('generated_keys', {});
    const second = await data.create('generated_keys', {});
    expect(first.id).toMatch(/^[a-f0-9]{32}$/);
    expect(second.id).toMatch(/^[a-f0-9]{32}$/);
    expect(first.id).not.toBe(second.id);
    expect(await data.get('generated_keys', first.id)).toEqual(first);
    await expect(data.create('generated_keys', { id: null })).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining('id'),
    });
    expect((await data.list('generated_keys')).total).toBe(2);
  });

  it.each(['INTEGER', 'REAL', 'TEXT'])('NOT NULL DEFAULT NULL 的 %s 字段仍须显式提供值', async (type) => {
    dbs.businessRaw.exec(`CREATE TABLE null_default (id INTEGER PRIMARY KEY, value ${type} NOT NULL DEFAULT NULL)`);
    const meta = await schema.importExisting('null_default');
    expect(meta.fields.find((field) => field.name === 'value')?.defaultValue).toBeNull();
    await expect(data.create('null_default', {})).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining('value'),
    });
    expect((await data.list('null_default')).total).toBe(0);
  });

  it.each(['((NULL))', '((( null )))'])('括号 NULL 默认值 %s 仍要求提供非空文本主键', async (defaultSql) => {
    dbs.businessRaw.exec(`CREATE TABLE null_keys (id TEXT PRIMARY KEY DEFAULT ${defaultSql})`);
    const meta = await schema.importExisting('null_keys');
    expect(meta.fields[0]?.defaultValue).toBeNull();
    await expect(data.create('null_keys', {})).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining('id'),
    });
    expect((await data.list('null_keys')).total).toBe(0);
  });

  it.each(['INTEGER', 'REAL', 'TEXT'])('NOT NULL 的 %s 字段不能省略括号 NULL 默认值', async (type) => {
    dbs.businessRaw.exec(`CREATE TABLE null_columns (id INTEGER PRIMARY KEY, value ${type} NOT NULL DEFAULT (((NULL))))`);
    const meta = await schema.importExisting('null_columns');
    expect(meta.fields.find((field) => field.name === 'value')?.defaultValue).toBeNull();
    await expect(data.create('null_columns', {})).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining('value'),
    });
    expect((await data.list('null_columns')).total).toBe(0);
  });

  it('默认表达式生成 null 主键时拒绝并回滚插入及触发器，已有行保留', async () => {
    dbs.businessRaw.exec(`
      CREATE TABLE null_expression_keys (id TEXT PRIMARY KEY DEFAULT (lower(NULL)));
      INSERT INTO null_expression_keys (id) VALUES ('existing');
      CREATE TABLE insert_audit (id INTEGER PRIMARY KEY, item_id TEXT);
      CREATE TRIGGER audit_null_keys AFTER INSERT ON null_expression_keys BEGIN
        INSERT INTO insert_audit (item_id) VALUES (NEW.id);
      END;
    `);
    await schema.importExisting('null_expression_keys');
    await expect(data.create('null_expression_keys', {})).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining('id'),
    });
    expect((await data.list('null_expression_keys')).rows).toEqual([{ id: 'existing' }]);
    expect(dbs.businessRaw.prepare('SELECT * FROM insert_audit').all()).toEqual([]);
    expect(await data.create('null_expression_keys', { id: 'valid' })).toEqual({ id: 'valid' });
    expect(dbs.businessRaw.prepare('SELECT item_id FROM insert_audit').all()).toEqual([{ item_id: 'valid' }]);
  });

  it('INSERT 未返回主键时回滚，不用 last_insert_rowid 返回上一行', async () => {
    dbs.businessRaw.exec(`
      CREATE TABLE ignored_keys (id INTEGER PRIMARY KEY, value TEXT);
      INSERT INTO ignored_keys (id, value) VALUES (1, 'existing');
      CREATE TABLE ignored_audit (id INTEGER PRIMARY KEY);
      CREATE TRIGGER ignore_insert BEFORE INSERT ON ignored_keys BEGIN
        INSERT INTO ignored_audit (id) VALUES (NULL);
        SELECT RAISE(IGNORE);
      END;
    `);
    await schema.importExisting('ignored_keys');
    await expect(data.create('ignored_keys', { value: 'new' })).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining('id'),
    });
    expect((await data.list('ignored_keys')).rows).toEqual([{ id: 1, value: 'existing' }]);
    expect(dbs.businessRaw.prepare('SELECT * FROM ignored_audit').all()).toEqual([]);
  });

  it('BLOB 输入返回字段校验错误', async () => {
    dbs.businessRaw.exec('CREATE TABLE blobs (id INTEGER PRIMARY KEY, payload BLOB)');
    await schema.importExisting('blobs');
    await expect(data.create('blobs', { payload: 'text' })).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining('payload'),
    });
    await dbs.businessRaw.prepare('INSERT INTO blobs DEFAULT VALUES').run();
    await expect(data.update('blobs', 1, { payload: Buffer.from('bytes') })).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining('payload'),
    });
  });

  it.each([NaN, Infinity, -Infinity, 1.5])('integer incr 拒绝增量 %j 且不修改记录', async (n) => {
    const row = await data.create('items', valid);
    await expect(data.incr('items', row.id, 'amount', n)).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining('amount'),
    });
    expect((await data.get('items', row.id))?.amount).toBe(7);
  });

  it.each(['id', 'created_at', 'updated_at', 'locked_count', 'enabled', 'unknown'])('incr 拒绝字段 %s', async (field) => {
    const row = await data.create('items', valid);
    await expect(data.incr('items', row.id, field, 1, { internal: true })).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', message: expect.stringContaining(field),
    });
  });

  it('number incr 支持小数，整数自增保持原子 SQL', async () => {
    const row = await data.create('items', valid);
    await data.incr('items', row.id, 'price', 0.25);
    await expect(data.incr('items', row.id, 'price', Infinity)).rejects.toMatchObject({ code: 'VALIDATION_FAIL' });
    await Promise.all(Array.from({ length: 10 }, () => data.incr('items', row.id, 'amount', 1)));
    expect(await data.get('items', row.id)).toMatchObject({ price: 1.75, amount: 17 });
  });
});
