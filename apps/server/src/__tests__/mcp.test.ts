import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { setupTest, seedBusinessTable } from './helpers.js';
import type { TestSetup } from './helpers.js';

let t: TestSetup;
beforeEach(async () => {
  t = await setupTest();
});
afterAll(async () => {
  await t.cleanup();
});

/** 用给定 token 连 MCP，返回 Client。调用方负责 close。 */
async function mcpClient(
  perms: { tables: string[]; actions: string[] },
  opts?: { isActive?: boolean; expiresAt?: number | null },
): Promise<Client> {
  const plain = await t.insertToken(perms, opts);
  const transport = new StreamableHTTPClientTransport(new URL(t.mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${plain}` } },
  });
  const client = new Client({ name: 'test', version: '1.0' });
  await client.connect(transport);
  return client;
}

/**
 * 调 tool 并解析首个 text content。
 * 成功时 text 是 JSON（tool handler 手写 JSON.stringify），data 为解析结果；
 * 失败时（isError=true）MCP SDK 把 AppError.message 作为纯文本放进 text，不可 JSON.parse，
 * 此时 data 退化为原始错误字符串。
 */
async function callToolJson(client: Client, name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
  const isError = res.isError === true;
  let data: unknown = text;
  if (!isError) {
    data = JSON.parse(text);
  }
  return { isError, data };
}

describe('MCP 数据 tools 端到端', () => {
  it('完整流程：create_table → describe → create → list → update → incr → add_field → delete', async () => {
    const client = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });

    // 1. create_table
    const created = await callToolJson(client, 'create_table', {
      name: 'posts',
      label: '文章',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'title', jsonType: 'string', nullable: false },
        { name: 'views', jsonType: 'integer', nullable: false, defaultValue: 0 },
      ],
    });
    expect(created.isError).toBe(false);
    expect(created.data.name).toBe('posts');

    // 2. describe_table
    const desc = await callToolJson(client, 'describe_table', { table: 'posts' });
    expect(desc.data.fields.map((f: { name: string }) => f.name)).toEqual(['id', 'title', 'views']);

    // 3. create_record
    const rec = await callToolJson(client, 'create_record', {
      table: 'posts',
      data: { title: 'hello' },
    });
    expect(rec.data.title).toBe('hello');
    expect(rec.data.views).toBe(0);

    // 4. list_records
    const list = await callToolJson(client, 'list_records', { table: 'posts' });
    expect(list.data.total).toBe(1);
    expect(list.data.rows[0].title).toBe('hello');

    // 5. update_record
    await callToolJson(client, 'update_record', { table: 'posts', pk: 1, data: { title: 'hi' } });
    const got = await callToolJson(client, 'get_record', { table: 'posts', pk: 1 });
    expect(got.data.title).toBe('hi');

    // 6. increment_field
    await callToolJson(client, 'increment_field', { table: 'posts', pk: 1, field: 'views', count: 5 });
    const got2 = await callToolJson(client, 'get_record', { table: 'posts', pk: 1 });
    expect(got2.data.views).toBe(5);

    // 7. add_field
    await callToolJson(client, 'add_field', {
      table: 'posts',
      field: { name: 'status', jsonType: 'string', nullable: true },
    });
    const desc2 = await callToolJson(client, 'describe_table', { table: 'posts' });
    expect(desc2.data.fields.map((f: { name: string }) => f.name)).toContain('status');

    // 8. delete_record
    await callToolJson(client, 'delete_record', { table: 'posts', pk: 1 });
    const list2 = await callToolJson(client, 'list_records', { table: 'posts' });
    expect(list2.data.total).toBe(0);

    await client.close();
  });

  it('list 支持分页/排序/过滤/q', async () => {
    const client = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    await callToolJson(client, 'create_table', {
      name: 'items', label: '项',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'name', jsonType: 'string', nullable: false },
        { name: 'qty', jsonType: 'integer', nullable: false, defaultValue: 0 },
      ],
    });
    for (const name of ['apple', 'banana', 'cherry']) {
      await callToolJson(client, 'create_record', { table: 'items', data: { name, qty: 10 } });
    }
    // 排序
    const sorted = await callToolJson(client, 'list_records', { table: 'items', order: 'name:desc' });
    expect(sorted.data.rows.map((r: { name: string }) => r.name)).toEqual(['cherry', 'banana', 'apple']);
    // q 搜索
    const searched = await callToolJson(client, 'list_records', { table: 'items', q: 'an' });
    expect(searched.data.total).toBe(1);
    expect(searched.data.rows[0].name).toBe('banana');
    // 过滤
    const filtered = await callToolJson(client, 'list_records', {
      table: 'items', filters: { name: ['eq', 'apple'] },
    });
    expect(filtered.data.total).toBe(1);
    await client.close();
  });

  it('get_record 主键不存在 → isError', async () => {
    const client = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    await callToolJson(client, 'create_table', {
      name: 'miss', label: 'm',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false }],
    });
    const r = await callToolJson(client, 'get_record', { table: 'miss', pk: 999 });
    expect(r.isError).toBe(true);
    await client.close();
  });

  it('increment_field 不传 count → 默认 +1', async () => {
    const client = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    await callToolJson(client, 'create_table', {
      name: 'cnt', label: 'c',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'n', jsonType: 'integer', nullable: false, defaultValue: 0 },
      ],
    });
    const rec = await callToolJson(client, 'create_record', { table: 'cnt', data: { n: 5 } });
    // 不传 count → 默认 +1
    await callToolJson(client, 'increment_field', { table: 'cnt', pk: rec.data.id, field: 'n' });
    const got = await callToolJson(client, 'get_record', { table: 'cnt', pk: rec.data.id });
    expect(got.data.n).toBe(6);
    await client.close();
  });

  it('list_records 显式 page/size 分页', async () => {
    const client = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    await callToolJson(client, 'create_table', {
      name: 'paged', label: 'p',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'v', jsonType: 'string', nullable: true },
      ],
    });
    for (let i = 0; i < 5; i++) {
      await callToolJson(client, 'create_record', { table: 'paged', data: { v: `r${i}` } });
    }
    const page1 = await callToolJson(client, 'list_records', { table: 'paged', page: 1, size: 2 });
    expect(page1.data.rows).toHaveLength(2);
    expect(page1.data.total).toBe(5);
    expect(page1.data.page).toBe(1);
    expect(page1.data.size).toBe(2);
    const page2 = await callToolJson(client, 'list_records', { table: 'paged', page: 2, size: 2 });
    expect(page2.data.rows).toHaveLength(2);
    expect(page2.data.page).toBe(2);
    await client.close();
  });
});

describe('MCP 权限边界', () => {
  it('无 token → 拒绝（connect 失败）', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(t.mcpUrl));
    const client = new Client({ name: 't', version: '1' });
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it('无效 token → 拒绝', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(t.mcpUrl), {
      requestInit: { headers: { Authorization: 'Bearer oa_invalid_xxx' } },
    });
    const client = new Client({ name: 't', version: '1' });
    await expect(client.connect(transport)).rejects.toThrow();
  });

  it('token 无 write action → create/update/delete/incr 拒绝', async () => {
    // 先用全权 token 建表+建记录
    const setup = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    await callToolJson(setup, 'create_table', {
      name: 'sec', label: 's',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'n', jsonType: 'string', nullable: true },
      ],
    });
    await callToolJson(setup, 'create_record', { table: 'sec', data: { n: 'a' } });
    await setup.close();

    // 只读 token
    const ro = await mcpClient({ tables: ['*'], actions: ['read'] });
    const r = await callToolJson(ro, 'create_record', { table: 'sec', data: { n: 'b' } });
    expect(r.isError).toBe(true);
    await ro.close();
  });

  it('token 无 schema action → create_table/add_field 拒绝', async () => {
    const rw = await mcpClient({ tables: ['*'], actions: ['read', 'write'] });
    const r = await callToolJson(rw, 'create_table', {
      name: 'nope', label: 'n',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, nullable: false }],
    });
    expect(r.isError).toBe(true);
    await rw.close();
  });

  it('tables 白名单外 → 拒绝', async () => {
    const setup = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    await callToolJson(setup, 'create_table', {
      name: 'allowed', label: 'a',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, nullable: false }],
    });
    await callToolJson(setup, 'create_table', {
      name: 'denied', label: 'd',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, nullable: false }],
    });
    await setup.close();

    // 只允许 allowed 表
    const limited = await mcpClient({ tables: ['allowed'], actions: ['read'] });
    const ok = await callToolJson(limited, 'describe_table', { table: 'allowed' });
    expect(ok.isError).toBe(false);
    const denied = await callToolJson(limited, 'describe_table', { table: 'denied' });
    expect(denied.isError).toBe(true);
    await limited.close();
  });

  it('未发布表 → describe/list 返回错误（404）', async () => {
    // 直接在业务库建表 + 用 admin 通道注册为未发布（is_published=false）
    await seedBusinessTable(
      t.businessDbPath,
      'CREATE TABLE unpublish (id INTEGER PRIMARY KEY, v TEXT)',
    );
    const admin = await t.adminSession();
    // testUnwrapper 已拆出内层 data，success() 直接返回 meta（含 id）
    const importRes = (await admin
      .post('/admin/tables/import')
      .input({ name: 'unpublish' })
      .success()) as { id: number };
    const tableId = importRes.id;
    // 改为未发布
    await admin.put(`/admin/tables/${tableId}`).input({ isPublished: false }).success();

    const client = await mcpClient({ tables: ['*'], actions: ['read'] });
    const r = await callToolJson(client, 'describe_table', { table: 'unpublish' });
    expect(r.isError).toBe(true);
    const r2 = await callToolJson(client, 'list_records', { table: 'unpublish' });
    expect(r2.isError).toBe(true);
    await client.close();
  });

  it('失效 token（is_active=0）→ connect 拒绝', async () => {
    await expect(mcpClient({ tables: ['*'], actions: ['read'] }, { isActive: false })).rejects.toThrow();
  });

  it('过期 token → connect 拒绝', async () => {
    await expect(
      mcpClient({ tables: ['*'], actions: ['read'] }, { expiresAt: Date.now() - 1000 }),
    ).rejects.toThrow();
  });

  it('create_table 保留表名（schema/records/incr）→ 拒绝', async () => {
    const client = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    for (const reserved of ['schema', 'records', 'incr']) {
      const r = await callToolJson(client, 'create_table', {
        name: reserved, label: 'x',
        fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, nullable: false }],
      });
      expect(r.isError).toBe(true);
    }
    await client.close();
  });

  it('create_table 带 note + autoTimestamps → 成功且挂载时间戳字段', async () => {
    const client = await mcpClient({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const r = await callToolJson(client, 'create_table', {
      name: 'withmeta', label: '带元信息',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false }],
      note: '测试备注',
      autoTimestamps: true,
    });
    expect(r.isError).toBe(false);
    expect(r.data.note).toBe('测试备注');
    // autoTimestamps → createTable 增 created_at/updated_at 列，反射读回进入 fields
    const fieldNames = r.data.fields.map((f: { name: string }) => f.name);
    expect(fieldNames).toContain('created_at');
    expect(fieldNames).toContain('updated_at');
    await client.close();
  });
});
