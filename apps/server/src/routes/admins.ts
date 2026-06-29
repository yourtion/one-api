import type { ERest, Middleware } from 'erest';
import { z } from 'erest';
import { Errors } from '@1api/shared';
import { ok } from '../utils/response.js';
import { createAdminStore, type AdminRow } from '../middlewares/admin-store.js';
import { hashPassword } from '../utils/password.js';
import { requireAdmin, type CurrentAdmin } from '../hooks.js';
import { getSystemDb } from '../core/system-db.js';
import { IdParam } from './schemas.js';

type AdminVO = Omit<AdminRow, 'password_hash'>;

function toVO(a: AdminRow): AdminVO {
  const { password_hash: _password_hash, ...rest } = a;
  return rest;
}

/**
 * 管理员管理 /api/admin/admins（admin 组，session 鉴权）。
 * 新建/重置密码强制 must_change_password=1；不可删自己。
 */
export function registerAdminRoutes(api: ERest<Middleware>): void {
  const admin = api.group('admin').before(requireAdmin(getSystemDb()));
  const store = createAdminStore(getSystemDb());

  admin.get('/admins').title('管理员列表').registerTyped({}, async (_req, reply) => {
    const rows = await store.list();
    reply.json(ok(rows.map(toVO)));
  });

  admin.post('/admins').title('新建管理员').registerTyped(
    { body: z.object({ name: z.string(), nickname: z.string(), password: z.string().min(6) }) },
    async (req, reply) => {
      const row = await store.insert({
        name: req.body.name,
        nickname: req.body.nickname,
        passwordHash: hashPassword(req.body.password),
        mustChangePassword: 1,
      });
      reply.status(201).json(ok(toVO(row)));
    },
  );

  admin.put('/admins/:id').title('更新管理员').registerTyped(
    { params: IdParam, body: z.object({ nickname: z.string().optional(), password: z.string().min(6).optional() }) },
    async (req, reply) => {
      const { id } = req.params;
      if (req.body.nickname !== undefined) await store.updateProfile(id, { nickname: req.body.nickname });
      if (req.body.password !== undefined) {
        await store.updatePassword(id, hashPassword(req.body.password));
        await store.setMustChangePassword(id, 1); // 重置密码强制改密
      }
      reply.json(ok({ success: true }));
    },
  );

  admin.delete('/admins/:id').title('删除管理员').register(async (ctx, next) => {
    const id = Number(ctx.params['id']);
    const cu = ctx.state['currentUser'] as CurrentAdmin | undefined;
    if (cu?.id === id) throw Errors.validationFail('不可删除自己');
    await store.delete(id);
    ctx.reply.json(ok({ success: true }));
    return next();
  });
}
