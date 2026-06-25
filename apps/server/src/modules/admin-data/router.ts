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
import { requireAdmin } from '../../middlewares/session-auth.js';
import { sessionMiddleware } from '../../middlewares/session-store.js';

export interface RegisterAdminDataOpts {
  systemDb: Kysely<ServerSystemDB>;
  sessionSecret: string;
}

/** 管理员数据浏览 /api/admin/tables/:id/data（internal 通道 CRUD + 导出）。:id 为 table_meta id。 */
export function registerAdminDataRoutes(app: AppApplication, opts: RegisterAdminDataOpts): void {
  const router = new AppRouter();
  const auth = requireAdmin(opts.systemDb);
  const api = createApi();
  const engine = () => getEngine();
  const INTERNAL = { internal: true } as const;

  router.use('/', web.component.cookieParser(opts.sessionSecret) as unknown as Middleware);
  router.use('/', sessionMiddleware as unknown as Middleware);
  router.use('/', web.component.bodyParser.json() as unknown as Middleware);
  router.use('/', web.component.bodyParser.urlencoded({ extended: true }) as unknown as Middleware);

  async function resolveName(id: number): Promise<string> {
    const meta = await engine().metadata.getMeta(id);
    if (!meta) throw Errors.tableNotFound(String(id));
    return meta.name;
  }

  api.api
    .get('/admin/tables/:id/data')
    .group('admin-data')
    .title('数据列表')
    .before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register(
      (async (ctx) => {
        const { id } = ctx.paramsInput as { id: number };
        const name = await resolveName(id);
        const listOpts = parseListQuery(ctx.request.query as Record<string, unknown>);
        ctx.response.json(ok(await engine().data.list(name, listOpts, INTERNAL)));
      }) as Middleware,
    );

  api.api
    .get('/admin/tables/:id/export')
    .group('admin-data')
    .title('导出 CSV')
    .before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register(
      (async (ctx) => {
        const { id } = ctx.paramsInput as { id: number };
        const name = await resolveName(id);
        const listOpts = parseListQuery(ctx.request.query as Record<string, unknown>);
        const result = await engine().data.list(name, { ...listOpts, page: 1, size: 10000 }, INTERNAL);
        const meta = await engine().metadata.getMeta(id);
        const cols = (meta?.fields ?? []).map((f) => f.name);
        const header = cols.join(',');
        const lines = result.rows.map((r) => cols.map((c) => csvCell(r[c])).join(','));
        ctx.response.setHeader('content-type', 'text/csv; charset=utf-8');
        ctx.response.setHeader('content-disposition', `attachment; filename="${name}.csv"`);
        ctx.response.html([header, ...lines].join('\n'));
      }) as Middleware,
    );

  api.api
    .get('/admin/tables/:id/data/:pk')
    .group('admin-data')
    .title('单条')
    .before(auth)
    .params(z.object({ id: z.coerce.number(), pk: z.string() }))
    .register(
      (async (ctx) => {
        const { id, pk } = ctx.paramsInput as { id: number; pk: string };
        const name = await resolveName(id);
        const row = await engine().data.get(name, pk, INTERNAL);
        if (!row) throw Errors.tableNotFound(name);
        ctx.response.json(ok(row));
      }) as Middleware,
    );

  api.api
    .post('/admin/tables/:id/data')
    .group('admin-data')
    .title('新增')
    .before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(z.record(z.string(), z.unknown()))
    .register(
      (async (ctx) => {
        const { id } = ctx.paramsInput as { id: number };
        const name = await resolveName(id);
        // erest $params 把 params 与 body 合并到顶层；body = 除路由参数 id 外的字段
        const data = extractBody(ctx.paramsInput, ['id']);
        const row = await engine().data.create(name, data, INTERNAL);
        ctx.response.status(201).json(ok(row));
      }) as Middleware,
    );

  api.api
    .put('/admin/tables/:id/data/:pk')
    .group('admin-data')
    .title('修改')
    .before(auth)
    .params(z.object({ id: z.coerce.number(), pk: z.string() }))
    .body(z.record(z.string(), z.unknown()))
    .register(
      (async (ctx) => {
        const { id, pk } = ctx.paramsInput as { id: number; pk: string };
        const name = await resolveName(id);
        const patch = extractBody(ctx.paramsInput, ['id', 'pk']);
        await engine().data.update(name, pk, patch, INTERNAL);
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  api.api
    .delete('/admin/tables/:id/data/:pk')
    .group('admin-data')
    .title('删除')
    .before(auth)
    .params(z.object({ id: z.coerce.number(), pk: z.string() }))
    .register(
      (async (ctx) => {
        const { id, pk } = ctx.paramsInput as { id: number; pk: string };
        const name = await resolveName(id);
        await engine().data.delete(name, pk, INTERNAL);
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  api.bindRouter(router, api.checkerLeiWeb);
  app.use('/api', router);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 从 erest $params（params + body 合并到顶层）中提取 body 字段。
 * @param params ctx.paramsInput（{ id, pk, ...bodyFields }）
 * @param exclude 需排除的路由参数名（如 ['id']、['id','pk']）
 */
function extractBody(params: Record<string, unknown>, exclude: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!exclude.includes(k)) body[k] = v;
  }
  return body;
}
