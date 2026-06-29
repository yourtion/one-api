import { Errors } from '@1api/shared';
import { ok } from '../utils/response.js';
import { createTokenStore, tokenToListVO, tokenToCreateVO } from '../middlewares/token-crud.js';
import { requireAdmin } from '../hooks.js';
import type { RouteDeps } from './table.js';

type Actions = Array<'read' | 'write' | 'schema'>;

/**
 * Token 管理 /api/admin/tokens（admin 组，session 鉴权）。
 * 明文仅创建时返回一次；列表只显 prefix；token_hash 不外泄。
 */
export function registerTokenRoutes(deps: RouteDeps): void {
  const admin = deps.api.group('admin').before(requireAdmin(deps.systemDb));
  const store = createTokenStore(deps.systemDb);

  admin.get('/tokens').title('Token 列表').register(async (ctx, next) => {
    const rows = await store.list();
    ctx.reply.json(ok(rows.map(tokenToListVO)));
    return next();
  });

  admin.post('/tokens').title('创建 Token').register(async (ctx, next) => {
    const body = (ctx.body ?? {}) as { name?: string; permissions?: { tables?: string[]; actions?: string[] } };
    if (typeof body.name !== 'string' || !body.permissions) throw Errors.validationFail('name/permissions 必填');
    const { row, plain } = await store.create({
      name: body.name,
      permissions: {
        tables: body.permissions.tables ?? [],
        actions: (body.permissions.actions ?? []) as Actions,
      },
    });
    ctx.reply.status(201).json(ok(tokenToCreateVO(row, plain)));
    return next();
  });

  admin.put('/tokens/:id').title('更新 Token').register(async (ctx, next) => {
    const id = Number(ctx.params['id']);
    const body = (ctx.body ?? {}) as {
      name?: string;
      permissions?: { tables?: string[]; actions?: string[] };
      isActive?: boolean;
      expiresAt?: number | null;
    };
    const patch: {
      name?: string;
      permissions?: { tables: string[]; actions: Actions };
      isActive?: boolean;
      expiresAt?: number | null;
    } = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.permissions !== undefined)
      patch.permissions = { tables: body.permissions.tables ?? [], actions: (body.permissions.actions ?? []) as Actions };
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (Object.prototype.hasOwnProperty.call(body, 'expiresAt') && body.expiresAt !== undefined) patch.expiresAt = body.expiresAt;
    await store.update(id, patch);
    ctx.reply.json(ok({ success: true }));
    return next();
  });

  admin.delete('/tokens/:id').title('删除 Token').register(async (ctx, next) => {
    const id = Number(ctx.params['id']);
    await store.delete(id);
    ctx.reply.json(ok({ success: true }));
    return next();
  });
}
