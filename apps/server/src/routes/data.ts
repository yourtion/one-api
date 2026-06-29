import type { ERest, Middleware } from "erest";
import { Errors } from '@1api/shared';
import { getEngine } from '../core/engine.js';
import { ok } from '../utils/response.js';
import { parseListQuery } from '../utils/list-query.js';
import { requireToken, checkPermission } from '../hooks.js';
import { getSystemDb } from '../core/system-db.js';

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
    .register(async (ctx, next) => {
      const table = String(ctx.params['table']);
      const listOpts = parseListQuery(ctx.query as Record<string, unknown>);
      ctx.reply.json(ok(await engine().data.list(table, listOpts)));
      return next();
    });

  // —— schema（表结构，保留段）——
  data
    .get('/:table/schema')
    .title('表结构')
    .before(checkPermission('read', { tableKey: 'table' }))
    .register(async (ctx, next) => {
      const table = String(ctx.params['table']);
      ctx.reply.json(ok(await engine().data.describe(table)));
      return next();
    });

  // —— get ——
  data
    .get('/:table/records/:pk')
    .title('单条')
    .before(checkPermission('read', { tableKey: 'table' }))
    .register(async (ctx, next) => {
      const table = String(ctx.params["table"]); const pk = String(ctx.params["pk"]);
      const row = await engine().data.get(table, pk);
      if (!row) throw Errors.tableNotFound(table);
      ctx.reply.json(ok(row));
      return next();
    });

  // —— create ——（write 权限）
  data
    .post('/:table/records')
    .title('创建')
    .before(checkPermission('write', { tableKey: 'table' }))
    .register(async (ctx, next) => {
      const table = String(ctx.params['table']);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      ctx.reply.status(201).json(ok(await engine().data.create(table, body)));
      return next();
    });

  // —— update ——
  data
    .put('/:table/records/:pk')
    .title('更新')
    .before(checkPermission('write', { tableKey: 'table' }))
    .register(async (ctx, next) => {
      const table = String(ctx.params["table"]); const pk = String(ctx.params["pk"]);
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      await engine().data.update(table, pk, body);
      ctx.reply.json(ok({ success: true }));
      return next();
    });

  // —— delete ——
  data
    .delete('/:table/records/:pk')
    .title('删除')
    .before(checkPermission('write', { tableKey: 'table' }))
    .register(async (ctx, next) => {
      const table = String(ctx.params["table"]); const pk = String(ctx.params["pk"]);
      await engine().data.delete(table, pk);
      ctx.reply.json(ok({ success: true }));
      return next();
    });

  // —— incr ——
  data
    .post('/:table/incr')
    .title('自增')
    .before(checkPermission('write', { tableKey: 'table' }))
    .register(async (ctx, next) => {
      const table = String(ctx.params['table']);
      const { pk, field, count } = (ctx.body ?? {}) as { pk?: string | number; field?: string; count?: number };
      if (pk === undefined || typeof field !== 'string' || typeof count !== 'number') {
        throw Errors.validationFail('pk/field/count 必填');
      }
      await engine().data.incr(table, pk, field, count);
      ctx.reply.json(ok({ success: true }));
      return next();
    });
}
