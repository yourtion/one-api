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

  it('建表带 note/autoTimestamps + 更新元数据各字段 + refresh 成功（条件挂载分支）', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    const created = (await t
      .session()
      .post('/admin/tables')
      .headers(h)
      .input({
        name: 'tbl_branch',
        label: 'b',
        fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }],
        note: 'note-val',
        autoTimestamps: true,
      })
      .success()) as { id: number };
    // 更新元数据各字段（覆盖 updateMeta 的 label/note/isPublished/isEditable 条件分支）
    const updated = (await t
      .session()
      .put(`/admin/tables/${created.id}`)
      .headers(h)
      .input({ label: 'b2', note: 'n2', isPublished: false, isEditable: false })
      .success()) as { label: string };
    expect(updated.label).toBe('b2');
    // refresh 成功（meta 存在分支）
    const refreshed = await t.session().post(`/admin/tables/${created.id}/refresh`).headers(h).success();
    expect(refreshed).toBeTruthy();
    await t.session().delete(`/admin/tables/${created.id}`).headers(h).input({ confirm: true }).success();
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

  it('更新管理员 nickname；删除其他管理员', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    const op = (await t.session().post('/admin/admins').headers(h).input({ name: 'op2', nickname: 'op2', password: 'secret2' }).success()) as { id: number };
    // 更新 nickname（updateProfile 分支）
    await t.session().put(`/admin/admins/${op.id}`).headers(h).input({ nickname: 'renamed' }).success();
    // 删除该管理员（delete 分支）
    await t.session().delete(`/admin/admins/${op.id}`).headers(h).success();
    const list = (await t.session().get('/admin/admins').headers(h).success()) as Array<{ id: number }>;
    expect(list.find((a) => a.id === op.id)).toBeUndefined();
  });
});

describe('auth /me /password /logout', () => {
  it('/me 返回当前管理员信息', async () => {
    const token = await t.adminToken();
    const me = (await t.session().get('/auth/me').headers({ authorization: `Bearer ${token}` }).success()) as { name: string };
    expect(me.name).toBe('admin');
  });

  it('/password 修改密码成功（旧密码正确），随后改回避免污染其他测试', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    const ret = (await t.session().put('/auth/password').headers(h).input({ oldPassword: '123456', newPassword: 'newpass123' }).success()) as {
      success: boolean;
    };
    expect(ret.success).toBe(true);
    // 改回原密码，避免污染共享 systemDb 影响后续 adminToken() 登录
    await t.session().put('/auth/password').headers(h).input({ oldPassword: 'newpass123', newPassword: '123456' }).success();
  });

  it('/password 旧密码错误 → 失败', async () => {
    const token = await t.adminToken();
    const err = await t
      .session()
      .put('/auth/password')
      .headers({ authorization: `Bearer ${token}` })
      .input({ oldPassword: 'wrong', newPassword: 'newpass123' })
      .error();
    expect(err).toBeInstanceOf(Error);
  });

  it('/logout 返回成功（无状态）', async () => {
    const token = await t.adminToken();
    const ret = (await t.session().post('/auth/logout').headers({ authorization: `Bearer ${token}` }).success()) as { success: boolean };
    expect(ret.success).toBe(true);
  });
});

describe('Token 更新与删除', () => {
  it('更新 token 各字段（name/permissions/isActive/expiresAt）', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    const created = (await t
      .session()
      .post('/admin/tokens')
      .headers(h)
      .input({ name: 'upd', permissions: { tables: ['*'], actions: ['read'] } })
      .success()) as { id: number };
    // 更新全部字段（覆盖 token.ts 的 patch 各分支 + token-crud update）
    await t.session()
      .put(`/admin/tokens/${created.id}`)
      .headers(h)
      .input({
        name: 'updated',
        permissions: { tables: ['t1'], actions: ['write'] },
        isActive: false,
        expiresAt: 1700000000000,
      })
      .success();
    const list = (await t.session().get('/admin/tokens').headers(h).success()) as Array<{ id: number; name: string; is_active: number | boolean }>;
    const found = list.find((tk) => tk.id === created.id);
    expect(found?.name).toBe('updated');
    // is_active 经 tokenToListVO 透传 DB 的整型（0）；未激活态断言非真值
    expect(found?.is_active).toBeFalsy();
  });

  it('删除 token', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    const created = (await t
      .session()
      .post('/admin/tokens')
      .headers(h)
      .input({ name: 'del', permissions: { tables: ['*'], actions: ['read'] } })
      .success()) as { id: number };
    await t.session().delete(`/admin/tokens/${created.id}`).headers(h).success();
    const list = (await t.session().get('/admin/tokens').headers(h).success()) as Array<{ id: number }>;
    expect(list.find((tk) => tk.id === created.id)).toBeUndefined();
  });
});

describe('admin data 单条操作 + CSV 导出', () => {
  let tableId: number;
  let pk: string;

  beforeAll(async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    await seedBusinessTable(t.businessDbPath, 'CREATE TABLE ad2 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, n INTEGER)');
    const meta = (await t.session().post('/admin/tables/import').headers(h).input({ name: 'ad2' }).success()) as { id: number };
    tableId = meta.id;
    const created = (await t.session().post(`/admin/tables/${tableId}/data`).headers(h).input({ name: 'x', n: 5 }).success()) as { id: number };
    pk = String(created.id);
  });

  it('单条详情 + 不存在 → 404', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    const row = (await t.session().get(`/admin/tables/${tableId}/data/${pk}`).headers(h).success()) as { name: string };
    expect(row.name).toBe('x');
    // 不存在
    const err = await t.session().get(`/admin/tables/${tableId}/data/999999`).headers(h).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('修改 + 删除单条', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    await t.session().put(`/admin/tables/${tableId}/data/${pk}`).headers(h).input({ name: 'y' }).success();
    const row = (await t.session().get(`/admin/tables/${tableId}/data/${pk}`).headers(h).success()) as { name: string };
    expect(row.name).toBe('y');
    await t.session().delete(`/admin/tables/${tableId}/data/${pk}`).headers(h).success();
    const err = await t.session().get(`/admin/tables/${tableId}/data/${pk}`).headers(h).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('CSV 导出含表头 + 数据行', async () => {
    const token = await t.adminToken();
    const h = { authorization: `Bearer ${token}` };
    // 再插一条供导出
    await t.session().post(`/admin/tables/${tableId}/data`).headers(h).input({ name: 'csv,row', n: 9 }).success();
    const res = await t.session().get(`/admin/tables/${tableId}/export`).headers(h).raw();
    expect(res.status).toBe(200);
    const text = String(res.text);
    expect(text).toContain('id,name,n'); // 表头
    expect(text).toContain('"csv,row"'); // 含逗号的字段被引号包裹（csvCell 转义分支）
  });
});

describe('表详情 + 取消注册（confirm）', () => {
  it('单表详情 404（不存在）', async () => {
    const token = await t.adminToken();
    const err = await t.session().get('/admin/tables/999999').headers({ authorization: `Bearer ${token}` }).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('刷新表结构 404（表不存在，!meta 分支）', async () => {
    const token = await t.adminToken();
    const err = await t.session().post('/admin/tables/999999/refresh').headers({ authorization: `Bearer ${token}` }).error();
    expect(err).toBeInstanceOf(Error);
  });
});
