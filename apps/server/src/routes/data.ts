import type { ERest, Middleware } from 'erest';
import { z } from 'erest';
import { Errors } from '@1api/shared';
import { getEngine } from '../core/engine.js';
import { parseListQuery } from '../utils/list-query.js';
import { requireToken, checkPermission } from '../hooks.js';
import { getSystemDb } from '../core/system-db.js';
import { ListQuerySchema, TableParam, TablePkParam } from './schemas.js';

/**
 * 对外数据 CRUD /api/data/:table（data 组，Token 鉴权）。
 * 默认 internal:false → engine 校验 is_published（未发布→404）/ is_editable（写→403）。
 * 路径相对 data 组前缀 /api/data：/:table、/:table/records/:pk 等。
 *
 * 保留段 records/schema/incr 不与合法表名（^[a-z][a-z0-9_]*$）冲突。
 */
export function registerDataRoutes(api: ERest<Middleware>): void {
  const data = api.group('data').before(requireToken(getSystemDb()));
  const engine = () => getEngine();

  // —— list ——（read 权限）
  data
    .get('/:table')
    .title('列表')
    .example({
      name: '查询 users 第一页',
      path: '/users?page=1&size=20',
      headers: { Authorization: 'Bearer oa_a3f9c2e8b1d7e6f5a4b3c2d1' },
      input: { page: 1, size: 20 },
      output: { rows: [{ id: 1, name: 'alice', age: 30 }, { id: 2, name: 'bob', age: 25 }], total: 2, page: 1, size: 20 },
    })
    .before(checkPermission('read', { tableKey: 'table' }))
    .registerTyped(
      { params: TableParam, query: ListQuerySchema },
      async (req) => {
        const listOpts = parseListQuery(req.query as Record<string, unknown>);
    return await engine().data.list(req.params.table, listOpts);      },
    );

  // —— schema（表结构，保留段）——
  data
    .get('/:table/schema')
    .title('表结构')
    .example({
      name: '获取 users 表结构',
      path: '/users/schema',
      headers: { Authorization: 'Bearer oa_a3f9c2e8b1d7e6f5a4b3c2d1' },
      input: {},
      output: { name: 'users', fields: [{ name: 'id', type: 'integer', pk: true }, { name: 'name', type: 'text' }, { name: 'age', type: 'integer' }], primaryKey: 'id' },
    })
    .before(checkPermission('read', { tableKey: 'table' }))
    .registerTyped(
      { params: TableParam },
      async (req) => {
    return await engine().data.describe(req.params.table);      },
    );

  // —— get ——
  data
    .get('/:table/records/:pk')
    .title('单条')
    .example({
      name: '查询单条记录',
      path: '/users/records/1',
      headers: { Authorization: 'Bearer oa_a3f9c2e8b1d7e6f5a4b3c2d1' },
      input: {},
      output: { id: 1, name: 'alice', age: 30 },
    })
    .before(checkPermission('read', { tableKey: 'table' }))
    .registerTyped(
      { params: TablePkParam },
      async (req) => {
        const row = await engine().data.get(req.params.table, req.params.pk);
        if (!row) throw Errors.tableNotFound(req.params.table);
    return row;      },
    );

  // —— create ——（write 权限）
  data
    .post('/:table/records')
    .title('创建')
    .example({
      name: '新建一条用户',
      path: '/users/records',
      headers: { Authorization: 'Bearer oa_a3f9c2e8b1d7e6f5a4b3c2d1' },
      input: { name: 'alice', age: 30 },
      output: { id: 1, name: 'alice', age: 30 },
    })
    .before(checkPermission('write', { tableKey: 'table' }))
    .registerTyped(
      { params: TableParam, body: z.anyObject() },
      async (req) => {
    return await engine().data.create(req.params.table, req.body);      },
    );

  // —— update ——
  data
    .put('/:table/records/:pk')
    .title('更新')
    .example({
      name: '更新单条记录',
      path: '/users/records/1',
      headers: { Authorization: 'Bearer oa_a3f9c2e8b1d7e6f5a4b3c2d1' },
      input: { age: 31 },
      output: { success: true },
    })
    .before(checkPermission('write', { tableKey: 'table' }))
    .registerTyped(
      { params: TablePkParam, body: z.anyObject() },
      async (req) => {
        await engine().data.update(req.params.table, req.params.pk, req.body);
    return { success: true };      },
    );

  // —— delete ——
  data
    .delete('/:table/records/:pk')
    .title('删除')
    .example({
      name: '删除单条记录',
      path: '/users/records/1',
      headers: { Authorization: 'Bearer oa_a3f9c2e8b1d7e6f5a4b3c2d1' },
      input: {},
      output: { success: true },
    })
    .before(checkPermission('write', { tableKey: 'table' }))
    .registerTyped(
      { params: TablePkParam },
      async (req) => {
        await engine().data.delete(req.params.table, req.params.pk);
    return { success: true };      },
    );

  // —— incr ——
  data
    .post('/:table/incr')
    .title('自增')
    .example({
      name: 'age 字段自增 1',
      path: '/users/incr',
      headers: { Authorization: 'Bearer oa_a3f9c2e8b1d7e6f5a4b3c2d1' },
      input: { pk: 1, field: 'age', count: 1 },
      output: { success: true },
    })
    .before(checkPermission('write', { tableKey: 'table' }))
    .registerTyped(
      {
        params: TableParam,
        body: z.object({
          pk: z.union([z.string(), z.number()]),
          field: z.string(),
          count: z.number(),
        }),
      },
      async (req) => {
        await engine().data.incr(req.params.table, req.body.pk, req.body.field, req.body.count);
    return { success: true };      },
    );
}
