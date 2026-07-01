import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTest, seedBusinessTable, type TestSetup } from './helpers.js';

let t: TestSetup;

beforeAll(async () => {
  t = await setupTest();
});
afterAll(async () => {
  await t.cleanup();
});

describe('admin 通道（session 鉴权）', () => {
  it('登录返回 admin VO + mustChangePassword（无 token 字段）', async () => {
    const ret = (await t.session().post('/auth/login').input({ name: 'admin', password: '123456' }).success()) as {
      admin: { name: string };
      mustChangePassword: boolean;
      token?: string;
    };
    expect(ret.admin.name).toBe('admin');
    expect(ret.mustChangePassword).toBe(true);
    expect(ret.token).toBeUndefined();
  });

  it('错误密码 → 失败', async () => {
    const err = await t.session().post('/auth/login').input({ name: 'admin', password: 'wrong' }).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('未登录 session 访问 admin → 401', async () => {
    const err = await t.session().get('/admin/tables').error();
    expect(err).toBeInstanceOf(Error);
  });

  it('admin session 可访问表列表', async () => {
    const s = await t.adminSession();
    const ret = (await s.get('/admin/tables').success()) as unknown[];
    expect(Array.isArray(ret)).toBe(true);
  });

  it('保留表名（schema/records/incr）新建 → 拒绝', async () => {
    const s = await t.adminSession();
    for (const name of ['schema', 'records', 'incr']) {
      const err = await s
        .post('/admin/tables')
        .input({ name, label: name, fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }] })
        .error();
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('无主键表导入 → 拒绝', async () => {
    await seedBusinessTable(t.businessDbPath, 'CREATE TABLE nopk (name TEXT)');
    const s = await t.adminSession();
    const err = await s.post('/admin/tables/import').input({ name: 'nopk' }).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('复合主键表导入 → 拒绝', async () => {
    await seedBusinessTable(t.businessDbPath, 'CREATE TABLE cpk (a INTEGER, b INTEGER, PRIMARY KEY (a, b))');
    const s = await t.adminSession();
    const err = await s.post('/admin/tables/import').input({ name: 'cpk' }).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('新建模型 + 列表可见 + 刷新 + 删除需 confirm', async () => {
    const s = await t.adminSession();
    const created = (await s
      .post('/admin/tables')
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
    const list = (await s.get('/admin/tables').success()) as Array<{ name: string }>;
    expect(list.some((x) => x.name === 'posts')).toBe(true);
    // 删除需 confirm（coerceBool：布尔 false → 拒绝；字符串 'false' 也不应误判为 true）
    const noConfirm = await s.delete(`/admin/tables/${created.id}`).input({ confirm: false }).error();
    expect(noConfirm).toBeInstanceOf(Error);
    const strFalseRejected = await s.delete(`/admin/tables/${created.id}`).input({ confirm: 'false' }).error();
    expect(strFalseRejected).toBeInstanceOf(Error);
    const ok = (await s.delete(`/admin/tables/${created.id}`).input({ confirm: true }).success()) as { success: boolean };
    expect(ok.success).toBe(true);
  });

  it('建表带 note/autoTimestamps + 更新元数据各字段 + refresh 成功（条件挂载分支）', async () => {
    const s = await t.adminSession();
    const created = (await s
      .post('/admin/tables')
      .input({
        name: 'tbl_branch',
        label: 'b',
        fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }],
        note: 'note-val',
        autoTimestamps: true,
      })
      .success()) as { id: number };
    // 更新元数据各字段（覆盖 updateMeta 的 label/note/isPublished/isEditable 条件分支）
    const updated = (await s
      .put(`/admin/tables/${created.id}`)
      .input({ label: 'b2', note: 'n2', isPublished: false, isEditable: false })
      .success()) as { label: string };
    expect(updated.label).toBe('b2');
    // refresh 成功（meta 存在分支）
    const refreshed = await s.post(`/admin/tables/${created.id}/refresh`).success();
    expect(refreshed).toBeTruthy();
    await s.delete(`/admin/tables/${created.id}`).input({ confirm: true }).success();
  });
});

describe('admin data 浏览（internal 通道）', () => {
  it('CRUD + 能访问未发布表', async () => {
    const s = await t.adminSession();
    await seedBusinessTable(t.businessDbPath, 'CREATE TABLE ad1 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)');
    const meta = (await s.post('/admin/tables/import').input({ name: 'ad1' }).success()) as { id: number };
    const c = (await s.post(`/admin/tables/${meta.id}/data`).input({ name: 'a' }).success()) as { name: string };
    expect(c.name).toBe('a');
    const l = (await s.get(`/admin/tables/${meta.id}/data`).success()) as { rows: unknown[] };
    expect(l.rows.length).toBe(1);
    // 置未发布
    await s.put(`/admin/tables/${meta.id}`).input({ isPublished: false }).success();
    // 仍能访问（internal）
    const l2 = (await s.get(`/admin/tables/${meta.id}/data`).success()) as { rows: unknown[] };
    expect(l2.rows.length).toBe(1);
  });
});

describe('Token 管理', () => {
  it('创建返回明文 + prefix；列表不外泄 hash', async () => {
    const s = await t.adminSession();
    const created = (await s
      .post('/admin/tokens')
      .input({ name: 't', permissions: { tables: ['*'], actions: ['read'] } })
      .success()) as { token: string; tokenPrefix: string };
    expect(created.token.startsWith('oa_')).toBe(true);
    expect(created.tokenPrefix.endsWith('****')).toBe(true);
    const list = (await s.get('/admin/tokens').success()) as Array<{
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
    const s = await t.adminSession();
    const op = (await s.post('/admin/admins').input({ name: 'op1', nickname: 'op1', password: 'secret1' }).success()) as {
      id: number;
      must_change_password: number;
    };
    expect(op.must_change_password).toBe(1);
    await s.put(`/admin/admins/${op.id}`).input({ password: 'newsecret1' }).success();
    const list = (await s.get('/admin/admins').success()) as Array<{ id: number; must_change_password: number }>;
    expect(list.find((a) => a.id === op.id)?.must_change_password).toBe(1);
    // 不可删自己（当前 admin id=1）
    const err = await s.delete('/admin/admins/1').error();
    expect(err).toBeInstanceOf(Error);
  });

  it('更新管理员 nickname；删除其他管理员', async () => {
    const s = await t.adminSession();
    const op = (await s.post('/admin/admins').input({ name: 'op2', nickname: 'op2', password: 'secret2' }).success()) as { id: number };
    // 更新 nickname（updateProfile 分支）
    await s.put(`/admin/admins/${op.id}`).input({ nickname: 'renamed' }).success();
    // 删除该管理员（delete 分支）
    await s.delete(`/admin/admins/${op.id}`).success();
    const list = (await s.get('/admin/admins').success()) as Array<{ id: number }>;
    expect(list.find((a) => a.id === op.id)).toBeUndefined();
  });
});

describe('auth /me /password /logout', () => {
  it('/me 返回当前管理员信息', async () => {
    const s = await t.adminSession();
    const me = (await s.get('/auth/me').success()) as { name: string };
    expect(me.name).toBe('admin');
  });

  it('/password 修改密码成功（旧密码正确），随后改回避免污染其他测试', async () => {
    const s = await t.adminSession();
    const ret = (await s.put('/auth/password').input({ oldPassword: '123456', newPassword: 'newpass123' }).success()) as {
      success: boolean;
    };
    expect(ret.success).toBe(true);
    // 改回原密码，避免污染共享 systemDb 影响后续登录
    await s.put('/auth/password').input({ oldPassword: 'newpass123', newPassword: '123456' }).success();
  });

  it('/password 旧密码错误 → 失败', async () => {
    const s = await t.adminSession();
    const err = await s.put('/auth/password').input({ oldPassword: 'wrong', newPassword: 'newpass123' }).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('/logout 销毁会话，后续 admin 访问 → 401', async () => {
    const s = await t.adminSession();
    // 先确认能访问
    const ok = (await s.get('/auth/me').success()) as { name: string };
    expect(ok.name).toBe('admin');
    // 登出
    const ret = (await s.post('/auth/logout').success()) as { success: boolean };
    expect(ret.success).toBe(true);
    // 同一 session 再访问 admin → 401（cookie 已失效）
    const err = await s.get('/admin/tables').error();
    expect(err).toBeInstanceOf(Error);
  });
});

describe('Token 更新与删除', () => {
  it('更新 token 各字段（name/permissions/isActive/expiresAt）', async () => {
    const s = await t.adminSession();
    const created = (await s
      .post('/admin/tokens')
      .input({ name: 'upd', permissions: { tables: ['*'], actions: ['read'] } })
      .success()) as { id: number };
    // 更新全部字段（覆盖 token.ts 的 patch 各分支 + token-crud update）
    await s
      .put(`/admin/tokens/${created.id}`)
      .input({
        name: 'updated',
        permissions: { tables: ['t1'], actions: ['write'] },
        isActive: false,
        expiresAt: 1700000000000,
      })
      .success();
    const list = (await s.get('/admin/tokens').success()) as Array<{ id: number; name: string; is_active: number | boolean }>;
    const found = list.find((tk) => tk.id === created.id);
    expect(found?.name).toBe('updated');
    // is_active 经 tokenToListVO 透传 DB 的整型（0）；未激活态断言非真值
    expect(found?.is_active).toBeFalsy();
  });

  it('删除 token', async () => {
    const s = await t.adminSession();
    const created = (await s
      .post('/admin/tokens')
      .input({ name: 'del', permissions: { tables: ['*'], actions: ['read'] } })
      .success()) as { id: number };
    await s.delete(`/admin/tokens/${created.id}`).success();
    const list = (await s.get('/admin/tokens').success()) as Array<{ id: number }>;
    expect(list.find((tk) => tk.id === created.id)).toBeUndefined();
  });
});

describe('admin data 单条操作 + CSV 导出', () => {
  let tableId: number;
  let pk: string;

  beforeAll(async () => {
    const s = await t.adminSession();
    await seedBusinessTable(t.businessDbPath, 'CREATE TABLE ad2 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, n INTEGER)');
    const meta = (await s.post('/admin/tables/import').input({ name: 'ad2' }).success()) as { id: number };
    tableId = meta.id;
    const created = (await s.post(`/admin/tables/${tableId}/data`).input({ name: 'x', n: 5 }).success()) as { id: number };
    pk = String(created.id);
  });

  it('单条详情 + 不存在 → 404', async () => {
    const s = await t.adminSession();
    const row = (await s.get(`/admin/tables/${tableId}/data/${pk}`).success()) as { name: string };
    expect(row.name).toBe('x');
    // 不存在
    const err = await s.get(`/admin/tables/${tableId}/data/999999`).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('修改 + 删除单条', async () => {
    const s = await t.adminSession();
    await s.put(`/admin/tables/${tableId}/data/${pk}`).input({ name: 'y' }).success();
    const row = (await s.get(`/admin/tables/${tableId}/data/${pk}`).success()) as { name: string };
    expect(row.name).toBe('y');
    await s.delete(`/admin/tables/${tableId}/data/${pk}`).success();
    const err = await s.get(`/admin/tables/${tableId}/data/${pk}`).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('CSV 导出含表头 + 数据行', async () => {
    const s = await t.adminSession();
    // 再插一条供导出
    await s.post(`/admin/tables/${tableId}/data`).input({ name: 'csv,row', n: 9 }).success();
    const res = await s.get(`/admin/tables/${tableId}/export`).raw();
    expect(res.status).toBe(200);
    const text = String(res.text);
    expect(text).toContain('id,name,n'); // 表头
    expect(text).toContain('"csv,row"'); // 含逗号的字段被引号包裹（csvCell 转义分支）
  });

  it('CSV 导出超出上限 → X-Export-Truncated 提示（I5 截断分支）', async () => {
    // 直接在业务库原生批量插入 >10000 行（事务内很快），触发导出截断提示
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(t.businessDbPath);
    const insert = db.prepare('INSERT INTO ad2 (name, n) VALUES (?, ?)');
    const tx = db.transaction((count: number) => {
      for (let i = 0; i < count; i++) insert.run('bulk', i);
    });
    tx(10001);
    db.close();
    const s = await t.adminSession();
    const res = await s.get(`/admin/tables/${tableId}/export`).raw();
    expect(res.status).toBe(200);
    expect(res.headers['x-export-truncated']).toBe('true');
    expect(Number(res.headers['x-export-total'])).toBeGreaterThan(10000);
  });
});

describe('表详情 + 取消注册（confirm）', () => {
  it('单表详情 404（不存在）', async () => {
    const s = await t.adminSession();
    const err = await s.get('/admin/tables/999999').error();
    expect(err).toBeInstanceOf(Error);
  });

  it('刷新表结构 404（表不存在，!meta 分支）', async () => {
    const s = await t.adminSession();
    const err = await s.post('/admin/tables/999999/refresh').error();
    expect(err).toBeInstanceOf(Error);
  });
});
