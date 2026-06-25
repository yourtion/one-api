import type { Kysely } from 'kysely';
import { z } from 'erest';
import * as web from '@leizm/web';
import { Errors } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import { AppApplication, AppRouter, type Middleware } from '../../types/context.js';
import { createApi } from '../../api.js';
import { ok } from '../../utils/response.js';
import { createAdminStore, type AdminRow } from '../../middlewares/admin-store.js';
import { hashPassword } from '../../utils/password.js';
import { requireAdmin } from '../../middlewares/session-auth.js';
import { sessionMiddleware } from '../../middlewares/session-store.js';

export interface RegisterAdminOpts {
  systemDb: Kysely<ServerSystemDB>;
  sessionSecret: string;
}

interface AdminVO {
  id: number;
  name: string;
  nickname: string;
  must_change_password: number;
  created_at: number;
  updated_at: number;
}

function toVO(a: AdminRow): AdminVO {
  return {
    id: a.id,
    name: a.name,
    nickname: a.nickname,
    must_change_password: a.must_change_password,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

/** 管理员管理 /api/admin/admins（session 鉴权）。新建/重置密码强制 must_change_password=1；不可删自己。 */
export function registerAdminRoutes(app: AppApplication, opts: RegisterAdminOpts): void {
  const router = new AppRouter();
  const auth = requireAdmin(opts.systemDb);
  const api = createApi();
  const store = createAdminStore(opts.systemDb);

  router.use('/', web.component.cookieParser(opts.sessionSecret) as unknown as Middleware);
  router.use('/', sessionMiddleware as unknown as Middleware);
  router.use('/', web.component.bodyParser.json() as unknown as Middleware);
  router.use('/', web.component.bodyParser.urlencoded({ extended: true }) as unknown as Middleware);

  api.api.get('/admin/admins').group('admin').title('管理员列表').before(auth).register(
    (async (ctx) => {
      const rows = await store.list();
      ctx.response.json(ok(rows.map(toVO)));
    }) as Middleware,
  );

  api.api
    .post('/admin/admins')
    .group('admin')
    .title('新建管理员')
    .before(auth)
    .body(z.object({ name: z.string(), nickname: z.string(), password: z.string().min(6) }))
    .register(
      (async (ctx) => {
        const { name, nickname, password } = ctx.request.$params as { name: string; nickname: string; password: string };
        const row = await store.insert({ name, nickname, passwordHash: hashPassword(password), mustChangePassword: 1 });
        ctx.response.status(201).json(ok(toVO(row)));
      }) as Middleware,
    );

  api.api
    .put('/admin/admins/:id')
    .group('admin')
    .title('更新管理员')
    .before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .body(z.object({ nickname: z.string().optional(), password: z.string().min(6).optional() }))
    .register(
      (async (ctx) => {
        const { id } = ctx.request.$params as { id: number };
        const body = ctx.request.$params as { nickname?: string; password?: string };
        if (body.nickname !== undefined) await store.updateProfile(id, { nickname: body.nickname });
        if (body.password !== undefined) {
          await store.updatePassword(id, hashPassword(body.password));
          await store.setMustChangePassword(id, 1); // 重置密码强制改密
        }
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  api.api
    .delete('/admin/admins/:id')
    .group('admin')
    .title('删除管理员')
    .before(auth)
    .params(z.object({ id: z.coerce.number() }))
    .register(
      (async (ctx) => {
        const { id } = ctx.request.$params as { id: number };
        if (ctx.currentUser!.id === id) throw Errors.validationFail('不可删除自己');
        await store.delete(id);
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  api.bind({ framework: "leizmweb", router });
  app.use('/api', router);
}
