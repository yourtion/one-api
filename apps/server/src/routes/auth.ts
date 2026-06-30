import { z } from 'erest';
import { Errors } from '@1api/shared';
import { createAdminStore, type AdminRow } from '../middlewares/admin-store.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { requireAdmin, type CurrentAdmin } from '../hooks.js';
import type { AppApi } from '../api/instance.js';
import { getSystemDb } from '../core/system-db.js';
import { SESSION_NAME } from '../middlewares/session.js';

function toAdminVO(a: AdminRow): CurrentAdmin {
  return { id: a.id, name: a.name, nickname: a.nickname, mustChangePassword: a.must_change_password === 1 };
}

/**
 * 注册 /api/auth/*（全 erest registerTyped + envelope return 模式）。
 *
 * login：校验 name/password → 建 @leizm/web session（regenerate 防 session 固定）→ 写 adminId。
 *        客户端后续请求自动带 cookie（admin 通道鉴权由 session 完成，无 Bearer token）。
 * me/password：before(requireAdmin)（session 鉴权）。
 * logout：销毁 session + 清除 cookie，凭证立即失效。
 *
 * 路径相对 auth 组前缀 /auth（erest 挂在 /api router 下 → /api/auth/*）。
 */
export function registerAuthRoutes(api: AppApi): void {
  const store = createAdminStore(getSystemDb());
  const auth = api.group('auth');

  auth.post('/login').title('登录').registerTyped(
    { body: z.object({ name: z.string(), password: z.string() }) },
    async (req, ctx) => {
      const { name, password } = req.body;
      const admin = await store.findByName(name);
      if (!admin || !comparePassword(password, admin.password_hash)) throw Errors.authInvalidCredentials();
      // 建 session：regenerate 轮换 SID（防 session 固定攻击），写入 adminId
      const sess = ctx.reply.raw.session;
      await sess.regenerate();
      sess.data['adminId'] = admin.id;
      return { admin: toAdminVO(admin), mustChangePassword: admin.must_change_password === 1 };
    },
  );

  auth.get('/me').title('当前管理员').before(requireAdmin(getSystemDb())).registerTyped({}, async (_req, ctx) => {
    const user = ctx.state.currentUser;
    if (!user) throw Errors.unauthorized();
    const admin = await store.findById(user.id);
    if (!admin) throw Errors.unauthorized();
    return toAdminVO(admin);
  });

  auth.put('/password').title('修改密码').before(requireAdmin(getSystemDb())).registerTyped(
    { body: z.object({ oldPassword: z.string(), newPassword: z.string().min(6) }) },
    async (req, ctx) => {
      const user = ctx.state.currentUser;
      if (!user) throw Errors.unauthorized();
      const admin = await store.findById(user.id);
      if (!admin || !comparePassword(req.body.oldPassword, admin.password_hash)) throw Errors.authInvalidCredentials();
      await store.updatePassword(admin.id, hashPassword(req.body.newPassword));
      await store.setMustChangePassword(admin.id, 0);
      return { success: true };
    },
  );

  auth.post('/logout').title('登出').before(requireAdmin(getSystemDb())).registerTyped({}, async (_req, ctx) => {
    // 销毁 session 存储 + 清除客户端 cookie，凭证立即失效
    await ctx.reply.raw.session.destroy();
    ctx.reply.raw.response.clearCookie(SESSION_NAME);
    return { success: true };
  });
}
