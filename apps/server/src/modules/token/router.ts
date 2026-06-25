import type { Kysely } from 'kysely';
import { z } from 'erest';
import * as web from '@leizm/web';
import type { ServerSystemDB } from '../../db/types.js';
import { AppApplication, AppRouter, type Middleware } from '../../types/context.js';
import { createApi } from '../../api.js';
import { ok } from '../../utils/response.js';
import { createTokenStore, tokenToListVO, tokenToCreateVO } from '../../middlewares/token-crud.js';
import { requireAdmin } from '../../middlewares/session-auth.js';
import { sessionMiddleware } from '../../middlewares/session-store.js';

export interface RegisterTokenOpts {
  systemDb: Kysely<ServerSystemDB>;
  sessionSecret: string;
}

const PermissionsSchema = z.object({
  tables: z.array(z.string()),
  actions: z.array(z.enum(['read', 'write', 'schema'])),
});

/** Token 管理 /api/admin/tokens（session 鉴权）。明文仅创建时返回一次，列表只显 prefix。 */
export function registerTokenRoutes(app: AppApplication, opts: RegisterTokenOpts): void {
  const router = new AppRouter();
  const auth = requireAdmin(opts.systemDb);
  const api = createApi();
  const store = createTokenStore(opts.systemDb);

  router.use('/', web.component.cookieParser(opts.sessionSecret) as unknown as Middleware);
  router.use('/', sessionMiddleware as unknown as Middleware);
  router.use('/', web.component.bodyParser.json() as unknown as Middleware);
  router.use('/', web.component.bodyParser.urlencoded({ extended: true }) as unknown as Middleware);

  api.api.get('/admin/tokens').group('token').title('Token 列表').before(auth).register(
    (async (ctx) => {
      const rows = await store.list();
      ctx.response.json(ok(rows.map(tokenToListVO)));
    }) as Middleware,
  );

  api.api
    .post('/admin/tokens')
    .group('token')
    .title('创建 Token')
    .before(auth)
    .body(z.object({ name: z.string(), permissions: PermissionsSchema }))
    .register(
      (async (ctx) => {
        const { name, permissions } = ctx.paramsInput as {
          name: string;
          permissions: { tables: string[]; actions: string[] };
        };
        const { row, plain } = await store.create({
          name,
          permissions: { tables: permissions.tables, actions: permissions.actions as Array<'read' | 'write' | 'schema'> },
        });
        ctx.response.status(201).json(ok(tokenToCreateVO(row, plain)));
      }) as Middleware,
    );

  api.api
    .put('/admin/tokens/:id')
    .group('token')
    .title('更新 Token')
    .before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(
      z.object({
        name: z.string().optional(),
        permissions: PermissionsSchema.optional(),
        isActive: z.boolean().optional(),
        expiresAt: z.number().nullable().optional(),
      }),
    )
    .register(
      (async (ctx) => {
        const { id } = ctx.paramsInput as { id: number };
        const body = ctx.paramsInput as {
          name?: string;
          permissions?: { tables: string[]; actions: string[] };
          isActive?: boolean;
          expiresAt?: number | null;
        };
        const patch: {
          name?: string;
          permissions?: { tables: string[]; actions: Array<'read' | 'write' | 'schema'> };
          isActive?: boolean;
          expiresAt?: number | null;
        } = {};
        if (body.name !== undefined) patch.name = body.name;
        if (body.permissions !== undefined)
          patch.permissions = {
            tables: body.permissions.tables,
            actions: body.permissions.actions as Array<'read' | 'write' | 'schema'>,
          };
        if (body.isActive !== undefined) patch.isActive = body.isActive;
        // exactOptionalPropertyTypes：expiresAt 用 has 判断（null 合法，undefined 不赋）
        if (Object.prototype.hasOwnProperty.call(body, 'expiresAt') && body.expiresAt !== undefined) {
          patch.expiresAt = body.expiresAt;
        }
        await store.update(id, patch);
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  api.api
    .delete('/admin/tokens/:id')
    .group('token')
    .title('删除 Token')
    .before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register(
      (async (ctx) => {
        const { id } = ctx.paramsInput as { id: number };
        await store.delete(id);
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  api.bindRouter(router, api.checkerLeiWeb);
  app.use('/api', router);
}
