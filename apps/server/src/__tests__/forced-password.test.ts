import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { setupTest, type TestSetup } from './helpers.js';

let t: TestSetup;
type Session = ReturnType<TestSetup['session']>;

beforeEach(async () => {
  t = await setupTest();
});
afterEach(async () => {
  await t.cleanup();
});

async function login(name = 'admin', password = '123456'): Promise<Session> {
  const session = t.session();
  await session.post('/auth/login').input({ name, password }).success();
  return session;
}

function expectError(response: { status: number; text: string }, status: number, code: string): void {
  expect(response.status).toBe(status);
  expect(JSON.parse(response.text)).toMatchObject({ success: false, error: { code } });
}

async function expectPasswordRequired(session: Session): Promise<void> {
  expectError(await session.get('/admin/tables').raw(), 403, 'AUTH_PASSWORD_CHANGE_REQUIRED');
}

describe('服务端强制改密（真实 session HTTP）', () => {
  it('首次登录仍须改密，管理组读写被拒且无副作用；me/logout 可用', async () => {
    const session = t.session();
    const result = await session.post('/auth/login').input({ name: 'admin', password: '123456' }).success();
    expect(result).toMatchObject({ mustChangePassword: true, admin: { mustChangePassword: true } });
    const admins = await t.systemDb.selectFrom('admin').selectAll().execute();
    for (const path of ['/admin/tables', '/admin/tokens', '/admin/admins']) {
      expectError(await session.get(path).raw(), 403, 'AUTH_PASSWORD_CHANGE_REQUIRED');
    }
    const writes = [
      session.post('/admin/tables').input({ name: 'blocked', label: 'Blocked', fields: [] }),
      session.post('/admin/tokens').input({ name: 'blocked', permissions: { tables: ['*'], actions: ['read'] } }),
      session.post('/admin/admins').input({ name: 'blocked', nickname: 'Blocked', password: 'secret123' }),
    ];
    for (const request of writes) {
      expectError(await request.raw(), 403, 'AUTH_PASSWORD_CHANGE_REQUIRED');
    }
    expect(await t.systemDb.selectFrom('admin').selectAll().execute()).toEqual(admins);
    expect(await t.systemDb.selectFrom('api_token').selectAll().execute()).toEqual([]);
    expect(await t.systemDb.selectFrom('table_meta').selectAll().execute()).toEqual([]);
    const db = new Database(t.businessDbPath);
    try {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'blocked'").all()).toEqual([]);
    } finally {
      db.close();
    }
    expect(await session.get('/auth/me').success()).toMatchObject({ name: 'admin', mustChangePassword: true });
    await session.post('/auth/logout').success();
    expectError(await session.get('/auth/me').raw(), 401, 'UNAUTHORIZED');
  });

  it('首次登录可修改密码，清除标记后原 session 立即可管理', async () => {
    const session = await login();
    await expectPasswordRequired(session);
    expect(await session.put('/auth/password').input({ oldPassword: '123456', newPassword: 'changed123' }).success())
      .toEqual({ success: true });
    expect(await session.get('/auth/me').success()).toMatchObject({ mustChangePassword: false });
    expect(await session.get('/admin/tables').success()).toEqual([]);
    expect((await t.systemDb.selectFrom('admin').select('must_change_password').where('id', '=', 1).executeTakeFirstOrThrow())
      .must_change_password).toBe(0);
    expectError(await t.session().post('/auth/login').input({ name: 'admin', password: '123456' }).raw(), 401, 'UNAUTHORIZED');
    await login('admin', 'changed123');
  });

  it.each([
    { reason: '相同密码', oldPassword: '123456', newPassword: '123456', status: 400, code: 'VALIDATION_FAIL' },
    { reason: '错误旧密码', oldPassword: 'wrong123', newPassword: 'changed123', status: 401, code: 'UNAUTHORIZED' },
    { reason: '过短密码', oldPassword: '123456', newPassword: '123', status: 400, code: 'VALIDATION_FAIL' },
  ])('$reason 不能解除待改密状态', async ({ oldPassword, newPassword, status, code }) => {
    const session = await login();
    const before = await t.systemDb.selectFrom('admin').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
    expectError(await session.put('/auth/password').input({ oldPassword, newPassword }).raw(), status, code);
    expect(await t.systemDb.selectFrom('admin').selectAll().where('id', '=', 1).executeTakeFirstOrThrow()).toEqual(before);
    expect(await session.get('/auth/me').success()).toMatchObject({ mustChangePassword: true });
    await expectPasswordRequired(session);
  });

  it('重置后原 session 的全部管理读写被拦，数据不变且对外 Bearer 通道仍可用', async () => {
    const session = await login();
    await session.put('/auth/password').input({ oldPassword: '123456', newPassword: 'changed123' }).success();
    const table = await session.post('/admin/tables').input({
      name: 'records_test', label: 'Records', fields: [{ name: 'title', jsonType: 'string', nullable: true }],
    }).success() as { id: number };
    await session.put(`/admin/tables/${table.id}`).input({ isPublished: true, isEditable: true }).success();
    const row = await session.post(`/admin/tables/${table.id}/data`).input({ title: 'original' }).success() as { id: number };
    const token = await session.post('/admin/tokens').input({
      name: 'original', permissions: { tables: ['*'], actions: ['read'] },
    }).success() as { id: number; token: string };
    const other = await session.post('/admin/admins').input({ name: 'other', nickname: 'Original', password: 'secret123' })
      .success() as { id: number };
    // 使用真实重置接口设置标记；原 session 不重新登录，应在下一请求读取到新标记。
    await session.put('/admin/admins/1').input({ password: 'reset123' }).success();
    const snapshot = {
      admins: await t.systemDb.selectFrom('admin').selectAll().execute(),
      tokens: await t.systemDb.selectFrom('api_token').selectAll().execute(),
      tables: await t.systemDb.selectFrom('table_meta').selectAll().execute(),
    };
    const tablePath = `/admin/tables/${table.id}`;
    const dataPath = `${tablePath}/data`;
    const requests = [
      session.get('/admin/tables'), session.get(tablePath), session.get(dataPath),
      session.get(`${dataPath}/${row.id}`), session.get(`${tablePath}/export`),
      session.get('/admin/tokens'), session.get('/admin/admins'),
      session.post('/admin/tables').input({ name: 'blocked', label: 'Blocked', fields: [] }),
      session.post('/admin/tables/import').input({ name: 'records_test' }),
      session.post(`${tablePath}/refresh`), session.put(tablePath).input({ label: 'Blocked' }),
      session.delete(tablePath).input({ confirm: true }),
      session.post(dataPath).input({ title: 'blocked' }),
      session.put(`${dataPath}/${row.id}`).input({ title: 'blocked' }), session.delete(`${dataPath}/${row.id}`),
      session.post('/admin/tokens').input({ name: 'blocked', permissions: { tables: ['*'], actions: ['read'] } }),
      session.put(`/admin/tokens/${token.id}`).input({ name: 'blocked' }), session.delete(`/admin/tokens/${token.id}`),
      session.post('/admin/admins').input({ name: 'blocked', nickname: 'Blocked', password: 'secret123' }),
      session.put(`/admin/admins/${other.id}`).input({ nickname: 'Blocked', password: 'blocked123' }),
      session.delete(`/admin/admins/${other.id}`),
    ];
    for (const request of requests) {
      expectError(await request.raw(), 403, 'AUTH_PASSWORD_CHANGE_REQUIRED');
    }
    expect(await t.systemDb.selectFrom('admin').selectAll().execute()).toEqual(snapshot.admins);
    expect(await t.systemDb.selectFrom('api_token').selectAll().execute()).toEqual(snapshot.tokens);
    expect(await t.systemDb.selectFrom('table_meta').selectAll().execute()).toEqual(snapshot.tables);
    const db = new Database(t.businessDbPath);
    try {
      expect(db.prepare('SELECT * FROM records_test').all()).toEqual([{ id: row.id, title: 'original' }]);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'blocked'").all()).toEqual([]);
    } finally {
      db.close();
    }
    expect(await session.get('/auth/me').success()).toMatchObject({ mustChangePassword: true });
    // erest 的 session() 复用实例级 cookie jar；使用原生 fetch 验证无 cookie 的 Bearer 请求。
    const bearerOnly = await fetch(new URL('/admin/tables', t.mcpUrl), {
      headers: { authorization: `Bearer ${token.token}` },
    });
    expectError({ status: bearerOnly.status, text: await bearerOnly.text() }, 401, 'UNAUTHORIZED');
    expectError(await session.get('/data/records_test').raw(), 401, 'INVALID_TOKEN');
    expect(await t.session().get('/data/records_test').headers({ Authorization: `Bearer ${token.token}` }).success())
      .toMatchObject({ rows: [{ id: row.id, title: 'original' }], total: 1 });
    await session.put('/auth/password').input({ oldPassword: 'reset123', newPassword: 'finished123' }).success();
    expect(await session.get('/admin/tables').success()).toMatchObject([{ id: table.id }]);
  });
});
