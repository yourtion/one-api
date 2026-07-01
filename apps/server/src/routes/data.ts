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
