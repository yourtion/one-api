import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine, _resetEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { registerTokenRoutes } from '../modules/token/router.js';
import { registerAdminRoutes } from '../modules/admin/router.js';
import { startServer, loginAdmin, adminFetch, type TestServer } from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => {
  if (s) await s.close();
  s = null;
});

async function start(withAdminRoutes = true) {
  _resetEngine();
  const dir = mkdtempSync(join(tmpdir(), '1api-tok-'));
  const systemDbPath = join(dir, 'system.db');
  const businessDbPath = join(dir, 'business.db');
  const sys = await initSystemDb(systemDbPath);
  const engine = await initEngine({ businessDbPath, systemDbPath });
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerTokenRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      if (withAdminRoutes) registerAdminRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
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

describe('Token 管理 /api/admin/tokens', () => {
  it('创建返回明文仅一次；列表只显 prefix；token_hash 不外泄', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const c = await adminFetch(baseURL, cookie, '/api/admin/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 't', permissions: { tables: ['*'], actions: ['read'] } }),
    });
    const cb = (await c.json()) as { data: { token: string; tokenPrefix: string; tokenHash?: string } };
    expect(cb.data.token.startsWith('oa_')).toBe(true);
    expect(cb.data.tokenPrefix.endsWith('****')).toBe(true);
    expect(cb.data.tokenHash).toBeUndefined();
    // 列表
    const l = await adminFetch(baseURL, cookie, '/api/admin/tokens');
    const lb = (await l.json()) as { data: { token_prefix: string; token_hash?: string; token?: string }[] };
    expect(lb.data[0]!.token_prefix.endsWith('****')).toBe(true);
    expect(lb.data[0]!.token_hash).toBeUndefined();
    expect(lb.data[0]!.token).toBeUndefined();
  });

  it('更新 + 删除 token', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const c = await adminFetch(baseURL, cookie, '/api/admin/tokens', {
      method: 'POST',
      body: JSON.stringify({ name: 't', permissions: { tables: ['*'], actions: ['read'] } }),
    });
    const cb = (await c.json()) as { data: { id: number } };
    const u = await adminFetch(baseURL, cookie, `/api/admin/tokens/${cb.data.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 't2' }),
    });
    expect(u.status).toBe(200);
    const d = await adminFetch(baseURL, cookie, `/api/admin/tokens/${cb.data.id}`, { method: 'DELETE' });
    expect(d.status).toBe(200);
  });
});

describe('管理员管理 /api/admin/admins', () => {
  it('新建管理员 → must_change_password=1', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const c = await adminFetch(baseURL, cookie, '/api/admin/admins', {
      method: 'POST',
      body: JSON.stringify({ name: 'op1', nickname: 'op1', password: 'secret1' }),
    });
    const cb = (await c.json()) as { data: { must_change_password: number } };
    expect(cb.data.must_change_password).toBe(1);
  });

  it('重置密码 → must_change_password 置 1', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const c = await adminFetch(baseURL, cookie, '/api/admin/admins', {
      method: 'POST',
      body: JSON.stringify({ name: 'op2', nickname: 'op2', password: 'secret1' }),
    });
    const id = ((await c.json()) as { data: { id: number } }).data.id;
    await adminFetch(baseURL, cookie, `/api/admin/admins/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ password: 'newsecret1' }),
    });
    const list = await adminFetch(baseURL, cookie, '/api/admin/admins');
    const lb = (await list.json()) as { data: { id: number; must_change_password: number }[] };
    expect(lb.data.find((a) => a.id === id)?.must_change_password).toBe(1);
  });

  it('不可删自己', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    // 当前 admin id=1
    const d = await adminFetch(baseURL, cookie, '/api/admin/admins/1', { method: 'DELETE' });
    expect(d.status).toBe(400);
  });
});
