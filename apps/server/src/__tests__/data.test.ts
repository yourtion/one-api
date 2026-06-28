import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTest, type TestSetup } from './helpers.js';

let t: TestSetup;

beforeAll(async () => {
  t = await setupTest();
});
afterAll(async () => {
  await t.cleanup();
});

let tableSeq = 0;

/** 用 admin token 建表 + 创建对外 token，返回 { tableName, token }。每个用例独立表名避免冲突。 */
async function setupTableAndToken(
  tablePerms = { tables: ['*'], actions: ['read', 'write'] as string[] },
): Promise<{ tableName: string; token: string }> {
  const adminToken = await t.adminToken();
  const h = { authorization: `Bearer ${adminToken}` };
  const tableName = `posts_${tableSeq++}`;
  await t
    .session()
    .post('/admin/tables')
    .headers(h)
    .input({
      name: tableName,
      label: '文章',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true },
        { name: 'title', jsonType: 'string' },
        { name: 'views', jsonType: 'integer' },
      ],
    })
    .success();
  const token = await t.insertToken(tablePerms);
  return { tableName, token };
}

describe('对外 data（Token 鉴权）', () => {
  it('无 token → 401', async () => {
    const err = await t.session().get('/data/posts').error();
    expect(err).toBeInstanceOf(Error);
  });

  it('CRUD 全流程', async () => {
    const { tableName, token } = await setupTableAndToken();
    const auth = { authorization: `Bearer ${token}` };
    const P = `/data/${tableName}`;
    // create
    const c = (await t.session().post(`${P}/records`).headers(auth).input({ title: 'hello', views: 0 }).success()) as {
      id: number;
      title: string;
    };
    expect(c.title).toBe('hello');
    // list
    const l = (await t.session().get(P).headers(auth).success()) as { total: number };
    expect(l.total).toBe(1);
    // get
    const g = (await t.session().get(`${P}/records/${c.id}`).headers(auth).success()) as { title: string };
    expect(g.title).toBe('hello');
    // update
    await t.session().put(`${P}/records/${c.id}`).headers(auth).input({ title: 'world' }).success();
    // incr
    await t.session().post(`${P}/incr`).headers(auth).input({ pk: c.id, field: 'views', count: 3 }).success();
    const g2 = (await t.session().get(`${P}/records/${c.id}`).headers(auth).success()) as { views: number };
    expect(g2.views).toBe(3);
    // delete
    await t.session().delete(`${P}/records/${c.id}`).headers(auth).success();
    const l2 = (await t.session().get(P).headers(auth).success()) as { total: number };
    expect(l2.total).toBe(0);
  });

  it('schema 端点', async () => {
    const { tableName, token } = await setupTableAndToken();
    const body = (await t.session().get(`/data/${tableName}/schema`).headers({ authorization: `Bearer ${token}` }).success()) as {
      name: string;
    };
    expect(body.name).toBe(tableName);
  });

  it('tables 白名单不含 → 拒绝', async () => {
    const { tableName, token } = await setupTableAndToken({ tables: ['others'], actions: ['read'] });
    const err = await t.session().get(`/data/${tableName}`).headers({ authorization: `Bearer ${token}` }).error();
    expect(err).toBeInstanceOf(Error);
  });

  it('actions 无 write → 写操作拒绝', async () => {
    const { tableName, token } = await setupTableAndToken({ tables: ['*'], actions: ['read'] });
    const err = await t
      .session()
      .post(`/data/${tableName}/records`)
      .headers({ authorization: `Bearer ${token}` })
      .input({ title: 'x' })
      .error();
    expect(err).toBeInstanceOf(Error);
  });
});

describe('对外 data-schema（Token schema action）', () => {
  it('无 schema action → 建表被拒', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write'] });
    const err = await t
      .session()
      .post('/data/_schema/tables')
      .headers({ authorization: `Bearer ${token}` })
      .input({ name: 'ds1', label: 'd', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }] })
      .error();
    expect(err).toBeInstanceOf(Error);
  });

  it('有 schema action → 建表 + 加字段', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const auth = { authorization: `Bearer ${token}` };
    const created = await t
      .session()
      .post('/data/_schema/tables')
      .headers(auth)
      .input({
        name: 'ds2',
        label: 'd',
        fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true }, { name: 'title', jsonType: 'string' }],
      })
      .success();
    expect(created).toBeTruthy();
    const f = (await t
      .session()
      .post('/data/_schema/tables/ds2/fields')
      .headers(auth)
      .input({ field: { name: 'score', jsonType: 'number' } })
      .success()) as { fields: { name: string }[] };
    expect(f.fields.map((x) => x.name)).toContain('score');
  });

  it('tables 白名单含新表名（非 *）→ 允许；不含 → 拒绝', async () => {
    const tokAllow = await t.insertToken({ tables: ['allowed_tbl'], actions: ['schema'] });
    const ok = await t
      .session()
      .post('/data/_schema/tables')
      .headers({ authorization: `Bearer ${tokAllow}` })
      .input({ name: 'allowed_tbl', label: 'a', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }] })
      .success();
    expect(ok).toBeTruthy();
    const tokDeny = await t.insertToken({ tables: ['other'], actions: ['schema'] });
    const err = await t
      .session()
      .post('/data/_schema/tables')
      .headers({ authorization: `Bearer ${tokDeny}` })
      .input({ name: 'denied_tbl', label: 'd', fields: [{ name: 'id', jsonType: 'integer', isPrimary: true }] })
      .error();
    expect(err).toBeInstanceOf(Error);
  });
});
