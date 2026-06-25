import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import * as web from '@leizm/web';
import type { Kysely } from 'kysely';
import type { ServerSystemDB } from '../db/types.js';
import { initSystemDb } from '../db/system.js';
import { initEngine, _resetEngine } from '../core/engine.js';
import { AppApplication, AppRouter, type Middleware } from '../types/context.js';
import { errorMiddleware } from '../middlewares/error.js';
import { requireAdmin } from '../middlewares/session-auth.js';
import { createRequireToken, createCheckPermission } from '../middlewares/token-auth.js';
import { _resetLastWriteAt } from '../middlewares/token-store.js';
import { startServer, type TestServer } from './helpers.js';

interface Bootstrap {
  systemDb: Kysely<ServerSystemDB>;
  cleanup: () => Promise<void>;
}

async function bootstrap(): Promise<Bootstrap> {
  _resetEngine();
  const dir = mkdtempSync(join(tmpdir(), '1api-mw-'));
  const sys = await initSystemDb(join(dir, 'system.db'));
  const engine = await initEngine({ businessDbPath: join(dir, 'business.db'), systemDbPath: join(dir, 'system.db') });
  return {
    systemDb: sys.db,
    cleanup: async () => {
      await engine.destroy();
      await sys.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let s: TestServer | null = null;
beforeEach(() => _resetLastWriteAt());
afterEach(async () => {
  if (s) await s.close();
  s = null;
});

const SESSION_MAX_AGE = 86_400_000; // 1 day（@leizm/web 默认 maxAge=0 会立即过期，必须传正值）

describe('requireAdmin（session）', () => {
  it('未登录 → 401 UNAUTHORIZED', async () => {
    const bs = await bootstrap();
    const app = new AppApplication();
    app.use('/', web.component.cookieParser('secret'));
    app.use('/', web.component.session({ store: new web.component.SessionMemoryStore(), maxAge: SESSION_MAX_AGE }));
    const r = new AppRouter();
    r.get(
      '/me',
      requireAdmin(bs.systemDb),
      ((ctx) => ctx.response.json({ id: ctx.currentUser?.id })) as Middleware,
    );
    app.use('/', r);
    app.use('/', errorMiddleware);
    s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
    const res = await fetch(s.baseURL + '/me');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
  });

  it('登录后注入 currentUser（id=1）', async () => {
    const bs = await bootstrap();
    const app = new AppApplication();
    app.use('/', web.component.cookieParser('secret'));
    app.use('/', web.component.session({ store: new web.component.SessionMemoryStore(), maxAge: SESSION_MAX_AGE }));
    const r = new AppRouter();
    r.get(
      '/fake-login',
      ((ctx) => {
        ctx.request.session['adminId'] = 1;
        ctx.response.json({ ok: 1 });
      }) as Middleware,
    );
    r.get(
      '/me',
      requireAdmin(bs.systemDb),
      ((ctx) => ctx.response.json({ id: ctx.currentUser?.id })) as Middleware,
    );
    app.use('/', r);
    app.use('/', errorMiddleware);
    s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
    const r1 = await fetch(s.baseURL + '/fake-login');
    const cookie = r1.headers.get('set-cookie');
    expect(cookie).toBeTruthy();
    const res = await fetch(s.baseURL + '/me', { headers: { cookie: cookie as string } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id?: number }).id).toBe(1);
  });
});

describe('requireToken + checkPermission', () => {
  it('无 Authorization → 401 INVALID_TOKEN', async () => {
    const bs = await bootstrap();
    const app = new AppApplication();
    app.use('/', web.component.bodyParser.json());
    const r = new AppRouter();
    r.get(
      '/data/:table',
      createRequireToken(bs.systemDb),
      ((ctx) => ctx.response.json({ ok: 1 })) as Middleware,
    );
    app.use('/', r);
    app.use('/', errorMiddleware);
    s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
    const res = await fetch(s.baseURL + '/data/users');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_TOKEN');
  });

  it('有效 token 但 tables 白名单不含 → 403 FORBIDDEN', async () => {
    const bs = await bootstrap();
    const hash = createHash('sha256').update('oa_test123').digest('hex');
    await bs.systemDb
      .insertInto('api_token')
      .values({
        name: 't',
        token_hash: hash,
        token_prefix: 'oa_test****',
        permissions: JSON.stringify({ tables: ['posts'], actions: ['read'] }),
        is_active: 1,
        expires_at: null,
        last_used_at: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      .execute();
    const app = new AppApplication();
    app.use('/', web.component.bodyParser.json());
    const r = new AppRouter();
    r.get(
      '/data/:table',
      createRequireToken(bs.systemDb),
      createCheckPermission('read'),
      ((ctx) => ctx.response.json({ ok: 1 })) as Middleware,
    );
    app.use('/', r);
    app.use('/', errorMiddleware);
    s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
    const res = await fetch(s.baseURL + '/data/users', { headers: { Authorization: 'Bearer oa_test123' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('tables=["*"] + actions 含 read → 200 + last_used_at 写一次（降频）', async () => {
    const bs = await bootstrap();
    const hash = createHash('sha256').update('oa_wildcard').digest('hex');
    await bs.systemDb
      .insertInto('api_token')
      .values({
        name: 't',
        token_hash: hash,
        token_prefix: 'oa_wildc****',
        permissions: JSON.stringify({ tables: ['*'], actions: ['read', 'write'] }),
        is_active: 1,
        expires_at: null,
        last_used_at: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      .execute();
    const app = new AppApplication();
    app.use('/', web.component.bodyParser.json());
    const r = new AppRouter();
    r.get(
      '/data/:table',
      createRequireToken(bs.systemDb),
      createCheckPermission('read'),
      ((ctx) => ctx.response.json({ ok: 1 })) as Middleware,
    );
    app.use('/', r);
    app.use('/', errorMiddleware);
    s = await startServer({ build: async () => ({ app, close: bs.cleanup }) });
    await fetch(s.baseURL + '/data/users', { headers: { Authorization: 'Bearer oa_wildcard' } });
    await fetch(s.baseURL + '/data/users', { headers: { Authorization: 'Bearer oa_wildcard' } });
    const row = await bs.systemDb
      .selectFrom('api_token')
      .select('last_used_at')
      .where('token_hash', '=', hash)
      .executeTakeFirst();
    expect(row?.last_used_at).not.toBeNull();
  });
});
