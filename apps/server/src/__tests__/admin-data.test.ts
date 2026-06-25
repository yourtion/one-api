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
import {
  startServer,
  loginAdmin,
  adminFetch,
  importTable,
  seedBusinessTable,
  type TestServer,
} from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => {
  if (s) await s.close();
  s = null;
});

async function start() {
  _resetEngine();
  const dir = mkdtempSync(join(tmpdir(), '1api-ad-'));
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

describe('管理员数据浏览 /api/admin/tables/:id/data', () => {
  it('CRUD（internal 通道）', async () => {
    const sv = await start();
    await seedBusinessTable(sv.businessDbPath, 'CREATE TABLE t1 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    const cookie = await loginAdmin(sv.baseURL);
    const meta = await importTable(sv.baseURL, cookie, 't1');
    // create
    const c = await adminFetch(sv.baseURL, cookie, `/api/admin/tables/${meta.id}/data`, {
      method: 'POST',
      body: JSON.stringify({ name: 'a' }),
    });
    const cb = (await c.json()) as { data: { id: number; name: string } };
    expect(cb.data.name).toBe('a');
    // list
    const l = await adminFetch(sv.baseURL, cookie, `/api/admin/tables/${meta.id}/data`);
    const lb = (await l.json()) as { data: { rows: { id: number }[] } };
    expect(lb.data.rows.length).toBe(1);
    // update
    await adminFetch(sv.baseURL, cookie, `/api/admin/tables/${meta.id}/data/${cb.data.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'b' }),
    });
    // get
    const g = await adminFetch(sv.baseURL, cookie, `/api/admin/tables/${meta.id}/data/${cb.data.id}`);
    const gb = (await g.json()) as { data: { name: string } };
    expect(gb.data.name).toBe('b');
    // delete
    await adminFetch(sv.baseURL, cookie, `/api/admin/tables/${meta.id}/data/${cb.data.id}`, { method: 'DELETE' });
    const l2 = await adminFetch(sv.baseURL, cookie, `/api/admin/tables/${meta.id}/data`);
    const lb2 = (await l2.json()) as { data: { rows: unknown[] } };
    expect(lb2.data.rows.length).toBe(0);
  });

  it('internal 通道能访问未发布表（is_published=0）', async () => {
    const sv = await start();
    await seedBusinessTable(sv.businessDbPath, 'CREATE TABLE t2 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    const cookie = await loginAdmin(sv.baseURL);
    const meta = await importTable(sv.baseURL, cookie, 't2');
    // 置为未发布
    await adminFetch(sv.baseURL, cookie, `/api/admin/tables/${meta.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isPublished: false }),
    });
    // 管理员仍能 list
    const l = await adminFetch(sv.baseURL, cookie, `/api/admin/tables/${meta.id}/data`);
    expect(l.status).toBe(200);
  });
});
