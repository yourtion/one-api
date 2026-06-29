import { Errors } from '@1api/shared';
import { ok } from '../utils/response.js';
import { createAdminStore, type AdminRow } from '../middlewares/admin-store.js';
import { hashPassword } from '../utils/password.js';
import { requireAdmin, type CurrentAdmin } from '../hooks.js';
import type { RouteDeps } from './table.js';

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

/**
 * 管理员管理 /api/admin/admins（admin 组，session 鉴权）。
 * 新建/重置密码强制 must_change_password=1；不可删自己。
 */
export function registerAdminRoutes(deps: RouteDeps): void {
  const admin = deps.api.group('admin').before(requireAdmin(deps.systemDb));
  const store = createAdminStore(deps.systemDb);

  admin.get('/admins').title('管理员列表').register(async (ctx, next) => {
    const rows = await store.list();
    ctx.reply.json(ok(rows.map(toVO)));
    return next();
  });

  admin.post('/admins').title('新建管理员').register(async (ctx, next) => {
    const body = (ctx.body ?? {}) as { name?: string; nickname?: string; password?: string };
    if (typeof body.name !== 'string' || typeof body.nickname !== 'string' || typeof body.password !== 'string') {
      throw Errors.validationFail('name/nickname/password 必填');
    }
    const row = await store.insert({
      name: body.name,
      nickname: body.nickname,
      passwordHash: hashPassword(body.password),
      mustChangePassword: 1,
    });
    ctx.reply.status(201).json(ok(toVO(row)));
    return next();
  });

  admin.put('/admins/:id').title('更新管理员').register(async (ctx, next) => {
    const id = Number(ctx.params['id']);
    const body = (ctx.body ?? {}) as { nickname?: string; password?: string };
    if (body.nickname !== undefined) await store.updateProfile(id, { nickname: body.nickname });
    if (body.password !== undefined) {
      await store.updatePassword(id, hashPassword(body.password));
      await store.setMustChangePassword(id, 1); // 重置密码强制改密
    }
    ctx.reply.json(ok({ success: true }));
    return next();
  });

  admin.delete('/admins/:id').title('删除管理员').register(async (ctx, next) => {
    const id = Number(ctx.params['id']);
    const cu = ctx.state['currentUser'] as CurrentAdmin | undefined;
    if (cu?.id === id) throw Errors.validationFail('不可删除自己');
    await store.delete(id);
    ctx.reply.json(ok({ success: true }));
    return next();
  });
}
