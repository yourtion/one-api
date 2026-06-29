import type { ERest, Middleware } from 'erest';
import { z } from 'erest';
import { Errors } from '@1api/shared';
import { createAdminStore, type AdminRow } from '../middlewares/admin-store.js';
import { createTokenStore } from '../middlewares/token-crud.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { ok } from '../utils/response.js';
import { requireAdmin, type CurrentAdmin } from '../hooks.js';
import { getSystemDb } from '../core/system-db.js';

function toAdminVO(a: AdminRow): CurrentAdmin {
  return { id: a.id, name: a.name, nickname: a.nickname, mustChangePassword: a.must_change_password === 1 };
}

/**
 * 注册 /api/auth/*（全 erest，无原生路由、无 session）。
 *
 * login：校验 name/password → 签发一个 admin token（permissions.admin=true）→ 返回明文 token。
 *        客户端后续用 `Authorization: Bearer oa_...` 访问 admin 通道。
 * me/password：before(requireAdmin)（admin token 鉴权）。
 * logout：无状态 token，仅 no-op 返回成功（撤销名单后续增强）。
 *
 * 路径相对 auth 组前缀 /auth（erest 挂在 /api router 下 → /api/auth/*）。
 */
export function registerAuthRoutes(api: ERest<Middleware>): void {
  const store = createAdminStore(getSystemDb());
  const tokenStore = createTokenStore(getSystemDb());
  const auth = api.group('auth');

  auth.post('/login').title('登录').registerTyped(
    { body: z.object({ name: z.string(), password: z.string() }) },
    async (req, reply) => {
      const { name, password } = req.body;
      const admin = await store.findByName(name);
      if (!admin || !comparePassword(password, admin.password_hash)) throw Errors.authInvalidCredentials();
      // 签发 admin token（permissions.admin=true + adminId 关联）
      const { plain } = await tokenStore.create({
        name: `admin:${admin.name}`,
        permissions: { tables: ['*'], actions: ['read', 'write', 'schema'], admin: true, adminId: admin.id },
      });
      reply.json(ok({ token: plain, admin: toAdminVO(admin), mustChangePassword: admin.must_change_password === 1 }));
    },
  );

  auth.get('/me').title('当前管理员').before(requireAdmin(getSystemDb())).register(async (ctx, next) => {
    const cu = ctx.state['currentUser'] as CurrentAdmin;
    const admin = await store.findById(cu.id);
    if (!admin) throw Errors.unauthorized();
    ctx.reply.json(ok(toAdminVO(admin)));
    return next();
  });

  auth.put('/password').title('修改密码').before(requireAdmin(getSystemDb())).register(async (ctx, next) => {
    const cu = ctx.state['currentUser'] as CurrentAdmin;
    const { oldPassword, newPassword } = z
      .object({ oldPassword: z.string(), newPassword: z.string().min(6) })
      .parse(ctx.body ?? {});
    const admin = await store.findById(cu.id);
    if (!admin || !comparePassword(oldPassword, admin.password_hash)) throw Errors.authInvalidCredentials();
    await store.updatePassword(admin.id, hashPassword(newPassword));
    await store.setMustChangePassword(admin.id, 0);
    ctx.reply.json(ok({ success: true }));
    return next();
  });

  auth.post('/logout').title('登出').before(requireAdmin(getSystemDb())).registerTyped({}, async (_req, reply) => {
    // 无状态 token：logout 仅返回成功。撤销名单（token 黑名单）后续增强。
    reply.json(ok({ success: true }));
  });
}
