import type { ERest, Middleware } from 'erest';
import { z } from 'erest';
import { createTokenStore, tokenToListVO, tokenToCreateVO } from '../middlewares/token-crud.js';
import { requireAdmin } from '../hooks.js';
import { getSystemDb } from '../core/system-db.js';
import { PermissionsSchema, IdParam } from './schemas.js';

/**
 * Token 管理 /api/admin/tokens（admin 组，session 鉴权）。
 * 明文仅创建时返回一次；列表只显 prefix；token_hash 不外泄。
 */
export function registerTokenRoutes(api: ERest<Middleware>): void {
  const admin = api.group('admin').before(requireAdmin(getSystemDb()));
  const store = createTokenStore(getSystemDb());

  admin.get('/tokens').title('Token 列表').example({
    name: '获取全部 Token',
    input: {},
    output: { rows: [{ id: 1, name: '前端读', token_prefix: 'oa_a3f9', permissions: { tables: ['users'], actions: ['read'] }, is_active: true, expires_at: null, last_used_at: null, created_at: 1700000000, updated_at: 1700000000 }] },
  }).registerTyped({}, async () => {
    const rows = await store.list();
    return rows.map(tokenToListVO);  });

  admin.post('/tokens').title('创建 Token').example({
    name: '创建可读 users 表的 Token',
    input: { name: '前端读', permissions: { tables: ['users'], actions: ['read'] } },
    output: { id: 1, name: '前端读', token: 'oa_a3f9c2e8b1d7e6f5a4b3c2d1', tokenPrefix: 'oa_a3f9', permissions: { tables: ['users'], actions: ['read'] } },
  }).registerTyped(
    {
      body: z.object({
        name: z.string(),
        permissions: PermissionsSchema,
      }),
    },
    async (req) => {
      const { row, plain } = await store.create({
        name: req.body.name,
        permissions: {
          tables: req.body.permissions.tables,
          actions: req.body.permissions.actions,
        },
      });
    return tokenToCreateVO(row, plain);    },
  );

  admin.put('/tokens/:id').title('更新 Token').example({
    name: '停用 Token',
    path: '/tokens/1',
    input: { isActive: false },
    output: { success: true },
  }).registerTyped(
    {
      params: IdParam,
      body: z.object({
        name: z.string().optional(),
        permissions: PermissionsSchema.optional(),
        isActive: z.boolean().optional(),
        expiresAt: z.union([z.number(), z.null()]).optional(),
      }),
    },
    async (req) => {
      const patch: {
        name?: string;
        permissions?: { tables: string[]; actions: ('read' | 'write' | 'schema')[] };
        isActive?: boolean;
        expiresAt?: number | null;
      } = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.permissions !== undefined)
        patch.permissions = { tables: req.body.permissions.tables, actions: req.body.permissions.actions };
      if (req.body.isActive !== undefined) patch.isActive = req.body.isActive;
      if (req.body.expiresAt !== undefined) patch.expiresAt = req.body.expiresAt;
      await store.update(req.params.id, patch);
    return { success: true };    },
  );

  admin.delete('/tokens/:id').title('删除 Token').example({
    name: '删除 Token',
    path: '/tokens/1',
    input: {},
    output: { success: true },
  }).registerTyped(
    { params: IdParam },
    async (req) => {
      await store.delete(req.params.id);
    return { success: true };    },
  );
}
