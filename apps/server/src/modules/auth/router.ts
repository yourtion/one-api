import type { Kysely } from 'kysely';
import { z } from 'erest';
import * as web from '@leizm/web';
import { Errors } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import { AppApplication, AppRouter, type Middleware } from '../../types/context.js';
import { createApi } from '../../api.js';
import { ok } from '../../utils/response.js';
import { comparePassword, hashPassword } from '../../utils/password.js';
import { createAdminStore, type AdminRow } from '../../middlewares/admin-store.js';
import { requireAdmin } from '../../middlewares/session-auth.js';
import { sessionMiddleware } from '../../middlewares/session-store.js';

export interface RegisterAuthOpts {
  systemDb: Kysely<ServerSystemDB>;
  sessionSecret: string;
}

function toAdminVO(a: AdminRow) {
  return {
    id: a.id,
    name: a.name,
    nickname: a.nickname,
    mustChangePassword: a.must_change_password === 1,
  };
}

/**
 * 注册 /api/auth/* 路由组：login/logout/me/password。
 * 建 cookieParser/session/body 前置中间件 + erest 定义 + bindRouter（checkerLeiWeb），挂到 app /api。
 * 使用独立 erest 实例（createApi），避免跨组污染与测试重复注册。
 * session 用全局共享 store（与 admin 路由组共用，否则登录态无法跨组读取）。
 */
export function registerAuthRoutes(app: AppApplication, opts: RegisterAuthOpts): void {
  const router = new AppRouter();
  const store = createAdminStore(opts.systemDb);
  const api = createApi();

  // 前置中间件：cookieParser + 共享 session + body
  router.use('/', web.component.cookieParser(opts.sessionSecret) as unknown as Middleware);
  router.use('/', sessionMiddleware as unknown as Middleware);
  router.use('/', web.component.bodyParser.json() as unknown as Middleware);
  router.use('/', web.component.bodyParser.urlencoded({ extended: true }) as unknown as Middleware);

  // —— login ——
  api.api
    .post('/auth/login')
    .group('auth')
    .title('登录')
    .body(z.object({ name: z.string(), password: z.string() }))
    .register(
      (async (ctx) => {
        const { name, password } = ctx.paramsInput as { name: string; password: string };
        const admin = await store.findByName(name);
        if (!admin || !comparePassword(password, admin.password_hash)) throw Errors.authInvalidCredentials();
        ctx.request.session['adminId'] = admin.id;
        ctx.response.json(ok({ admin: toAdminVO(admin), mustChangePassword: admin.must_change_password === 1 }));
      }) as Middleware,
    );

  // —— logout ——
  api.api
    .post('/auth/logout')
    .group('auth')
    .title('登出')
    .before(requireAdmin(opts.systemDb))
    .register(
      (async (ctx) => {
        await ctx.session.destroy();
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  // —— me ——
  api.api
    .get('/auth/me')
    .group('auth')
    .title('当前管理员')
    .before(requireAdmin(opts.systemDb))
    .register(
      (async (ctx) => {
        const admin = await store.findById(ctx.currentUser!.id);
        if (!admin) throw Errors.unauthorized();
        ctx.response.json(ok(toAdminVO(admin)));
      }) as Middleware,
    );

  // —— password ——
  api.api
    .put('/auth/password')
    .group('auth')
    .title('修改密码')
    .before(requireAdmin(opts.systemDb))
    .body(z.object({ oldPassword: z.string(), newPassword: z.string().min(6) }))
    .register(
      (async (ctx) => {
        const { oldPassword, newPassword } = ctx.paramsInput as { oldPassword: string; newPassword: string };
        const admin = await store.findById(ctx.currentUser!.id);
        if (!admin || !comparePassword(oldPassword, admin.password_hash)) throw Errors.authInvalidCredentials();
        await store.updatePassword(admin.id, hashPassword(newPassword));
        await store.setMustChangePassword(admin.id, 0);
        ctx.response.json(ok({ success: true }));
      }) as Middleware,
    );

  api.bindRouter(router, api.checkerLeiWeb);
  app.use('/api', router);
}
