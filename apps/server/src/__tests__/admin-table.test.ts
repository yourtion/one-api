import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { initSystemDb } from '../db/system.js';
import { initEngine, _resetEngine } from '../core/engine.js';
import { buildApp } from '../app.js';
import { registerAuthRoutes } from '../modules/auth/router.js';
import { registerTableRoutes } from '../modules/table/router.js';
import {
  startServer,
  loginAdmin,
  adminFetch,
  importTable,
  createModel,
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
  const dir = mkdtempSync(join(tmpdir(), '1api-tbl-'));
  // ⚠️ 关键：engine 的 businessDbPath 必须与 seedBusinessTable/startServer 用的同一文件。
  // startServer 自建独立 dir，故在此用固定路径，并传同一路径给 engine 与 startServer.build。
  const systemDbPath = join(dir, 'system.db');
  const businessDbPath = join(dir, 'business.db');
  const sys = await initSystemDb(systemDbPath);
  const engine = await initEngine({ businessDbPath, systemDbPath });
  const app = buildApp({
    sessionSecret: 's',
    registerRoutes: (a) => {
      registerAuthRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
      registerTableRoutes(a, { systemDb: sys.db, sessionSecret: 's' });
    },
  });
  // startServer 的 build 回调自建临时 dir，但我们要复用上面的 system/business 路径，
  // 故忽略 build 传入的 cfg，用闭包里的 sys/engine。
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
  // 覆盖 TestServer 的 businessDbPath 为真实业务库路径（seedBusinessTable 用）
  (s as TestServer).businessDbPath = businessDbPath;
  return s;
}

describe('表管理 /api/admin/tables', () => {
  it('未登录 → 401', async () => {
    const { baseURL } = await start();
    const res = await fetch(baseURL + '/api/admin/tables');
    expect(res.status).toBe(401);
  });

  it('导入已有表 → 201 + 列表可见', async () => {
    const sv = await start();
    await seedBusinessTable(sv.businessDbPath, 'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
    const cookie = await loginAdmin(sv.baseURL);
    const meta = await importTable(sv.baseURL, cookie, 'users');
    expect(meta.id).toBeGreaterThan(0);
    const list = await adminFetch(sv.baseURL, cookie, '/api/admin/tables');
    const lb = (await list.json()) as { data: { name: string }[] };
    expect(lb.data.some((t) => t.name === 'users')).toBe(true);
  });

  it('新建模型 → 201 + 元数据', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const meta = await createModel(baseURL, cookie, {
      name: 'posts',
      label: '文章',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true },
        { name: 'title', jsonType: 'string' },
      ],
    });
    expect(meta.id).toBeGreaterThan(0);
  });

  it('保留表名（schema/records/incr）新建 → 拒绝', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    for (const name of ['schema', 'records', 'incr']) {
      const res = await adminFetch(baseURL, cookie, '/api/admin/tables', {
        method: 'POST',
        body: JSON.stringify({
          name,
          label: name,
          fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }],
        }),
      });
      const body = (await res.json()) as { error: { code: string } };
      expect(['RESERVED_NAME', 'INVALID_NAME']).toContain(body.error.code);
    }
  });

  it('无主键表导入 → 拒绝（透传 engine 错误）', async () => {
    const sv = await start();
    await seedBusinessTable(sv.businessDbPath, 'CREATE TABLE nopk (name TEXT)');
    const cookie = await loginAdmin(sv.baseURL);
    const res = await adminFetch(sv.baseURL, cookie, '/api/admin/tables/import', {
      method: 'POST',
      body: JSON.stringify({ name: 'nopk' }),
    });
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TABLE_NO_PRIMARY_KEY');
  });

  it('复合主键表导入 → 拒绝', async () => {
    const sv = await start();
    await seedBusinessTable(sv.businessDbPath, 'CREATE TABLE cpk (a INTEGER, b INTEGER, PRIMARY KEY (a, b))');
    const cookie = await loginAdmin(sv.baseURL);
    const res = await adminFetch(sv.baseURL, cookie, '/api/admin/tables/import', {
      method: 'POST',
      body: JSON.stringify({ name: 'cpk' }),
    });
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TABLE_COMPOSITE_PRIMARY_KEY');
  });

  it('刷新表结构（加列后 refresh）', async () => {
    const sv = await start();
    await seedBusinessTable(sv.businessDbPath, 'CREATE TABLE r1 (id INTEGER PRIMARY KEY, a TEXT)');
    const cookie = await loginAdmin(sv.baseURL);
    const meta = await importTable(sv.baseURL, cookie, 'r1');
    await seedBusinessTable(sv.businessDbPath, 'ALTER TABLE r1 ADD COLUMN b TEXT');
    const res = await adminFetch(sv.baseURL, cookie, `/api/admin/tables/${meta.id}/refresh`, { method: 'POST' });
    expect(res.status).toBe(200);
    const detail = await adminFetch(sv.baseURL, cookie, `/api/admin/tables/${meta.id}`);
    const db = (await detail.json()) as { data: { fields: { name: string }[] } };
    expect(db.data.fields.map((f) => f.name)).toContain('b');
  });

  it('删除（取消注册）需 confirm:true', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const meta = await createModel(baseURL, cookie, {
      name: 'del1',
      label: 'd',
      fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }],
    });
    const noConfirm = await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: false }),
    });
    expect(noConfirm.status).toBe(400);
    const ok = await adminFetch(baseURL, cookie, `/api/admin/tables/${meta.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true }),
    });
    expect(ok.status).toBe(200);
  });
});
