import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine, _resetEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { registerTableRoutes } from '../modules/table/router.js';
import { registerAdminDataRoutes } from '../modules/admin-data/router.js';
import { registerTokenRoutes } from '../modules/token/router.js';
import { registerAdminRoutes } from '../modules/admin/router.js';
import { registerDataRoutes } from '../modules/data/router.js';
import { registerDataSchemaRoutes } from '../modules/data-schema/router.js';
import { startServer, loginAdmin, type TestServer } from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => {
  if (s) await s.close();
  s = null;
});

/** 完整 app 装配（与 index.ts 的 registerRoutes 一致：全部路由组） */
async function startFullApp() {
  _resetEngine();
  const dir = mkdtempSync(join(tmpdir(), '1api-e2e-'));
  const systemDbPath = join(dir, 'system.db');
  const businessDbPath = join(dir, 'business.db');
  const sys = await initSystemDb(systemDbPath);
  const engine = await initEngine({ businessDbPath, systemDbPath });
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerTableRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerAdminDataRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerTokenRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerAdminRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerDataRoutes(a, { systemDb: sys.db });
      registerDataSchemaRoutes(a, { systemDb: sys.db });
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

describe('e2e 冒烟（全量路由）', () => {
  it('healthz → 200', async () => {
    const { baseURL } = await startFullApp();
    const res = await fetch(baseURL + '/healthz');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { success: boolean; data: { status: string } }).data.status).toBe('ok');
  });

  it('默认 admin/123456 可登录（首启）', async () => {
    const { baseURL } = await startFullApp();
    const cookie = await loginAdmin(baseURL);
    expect(cookie).toBeTruthy();
  });

  it('登录后可访问 admin 列表', async () => {
    const { baseURL } = await startFullApp();
    const cookie = await loginAdmin(baseURL);
    const tl = await fetch(baseURL + '/api/admin/tables', { headers: { cookie } });
    expect(tl.status).toBe(200);
  });

  it('未登录访问 admin → 401；无效 token 访问 data → 401', async () => {
    const { baseURL } = await startFullApp();
    const r1 = await fetch(baseURL + '/api/admin/tables');
    expect(r1.status).toBe(401);
    const r2 = await fetch(baseURL + '/api/data/any', { headers: { authorization: 'Bearer oa_invalid' } });
    expect(r2.status).toBe(401);
  });

  it('端到端：登录→建表→建 token→token 写数据→读数据', async () => {
    const { baseURL, businessDbPath } = await startFullApp();
    void businessDbPath;
    const cookie = await loginAdmin(baseURL);
    // 建表
    const createRes = await fetch(baseURL + '/api/admin/tables', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'notes',
        label: '笔记',
        fields: [
          { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true },
          { name: 'content', jsonType: 'string' },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    // 建 token
    const tokRes = await fetch(baseURL + '/api/admin/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'sdk', permissions: { tables: ['*'], actions: ['read', 'write'] } }),
    });
    const token = ((await tokRes.json()) as { data: { token: string } }).data.token;
    // token 写数据
    const wRes = await fetch(baseURL + '/api/data/notes/records', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: 'hello' }),
    });
    expect(wRes.status).toBe(201);
    // token 读数据
    const rRes = await fetch(baseURL + '/api/data/notes', {
      headers: { authorization: `Bearer ${token}` },
    });
    const rb = (await rRes.json()) as { data: { total: number } };
    expect(rb.data.total).toBe(1);
  });
});
