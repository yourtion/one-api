import { z } from 'erest';
import { Errors } from '@1api/shared';
import { createAdminStore, type AdminRow } from '../middlewares/admin-store.js';
import { hashPassword } from '../utils/password.js';
import { requireAdmin } from '../hooks.js';
import type { AppApi } from '../api/instance.js';
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
export function registerAdminRoutes(api: AppApi): void {
  const admin = api.group('admin').before(requireAdmin(getSystemDb()));
  const store = createAdminStore(getSystemDb());

  admin.get('/admins').title('管理员列表').example({
    name: '获取全部管理员',
    input: {},
    output: { rows: [{ id: 1, name: 'admin', nickname: '管理员', must_change_password: 0, created_at: 1700000000, updated_at: 1700000000 }] },
  }).registerTyped({}, async () => {
    const rows = await store.list();
    return rows.map(toVO);
  });

  admin.post('/admins').title('新建管理员').example({
    name: '新建管理员（首登需改密）',
    input: { name: 'ops', nickname: '运维', password: 'init123' },
    output: { id: 2, name: 'ops', nickname: '运维', must_change_password: 1, created_at: 1700000000, updated_at: 1700000000 },
  }).registerTyped(
    { body: z.object({ name: z.string(), nickname: z.string(), password: z.string().min(6) }) },
    async (req) => {
      const row = await store.insert({
        name: req.body.name,
        nickname: req.body.nickname,
        passwordHash: hashPassword(req.body.password),
        mustChangePassword: 1,
      });
      return toVO(row);
    },
  );

  admin.put('/admins/:id').title('更新管理员').example({
    name: '更新昵称与重置密码',
    path: '/admins/2',
    input: { nickname: '运维同学', password: 'newpass789' },
    output: { success: true },
  }).registerTyped(
    { params: IdParam, body: z.object({ nickname: z.string().optional(), password: z.string().min(6).optional() }) },
    async (req) => {
      const { id } = req.params;
      if (req.body.nickname !== undefined) await store.updateProfile(id, { nickname: req.body.nickname });
      if (req.body.password !== undefined) {
        await store.updatePassword(id, hashPassword(req.body.password));
        await store.setMustChangePassword(id, 1); // 重置密码强制改密
      }
      return { success: true };
    },
  );

  admin.delete('/admins/:id').title('删除管理员').example({
    name: '删除指定管理员（不可删自己）',
    path: '/admins/2',
    input: {},
    output: { success: true },
  }).registerTyped(
    { params: IdParam },
    async (req, ctx) => {
      const { id } = req.params;
      const cu = ctx.state.currentUser;
      if (cu?.id === id) throw Errors.validationFail('不可删除自己');
      await store.delete(id);
      return { success: true };
    },
  );
}
