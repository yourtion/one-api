import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTest, seedBusinessTable, type TestSetup } from './helpers.js';

let t: TestSetup;

beforeAll(async () => {
  t = await setupTest();
});
afterAll(async () => {
  await t.cleanup();
});

describe('admin 通道（admin token 鉴权）', () => {
  it('登录返回 admin token + mustChangePassword', async () => {
    const ret = (await t.session().post('/auth/login').input({ name: 'admin', password: '123456' }).success()) as {
      token: string;
      mustChangePassword: boolean;
    };
    expect(ret.token.startsWith('oa_')).toBe(true);
    expect(ret.mustChangePassword).toBe(true);
  });

  it('错误密码 → 失败', async () => {
    const err = await t.session().post('/auth/login').input({ name: 'admin', password: 'wrong' }).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('未带 token 访问 admin → 401', async () => {
    const err = await t.session().get('/admin/tables').error();
    expect(err).toBeInstanceOf(Error);
  });

  it('admin token 可访问表列表', async () => {
    const token = await t.adminToken();
    const ret = (await t.session().get('/admin/tables').headers({ authorization: `Bearer ${token}` }).success()) as unknown[];
    expect(Array.isArray(ret)).toBe(true);
  });

  it('保留表名（schema/records/incr）新建 → 拒绝', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    for (const name of ['schema', 'records', 'incr']) {
      const err = await t
        .session()
        .post('/admin/tables')
        .headers(h)
        .input({ name, label: name, fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }] })
        .error();
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('无主键表导入 → 拒绝', async () => {
    await seedBusinessTable(t.businessDbPath, 'CREATE TABLE nopk (name TEXT)');
    const token = await t.adminToken();
    const err = await t.session().post('/admin/tables/import').headers({ authorization: `Bearer ${token}` }).input({ name: 'nopk' }).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('复合主键表导入 → 拒绝', async () => {
    await seedBusinessTable(t.businessDbPath, 'CREATE TABLE cpk (a INTEGER, b INTEGER, PRIMARY KEY (a, b))');
    const token = await t.adminToken();
    const err = await t.session().post('/admin/tables/import').headers({ authorization: `Bearer ${token}` }).input({ name: 'cpk' }).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('新建模型 + 列表可见 + 刷新 + 删除需 confirm', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    const created = (await t
      .session()
      .post('/admin/tables')
      .headers(h)
      .input({
        name: 'posts',
        label: '文章',
        fields: [
          { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true },
          { name: 'title', jsonType: 'string' },
        ],
      })
      .success()) as { id: number; name: string };
    expect(created.name).toBe('posts');
    const list = (await t.session().get('/admin/tables').headers(h).success()) as Array<{ name: string }>;
    expect(list.some((x) => x.name === 'posts')).toBe(true);
    // 删除需 confirm
    const noConfirm = await t.session().delete(`/admin/tables/${created.id}`).headers(h).input({ confirm: false }).error();
    expect(noConfirm).toBeInstanceOf(Error);
    const ok = (await t.session().delete(`/admin/tables/${created.id}`).headers(h).input({ confirm: true }).success()) as { success: boolean };
    expect(ok.success).toBe(true);
  });
});

describe('admin data 浏览（internal 通道）', () => {
  it('CRUD + 能访问未发布表', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    await seedBusinessTable(t.businessDbPath, 'CREATE TABLE ad1 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    const meta = (await t.session().post('/admin/tables/import').headers(h).input({ name: 'ad1' }).success()) as { id: number };
    const c = (await t.session().post(`/admin/tables/${meta.id}/data`).headers(h).input({ name: 'a' }).success()) as { name: string };
    expect(c.name).toBe('a');
    const l = (await t.session().get(`/admin/tables/${meta.id}/data`).headers(h).success()) as { rows: unknown[] };
    expect(l.rows.length).toBe(1);
    // 置未发布
    await t.session().put(`/admin/tables/${meta.id}`).headers(h).input({ isPublished: false }).success();
    // 仍能访问（internal）
    const l2 = (await t.session().get(`/admin/tables/${meta.id}/data`).headers(h).success()) as { rows: unknown[] };
    expect(l2.rows.length).toBe(1);
  });
});

describe('Token 管理', () => {
  it('创建返回明文 + prefix；列表不外泄 hash', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    const created = (await t
      .session()
      .post('/admin/tokens')
      .headers(h)
      .input({ name: 't', permissions: { tables: ['*'], actions: ['read'] } })
      .success()) as { token: string; tokenPrefix: string };
    expect(created.token.startsWith('oa_')).toBe(true);
    expect(created.tokenPrefix.endsWith('****')).toBe(true);
    const list = (await t.session().get('/admin/tokens').headers(h).success()) as Array<{
      token_prefix: string;
      token_hash?: string;
      token?: string;
    }>;
    expect(list[0]!.token_prefix.endsWith('****')).toBe(true);
    expect(list[0]!.token_hash).toBeUndefined();
    expect(list[0]!.token).toBeUndefined();
  });
});

describe('管理员管理', () => {
  it('新建管理员 must_change=1；重置密码置 1；不可删自己', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    const op = (await t.session().post('/admin/admins').headers(h).input({ name: 'op1', nickname: 'op1', password: 'secret1' }).success()) as {
      id: number;
      must_change_password: number;
    };
    expect(op.must_change_password).toBe(1);
    await t.session().put(`/admin/admins/${op.id}`).headers(h).input({ password: 'newsecret1' }).success();
    const list = (await t.session().get('/admin/admins').headers(h).success()) as Array<{ id: number; must_change_password: number }>;
    expect(list.find((a) => a.id === op.id)?.must_change_password).toBe(1);
    // 不可删自己（当前 admin id=1）
    const err = await t.session().delete('/admin/admins/1').headers(h).error();
    expect(err).toBeInstanceOf(Error);
  });
});
