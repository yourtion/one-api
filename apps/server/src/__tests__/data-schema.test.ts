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
import { registerDataSchemaRoutes } from '../modules/data-schema/router.js';
import { startServer, loginAdmin, createToken, dataFetch, type TestServer } from './helpers.js';

let s: TestServer | null = null;
afterEach(async () => {
  if (s) await s.close();
  s = null;
});

async function start() {
  _resetEngine();
  const dir = mkdtempSync(join(tmpdir(), '1api-dschema-'));
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

describe('对外 data-schema /api/data/_schema/*（Token schema action）', () => {
  it('无 schema action → 建表被拒 403', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const token = await createToken(baseURL, cookie, {
      name: 't',
      permissions: { tables: ['*'], actions: ['read', 'write'] },
    });
    const res = await dataFetch(baseURL, token, '/api/data/_schema/tables', {
      method: 'POST',
      body: JSON.stringify({
        name: 'ds1',
        label: 'd',
        fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }],
      }),
    });
    expect(res.status).toBe(403);
  });

  it('有 schema action → 建表 + 加字段', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const token = await createToken(baseURL, cookie, {
      name: 't',
      permissions: { tables: ['*'], actions: ['read', 'write', 'schema'] },
    });
    const c = await dataFetch(baseURL, token, '/api/data/_schema/tables', {
      method: 'POST',
      body: JSON.stringify({
        name: 'ds2',
        label: 'd',
        fields: [
          { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true },
          { name: 'title', jsonType: 'string' },
        ],
      }),
    });
    expect(c.status).toBe(201);
    const f = await dataFetch(baseURL, token, '/api/data/_schema/tables/ds2/fields', {
      method: 'POST',
      body: JSON.stringify({ field: { name: 'score', jsonType: 'number' } }),
    });
    expect(f.status).toBe(200);
    const fb = (await f.json()) as { data: { fields: { name: string }[] } };
    expect(fb.data.fields.map((x) => x.name)).toContain('score');
  });

  it('_schema 路径下划线前缀不与合法表名冲突', async () => {
    const { baseURL } = await start();
    const cookie = await loginAdmin(baseURL);
    const token = await createToken(baseURL, cookie, {
      name: 't',
      permissions: { tables: ['*'], actions: ['schema'] },
    });
    const res = await dataFetch(baseURL, token, '/api/data/_schema/tables', {
      method: 'POST',
      body: JSON.stringify({
        name: 'normal',
        label: 'n',
        fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }],
      }),
    });
    expect(res.status).toBe(201);
  });
});
