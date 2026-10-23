import { describe, it, expect, beforeEach, afterAll } from 'vitest';
// 跨包 import server 的测试夹具（dev 依赖，仅测试用）；alias 映射 @1api/server → apps/server/src。
// 注意：测试夹具 setupTest() 在 leizm/web app 根路径 bind erest（与生产 /api 子挂载不同），
// 故 data 组路由实际暴露在 /data/*（非 /api/data/*）。
import { setupTest } from '@1api/server/__tests__/helpers.js';
import type { TestSetup } from '@1api/server/__tests__/helpers.js';
import { createClient } from '../client.js';

let t: TestSetup;
let baseUrl: string;

beforeEach(async () => {
  t = await setupTest();
  // 夹具在根路径挂载 erest，data 组前缀为 /data；用 origin + /data 得到 data 通道 base。
  baseUrl = `${new URL(t.mcpUrl).origin}/data`;
  // 建一张已发布可编辑的表（用全权 token 走 schema.createTable）
  const adminToken = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
  const c = createClient(baseUrl, adminToken);
  await c.schema.createTable({
    name: 'posts',
    label: '文章',
    fields: [
      { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
      { name: 'title', jsonType: 'string', nullable: false },
      { name: 'views', jsonType: 'integer', nullable: false, defaultValue: 0 },
    ],
  });
});

afterAll(async () => {
  await t.cleanup();
});

describe('SDK 集成（真实 server）', () => {
  it('引擎无效写入通过真实 HTTP 返回 VALIDATION_FAIL，记录保持不变', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const c = createClient(baseUrl, token);
    await c.schema.createTable({
      name: 'validated',
      label: 'validated',
      fields: [
        { name: 'amount', jsonType: 'integer', nullable: false },
        { name: 'state', jsonType: 'string', enumValues: ['draft', 'done'], defaultValue: 'draft' },
        { name: 'enabled', jsonType: 'boolean', defaultValue: false },
      ],
    });
    for (const payload of [
      { amount: 'invalid' },
      { amount: 1, state: 'invalid' },
      { amount: 1, enabled: 'yes' },
      { amount: null },
      { amount: 1, unknown: 1 },
      {},
    ]) {
      await expect(c.create('validated', payload)).rejects.toMatchObject({
        code: 'VALIDATION_FAIL', statusCode: 400,
      });
    }
    expect((await c.list('validated')).total).toBe(0);
    const row = await c.create('validated', { amount: '42', enabled: 'false' });
    expect(row).toMatchObject({ amount: 42, enabled: false });
    await expect(c.update('validated', row.id, { state: 'invalid' })).rejects.toMatchObject({
      code: 'VALIDATION_FAIL', statusCode: 400,
    });
    expect(await c.get('validated', row.id)).toMatchObject({ amount: 42, state: 'draft', enabled: false });
  });

  it('完整 CRUD 流程', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write'] });
    const c = createClient(baseUrl, token);

    // create
    const row = await c.create('posts', { title: 'hello' });
    expect(row.title).toBe('hello');
    expect(row.views).toBe(0);

    // get
    const got = await c.get('posts', (row as { id: number }).id);
    expect(got.title).toBe('hello');

    // list
    const list = await c.list('posts');
    expect(list.total).toBe(1);

    // update
    await c.update('posts', (row as { id: number }).id, { title: 'hi' });
    expect((await c.get('posts', (row as { id: number }).id)).title).toBe('hi');

    // incr
    await c.incr('posts', (row as { id: number }).id, 'views', 5);
    expect((await c.get('posts', (row as { id: number }).id)).views).toBe(5);

    // delete
    await c.delete('posts', (row as { id: number }).id);
    const after = await c.list('posts');
    expect(after.total).toBe(0);
  });

  it('list 支持分页/排序/过滤/q', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write'] });
    const c = createClient(baseUrl, token);
    for (const name of ['apple', 'banana', 'cherry']) {
      await c.create('posts', { title: name });
    }
    // 排序
    const sorted = await c.list('posts', { order: 'title:desc' });
    expect(sorted.rows.map((r) => r.title)).toEqual(['cherry', 'banana', 'apple']);
    // 过滤
    const filtered = await c.list('posts', { filters: { title: ['eq', 'apple'] } });
    expect(filtered.total).toBe(1);
    // q
    const searched = await c.list('posts', { q: 'an' });
    expect(searched.total).toBe(1);
    expect(searched.rows[0]!.title).toBe('banana');
  });

  it('describe 返回 TableMeta', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read'] });
    const meta = await createClient(baseUrl, token).describe('posts');
    expect(meta.name).toBe('posts');
    expect(meta.fields.map((f) => f.name)).toEqual(['id', 'title', 'views']);
  });

  it('无权限 token → create 抛 FORBIDDEN', async () => {
    const ro = await t.insertToken({ tables: ['*'], actions: ['read'] });
    await expect(createClient(baseUrl, ro).create('posts', { title: 'x' })).rejects.toMatchObject({
      name: 'OneApiError',
      code: 'FORBIDDEN',
    });
  });

  it('表不存在 → describe 抛 TABLE_NOT_FOUND', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read'] });
    await expect(createClient(baseUrl, token).describe('nope')).rejects.toMatchObject({
      code: 'TABLE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('无效 token → 抛 INVALID_TOKEN', async () => {
    const c = createClient(baseUrl, 'oa_invalid_xxx');
    await expect(c.describe('posts')).rejects.toMatchObject({ code: 'INVALID_TOKEN', statusCode: 401 });
  });

  it('schema.createTable / addField（schema 权限）', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'schema'] });
    const c = createClient(baseUrl, token);
    const meta = await c.schema.createTable({
      name: 'items',
      label: '项',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, nullable: false }],
    });
    expect(meta.name).toBe('items');
    const after = await c.schema.addField('items', { name: 'n', jsonType: 'string', nullable: true });
    expect(after.fields.map((f) => f.name)).toContain('n');
  });
});
