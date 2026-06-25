import type { Kysely } from 'kysely';
import { z } from 'erest';
import * as web from '@leizm/web';
import { Errors } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import { AppApplication, AppRouter, type Middleware } from '../../types/context.js';
import { createApi } from '../../api.js';
import { ok } from '../../utils/response.js';
import { getEngine } from '../../core/engine.js';
import { parseListQuery } from '../../utils/list-query.js';
import { createRequireToken, createCheckPermission } from '../../middlewares/token-auth.js';
import { corsForData } from '../../middlewares/cors.js';

export interface RegisterDataOpts {
  systemDb: Kysely<ServerSystemDB>;
}

/** 对外数据 CRUD /api/data/:table（Token 鉴权，默认 internal:false → 校验 is_published/is_editable） */
export function registerDataRoutes(app: AppApplication, opts: RegisterDataOpts): void {
  const router = new AppRouter();
  const requireToken = createRequireToken(opts.systemDb);
  const api = createApi();
  const engine = () => getEngine();

  // CORS + body（对外通道无需 session）
  router.use('/', corsForData());
  router.use('/', web.component.bodyParser.json() as unknown as Middleware);
  router.use('/', web.component.bodyParser.urlencoded({ extended: true }) as unknown as Middleware);

  // —— list ——
  api.api
    .get('/data/:table')
    .group('data')
    .title('列表')
    .before(requireToken)
    .before(createCheckPermission('read'))
    .register(
      (async (ctx) => {
        const table = String(ctx.request.params['table']);
        const listOpts = parseListQuery(ctx.request.query as Record<string, unknown>);
        ctx.response.json(ok(await engine().data.list(table, listOpts)));
      }) as Middleware,
    );

  // —— schema（表结构，保留段，不与合法表名冲突——表名正则不允许下划线开头）——
  api.api
    .get('/data/:table/schema')
    .group('data')
    .title('表结构')
    .before(requireToken)
    .before(createCheckPermission('read'))
    .register(
      (async (ctx) => {
        const table = String(ctx.request.params['table']);
        ctx.response.json(ok(await engine().data.describe(table)));
      }) as Middleware,
    );

  // —— get ——
  api.api
    .get('/data/:table/records/:pk')
    .group('data')
    .title('单条')
    .before(requireToken)
    .before(createCheckPermission('read'))
    .params(z.object({ table: z.string(), pk: z.string() }))
    .register(
      (async (ctx) => {
        const { table, pk } = ctx.request.$params as { table: string; pk: string };
        const row = await engine().data.get(table, pk);
        if (!row) throw Errors.tableNotFound(table);
        ctx.response.json(ok(row));
      }) as Middleware,
    );

  // —— create ——（body 字段在 $params 顶层，排除路由参数）
  api.api
    .post('/data/:table/records')
    .group('data')
    .title('创建')
    .before(requireToken)
    .before(createCheckPermission('write'))
    .params(z.object({ table: z.string() }))
    .body(z.record(z.string(), z.unknown()))
    .register(
      (async (ctx) => {
        const { table } = ctx.request.$params as { table: string };
        const data = extractBody(ctx.request.$params, ['table']);
        ctx.response.status(201).json(ok(await engine().data.create(table, data)));
      }) as Middleware,
    );

  // —— update ——
  api.api
    .put('/data/:table/records/:pk')
    .group('data')
    .title('更新')
    .before(requireToken)
    .before(createCheckPermission('write'))
    .params(z.object({ table: z.string(), pk: z.string() }))
    .body(z.record(z.string(), z.unknown()))
    .register(
      (async (ctx) => {
        const { table, pk } = ctx.request.$params as { table: string; pk: string };
        const patch = extractBody(ctx.request.$params, ['table', 'pk']);
        await engine().data.update(table, pk, patch);
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  // —— delete ——
  api.api
    .delete('/data/:table/records/:pk')
    .group('data')
    .title('删除')
    .before(requireToken)
    .before(createCheckPermission('write'))
    .params(z.object({ table: z.string(), pk: z.string() }))
    .register(
      (async (ctx) => {
        const { table, pk } = ctx.request.$params as { table: string; pk: string };
        await engine().data.delete(table, pk);
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  // —— incr ——
  api.api
    .post('/data/:table/incr')
    .group('data')
    .title('自增')
    .before(requireToken)
    .before(createCheckPermission('write'))
    .params(z.object({ table: z.string() }))
    .body(z.object({ pk: z.union([z.string(), z.number()]), field: z.string(), count: z.number() }))
    .register(
      (async (ctx) => {
        const { table } = ctx.request.$params as { table: string };
        const { pk, field, count } = ctx.request.$params as { pk: string | number; field: string; count: number };
        await engine().data.incr(table, pk, field, count);
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  api.bind({ framework: "leizmweb", router });
  app.use('/api', router);
}

/** 从 erest $params（params + body 合并到顶层）中提取 body 字段，排除路由参数 */
function extractBody(params: Record<string, unknown>, exclude: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!exclude.includes(k)) body[k] = v;
  }
  return body;
}
