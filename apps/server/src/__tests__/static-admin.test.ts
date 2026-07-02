import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Application } from '@leizm/web';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from '../app.js';
import { initSystemDb } from '../db/system.js';
import { initEngine, _resetEngine } from '../core/engine.js';
import { setSystemDb } from '../core/system-db.js';

let dir = '';
let baseURL = '';
let server: http.Server | null = null;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), '1api-static-'));
  const adminDir = join(dir, 'admin');
  mkdirSync(adminDir, { recursive: true });
  mkdirSync(join(adminDir, 'assets'), { recursive: true });
  writeFileSync(join(adminDir, 'index.html'), '<!doctype html><div id="app">shell</div>');
  writeFileSync(join(adminDir, 'assets', 'app.js'), 'console.log(1)');

  // buildApp 内部 registerAuthRoutes 等需 systemDb 已装配（且 erest api 是全局单例，
  // 仅注册一次——故 buildApp 全程只调一次）
  _resetEngine();
  const systemDbPath = join(dir, 'system.db');
  const businessDbPath = join(dir, 'business.db');
  const systemDb = await initSystemDb(systemDbPath);
  setSystemDb(systemDb.db);
  const engine = await initEngine({ businessDbPath, systemDbPath });

  process.env['ONE_API_ADMIN_ROOT'] = adminDir;
  const app: Application = buildApp();
  server = app.server;
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseURL = `http://127.0.0.1:${port}`;

  // 资源关闭
  await engine.destroy();
  await systemDb.close();
});

afterAll(async () => {
  delete process.env['ONE_API_ADMIN_ROOT'];
  if (server) await new Promise<void>((r) => server.close(() => r()));
  server = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('/admin 静态托管 + SPA fallback', () => {
  it('根路径 GET /admin/ → index.html（SPA shell）', async () => {
    const r = await fetch(baseURL + '/admin/');
    expect(r.status).toBe(200);
    expect((await r.text()).includes('id="app"')).toBe(true);
  });

  it('深路径 GET /admin/tables/123/data → index.html（history fallback）', async () => {
    const r = await fetch(baseURL + '/admin/tables/123/data');
    expect(r.status).toBe(200);
    expect((await r.text()).includes('id="app"')).toBe(true);
  });

  it('真实静态资源 GET /admin/assets/app.js → 文件内容（200）', async () => {
    const r = await fetch(baseURL + '/admin/assets/app.js');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('console.log(1)');
  });

  it('healthz 仍可用（静态托管不影响既有路由）', async () => {
    const r = await fetch(baseURL + '/healthz');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { success: boolean }).success).toBe(true);
  });
});
