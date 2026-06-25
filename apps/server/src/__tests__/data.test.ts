import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine, _resetEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { registerTableRoutes } from '../modules/table/router.js';
import { registerTokenRoutes } from '../modules/token/router.js';
import { registerDataRoutes } from '../modules/data/router.js';
import {
  startServer,
  loginAdmin,
  createModel,
  createToken,
  dataFetch,
  type TestServer,
} from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => {
  if (s) await s.close();
  s = null;
});

async function start() {
  _resetEngine();
  const dir = mkdtempSync(join(tmpdir(), '1api-data-'));
  const systemDbPath = join(dir, 'system.db');
  const businessDbPath = join(dir, 'business.db');
  const sys = await initSystemDb(systemDbPath);
  const engine = await initEngine({ businessDbPath, systemDbPath });
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerTableRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerTokenRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerDataRoutes(a, { systemDb: sys.db });
    },
  });
  s = await startServer({
    build: async () => ({
      app,
      close: async () => {
        await engine.destroy();
        await sys.close();
        rmSync(dir, { recursive: true, force: true });
      },
    }),
  });
  (s as TestServer).businessDbPath = businessDbPath;
  return s;
}

async function setupTable(baseURL: string) {
  const cookie = await loginAdmin(baseURL);
  await createModel(baseURL, cookie, {
    name: 'posts',
    label: '文章',
    fields: [
      { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true },
      { name: 'title', jsonType: 'string' },
      { name: 'views', jsonType: 'integer' },
    ],
  });
  const token = await createToken(baseURL, cookie, {
    name: 't',
    permissions: { tables: ['*'], actions: ['read', 'write'] },
  });
  return { cookie, token };
}

describe('对外 data /api/data/:table（Token 鉴权）', () => {
  it('无 token → 401 INVALID_TOKEN', async () => {
    const { baseURL } = await start();
    const res = await fetch(baseURL + '/api/data/posts');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_TOKEN');
  });

  it('CRUD 全流程', async () => {
    const { baseURL } = await start();
    const { token } = await setupTable(baseURL);
    // create（views 初始 0，便于 incr 验证；SQLite NULL+n=NULL）
    const c = await dataFetch(baseURL, token, '/api/data/posts/records', {
      method: 'POST',
      body: JSON.stringify({ title: 'hello', views: 0 }),
    });
    const cb = (await c.json()) as { data: { id: number; title: string } };
    expect(cb.data.title).toBe('hello');
    // list
    const l = await dataFetch(baseURL, token, '/api/data/posts');
    expect(((await l.json()) as { data: { total: number } }).data.total).toBe(1);
    // get
    const g = await dataFetch(baseURL, token, `/api/data/posts/records/${cb.data.id}`);
    expect(((await g.json()) as { data: { title: string } }).data.title).toBe('hello');
    // update
    await dataFetch(baseURL, token, `/api/data/posts/records/${cb.data.id}`, {
      method: 'PUT',
      body: JSON.stringify({ title: 'world' }),
    });
    // incr
    await dataFetch(baseURL, token, '/api/data/posts/incr', {
      method: 'POST',
      body: JSON.stringify({ pk: cb.data.id, field: 'views', count: 3 }),
    });
    const g2 = await dataFetch(baseURL, token, `/api/data/posts/records/${cb.data.id}`);
    expect(((await g2.json()) as { data: { views: number } }).data.views).toBe(3);
    // delete
    await dataFetch(baseURL, token, `/api/data/posts/records/${cb.data.id}`, { method: 'DELETE' });
    const l2 = await dataFetch(baseURL, token, '/api/data/posts');
    expect(((await l2.json()) as { data: { total: number } }).data.total).toBe(0);
  });

  it('schema 端点（表结构）', async () => {
    const { baseURL } = await start();
    const { token } = await setupTable(baseURL);
    const res = await dataFetch(baseURL, token, '/api/data/posts/schema');
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe('posts');
  });

  it('未发布表 → 404', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const meta = await createModel(baseURL, cookie, {
      name: 'secret',
      label: 's',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }],
    });
    await fetch(baseURL + `/api/admin/tables/${meta.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ isPublished: false }),
    });
    const token = await createToken(baseURL, cookie, {
      name: 't',
      permissions: { tables: ['*'], actions: ['read'] },
    });
    const res = await dataFetch(baseURL, token, '/api/data/secret');
    expect(res.status).toBe(404);
  });

  it('不可编辑表写操作 → 403', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const meta = await createModel(baseURL, cookie, {
      name: 'ro',
      label: 'ro',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }],
    });
    await fetch(baseURL + `/api/admin/tables/${meta.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ isEditable: false }),
    });
    const token = await createToken(baseURL, cookie, {
      name: 't',
      permissions: { tables: ['*'], actions: ['read', 'write'] },
    });
    const res = await dataFetch(baseURL, token, '/api/data/ro/records', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(403);
  });

  it('token actions 无 write → 写操作 403', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    await createModel(baseURL, cookie, {
      name: 'posts2',
      label: 'p',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true },
        { name: 'title', jsonType: 'string' },
      ],
    });
    const token = await createToken(baseURL, cookie, { name: 't', permissions: { tables: ['*'], actions: ['read'] } });
    const res = await dataFetch(baseURL, token, '/api/data/posts2/records', {
      method: 'POST',
      body: JSON.stringify({ title: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('tables 白名单不含 → 403', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    await createModel(baseURL, cookie, {
      name: 'posts3',
      label: 'p',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }],
    });
    const token = await createToken(baseURL, cookie, {
      name: 't',
      permissions: { tables: ['others'], actions: ['read'] },
    });
    const res = await dataFetch(baseURL, token, '/api/data/posts3');
    expect(res.status).toBe(403);
  });

  it('list 查询：order + q + field__eq 过滤', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    await createModel(baseURL, cookie, {
      name: 'arts',
      label: 'a',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true },
        { name: 'title', jsonType: 'string' },
      ],
    });
    const token = await createToken(baseURL, cookie, {
      name: 't',
      permissions: { tables: ['*'], actions: ['read', 'write'] },
    });
    await dataFetch(baseURL, token, '/api/data/arts/records', { method: 'POST', body: JSON.stringify({ title: 'apple' }) });
    await dataFetch(baseURL, token, '/api/data/arts/records', {
      method: 'POST',
      body: JSON.stringify({ title: 'banana' }),
    });
    // q
    const q = await dataFetch(baseURL, token, '/api/data/arts?q=apple');
    expect(((await q.json()) as { data: { total: number } }).data.total).toBe(1);
    // order
    const o = await dataFetch(baseURL, token, '/api/data/arts?order=id:desc');
    const ob = (await o.json()) as { data: { rows: { title: string }[] } };
    expect(ob.data.rows[0]?.title).toBe('banana');
    // filter
    const f = await dataFetch(baseURL, token, '/api/data/arts?title__eq=apple');
    expect(((await f.json()) as { data: { total: number } }).data.total).toBe(1);
  });
});
