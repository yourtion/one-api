import type { Kysely } from 'kysely';
import { Errors } from '@1api/shared';
import type { ServerSystemDB } from '../db/types.js';
import type { AppContext } from '../types/context.js';
import { createAdminStore } from './admin-store.js';

/**
 * 管理通道鉴权（工厂）。校验 session 已登录（adminId），否则抛 UNAUTHORIZED；
 * 注入 ctx.currentUser。所有 /api/admin/* 路由前置（erest .before 挂载）。
 *
 * 单参数中间件：抛出的 AppError 由全局 errorMiddleware 捕获（不走 err 形参链）。
 */
export function requireAdmin(systemDb: Kysely<ServerSystemDB>) {
  const store = createAdminStore(systemDb);
  return async function requireAdminMiddleware(ctx: AppContext): Promise<void> {
    const adminId = ctx.request.session['adminId'];
    if (typeof adminId !== 'number') throw Errors.unauthorized();
    const admin = await store.findById(adminId);
    if (!admin) throw Errors.unauthorized();
    ctx.currentUser = {
      id: admin.id,
      name: admin.name,
      nickname: admin.nickname,
      mustChangePassword: admin.must_change_password === 1,
    };
    ctx.next();
  };
}
