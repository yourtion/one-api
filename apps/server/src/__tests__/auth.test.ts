import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine, _resetEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { startServer, loginAdmin, adminAuthHeader, type TestServer } from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => {
  if (s) await s.close();
  s = null;
});

async function startAuthServer() {
  _resetEngine();
  const dir = mkdtempSync(join(tmpdir(), '1api-auth-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  const app = buildApp({
    sessionSecret: 'test-secret',
    registerRoutes: (a) => registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 'test-secret' }),
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
  return s;
}

describe('auth', () => {
  it('默认 admin/123456 登录 → success + mustChangePassword:true + set-cookie', async () => {
    const { baseURL } = await startAuthServer();
    const res = await fetch(baseURL + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'admin', password: '123456' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { admin: { name: string }; mustChangePassword: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.admin.name).toBe('admin');
    expect(body.data.mustChangePassword).toBe(true);
    expect(res.headers.get('set-cookie')).toBeTruthy();
  });

  it('错误密码 → 401', async () => {
    const { baseURL } = await startAuthServer();
    const res = await fetch(baseURL + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'admin', password: 'wrong' }),
    });
    expect(res.status).toBe(401);
  });

  it('未登录访问 /me → 401', async () => {
    const { baseURL } = await startAuthServer();
    const res = await fetch(baseURL + '/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('登录后访问 /me → 返回 admin 信息', async () => {
    const { baseURL } = await startAuthServer();
    const cookie = await loginAdmin(baseURL);
    const res = await fetch(baseURL + '/api/auth/me', { headers: adminAuthHeader(cookie) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string; mustChangePassword: boolean } };
    expect(body.data.name).toBe('admin');
    expect(body.data.mustChangePassword).toBe(true);
  });

  it('改密后 mustChangePassword 清零 + 旧密码错误被拒', async () => {
    const { baseURL } = await startAuthServer();
    const cookie = await loginAdmin(baseURL);
    // 旧密码错误
    const bad = await fetch(baseURL + '/api/auth/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...adminAuthHeader(cookie) },
      body: JSON.stringify({ oldPassword: 'wrong', newPassword: 'newpass1' }),
    });
    expect(bad.status).toBe(401);
    // 正确改密
    const ok = await fetch(baseURL + '/api/auth/password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...adminAuthHeader(cookie) },
      body: JSON.stringify({ oldPassword: '123456', newPassword: 'newpass1' }),
    });
    expect(ok.status).toBe(200);
    // /me 的 mustChangePassword 应为 false
    const me = await fetch(baseURL + '/api/auth/me', { headers: adminAuthHeader(cookie) });
    const meBody = (await me.json()) as { data: { mustChangePassword: boolean } };
    expect(meBody.data.mustChangePassword).toBe(false);
    // 旧密码不能再登录
    const rel = await fetch(baseURL + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'admin', password: '123456' }),
    });
    expect(rel.status).toBe(401);
    // 新密码可登录
    const newLogin = await fetch(baseURL + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'admin', password: 'newpass1' }),
    });
    expect(newLogin.status).toBe(200);
  });

  it('logout 后 session 失效（/me → 401）', async () => {
    const { baseURL } = await startAuthServer();
    const cookie = await loginAdmin(baseURL);
    await fetch(baseURL + '/api/auth/logout', { method: 'POST', headers: adminAuthHeader(cookie) });
    const me = await fetch(baseURL + '/api/auth/me', { headers: adminAuthHeader(cookie) });
    expect(me.status).toBe(401);
  });
});
