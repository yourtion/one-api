import type { Kysely } from 'kysely';
import { z } from 'erest';
import * as web from '@leizm/web';
import { Errors, isReservedName, type FieldMetaInput } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import { AppApplication, AppRouter, type Middleware } from '../../types/context.js';
import { createApi } from '../../api.js';
import { ok } from '../../utils/response.js';
import { getEngine } from '../../core/engine.js';
import { requireAdmin } from '../../middlewares/session-auth.js';
import { sessionMiddleware } from '../../middlewares/session-store.js';

export interface RegisterTableOpts {
  systemDb: Kysely<ServerSystemDB>;
  sessionSecret: string;
}

function assertNotReserved(name: string): void {
  if (isReservedName(name)) throw Errors.reservedName(name);
}

/** 表管理 /api/admin/tables（session 鉴权，internal 不适用——纯元数据操作） */
export function registerTableRoutes(app: AppApplication, opts: RegisterTableOpts): void {
  const router = new AppRouter();
  const auth = requireAdmin(opts.systemDb);
  const api = createApi();
  const engine = () => getEngine();

  // session/body 前置（session 用全局共享 store，与 auth 组共用登录态）
  router.use('/', web.component.cookieParser(opts.sessionSecret) as unknown as Middleware);
  router.use('/', sessionMiddleware as unknown as Middleware);
  router.use('/', web.component.bodyParser.json() as unknown as Middleware);
  router.use('/', web.component.bodyParser.urlencoded({ extended: true }) as unknown as Middleware);

  api.api.get('/admin/tables').group('table').title('表列表').before(auth).register(
    (async (ctx) => {
      ctx.response.json(ok(await engine().metadata.listMetas()));
    }) as Middleware,
  );

  api.api
    .get('/admin/tables/:id')
    .group('table')
    .title('表详情')
    .before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register(
      (async (ctx) => {
        const { id } = ctx.request.$params as { id: number };
        const meta = await engine().metadata.getMeta(id);
        if (!meta) throw Errors.tableNotFound(String(id));
        ctx.response.json(ok(meta));
      }) as Middleware,
    );

  api.api
    .post('/admin/tables/import')
    .group('table')
    .title('导入已有表')
    .before(auth)
    .body(z.object({ name: z.string() }))
    .register(
      (async (ctx) => {
        const { name } = ctx.request.$params as { name: string };
        assertNotReserved(name);
        const meta = await engine().schema.importExisting(name);
        ctx.response.status(201).json(ok(meta));
      }) as Middleware,
    );

  api.api
    .post('/admin/tables')
    .group('table')
    .title('新建模型')
    .before(auth)
    .body(
      z.object({
        name: z.string(),
        label: z.string(),
        fields: z.array(z.record(z.string(), z.unknown())),
        note: z.string().nullable().optional(),
        autoTimestamps: z.boolean().optional(),
      }),
    )
    .register(
      (async (ctx) => {
        const input = ctx.request.$params as {
          name: string;
          label: string;
          fields: Record<string, unknown>[];
          note?: string | null;
          autoTimestamps?: boolean;
        };
        assertNotReserved(input.name);
        const opts2: {
          name: string;
          label: string;
          fields: FieldMetaInput[];
          note?: string | null;
          autoTimestamps?: boolean;
        } = { name: input.name, label: input.label, fields: input.fields as unknown as FieldMetaInput[] };
        if (input.note !== undefined) opts2.note = input.note;
        if (input.autoTimestamps !== undefined) opts2.autoTimestamps = input.autoTimestamps;
        const meta = await engine().schema.createModel(opts2);
        ctx.response.status(201).json(ok(meta));
      }) as Middleware,
    );

  api.api
    .put('/admin/tables/:id')
    .group('table')
    .title('更新元数据')
    .before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(
      z.object({
        label: z.string().optional(),
        note: z.string().nullable().optional(),
        isPublished: z.boolean().optional(),
        isEditable: z.boolean().optional(),
      }),
    )
    .register(
      (async (ctx) => {
        const { id } = ctx.request.$params as { id: number };
        const body = ctx.request.$params as {
          label?: string;
          note?: string | null;
          isPublished?: boolean;
          isEditable?: boolean;
        };
        const patch: Record<string, unknown> = {};
        if (body.label !== undefined) patch['label'] = body.label;
        if (body.note !== undefined) patch['note'] = body.note;
        if (body.isPublished !== undefined) patch['isPublished'] = body.isPublished;
        if (body.isEditable !== undefined) patch['isEditable'] = body.isEditable;
        await engine().metadata.updateMeta(id, patch);
        ctx.response.json(ok(await engine().metadata.getMeta(id)));
      }) as Middleware,
    );

  api.api
    .post('/admin/tables/:id/refresh')
    .group('table')
    .title('刷新表结构')
    .before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register(
      (async (ctx) => {
        const { id } = ctx.request.$params as { id: number };
        const meta = await engine().metadata.getMeta(id);
        if (!meta) throw Errors.tableNotFound(String(id));
        ctx.response.json(ok(await engine().schema.refresh(meta.name)));
      }) as Middleware,
    );

  api.api
    .delete('/admin/tables/:id')
    .group('table')
    .title('取消注册')
    .before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(z.object({ confirm: z.boolean() }))
    .register(
      (async (ctx) => {
        const { id } = ctx.request.$params as { id: number };
        const { confirm } = ctx.request.$params as { confirm: boolean };
        if (!confirm) throw Errors.validationFail('需 confirm:true 确认');
        await engine().metadata.deleteMeta(id);
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  api.bind({ framework: "leizmweb", router });
  app.use('/api', router);
}
