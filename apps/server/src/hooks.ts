import type { Kysely } from 'kysely';
import type { Middleware } from 'erest';
import { Errors } from '@1api/shared';
import type { ServerSystemDB } from './db/types.js';
import { createAdminStore } from './middlewares/admin-store.js';
import { resolveToken, touchLastUsed } from './middlewares/token-store.js';
import { log } from './utils/logger.js';

export interface CurrentAdmin {
  id: number;
  name: string;
  nickname: string;
  mustChangePassword: boolean;
}

export interface CurrentToken {
  id: number;
  name: string;
  permissions: { tables: string[] | ['*']; actions: Array<'read' | 'write' | 'schema'>; admin?: boolean; adminId?: number };
}

/**
 * 对外通道鉴权：解析 `Authorization: Bearer oa_xxx`，校验有效性，注入 ctx.state.currentToken。
 * 失败抛 INVALID_TOKEN（401）。作为 data 组 / admin 组共享的 before 钩子。
 * 单参 (ctx, next) 签名（erest 标准 Middleware）。
 */
export function requireToken(systemDb: Kysely<ServerSystemDB>): Middleware {
  return async (ctx, next) => {
    const auth = ctx.headers['authorization'] ?? '';
    const m = /^Bearer\s+(oa_\S+)$/i.exec(auth);
    if (!m || !m[1]) throw Errors.invalidToken();
    const resolved = await resolveToken(systemDb, m[1]);
    if (!resolved) throw Errors.invalidToken();
    ctx.state['currentToken'] = {
      id: resolved.id,
      name: resolved.name,
      permissions: resolved.permissions,
    } satisfies CurrentToken;
    // 降频更新 last_used_at（fire-and-forget）
    void touchLastUsed(systemDb, resolved.id).catch(() => {
      /* last_used_at 仅审计用途，失败不影响鉴权 */
    });
    return next();
  };
}

/**
 * admin 通道鉴权：requireToken + 校验 token.permissions.admin===true，
 * 据此查询 admin 行注入 ctx.state.currentUser。
 * 失败抛 UNAUTHORIZED（非 admin token / admin 已不存在）。
 */
export function requireAdmin(systemDb: Kysely<ServerSystemDB>): Middleware {
  const requireBearer = requireToken(systemDb);
  const store = createAdminStore(systemDb);
  return async (ctx, next) => {
    // 先走 token 解析（注入 currentToken）
    await requireBearer(ctx, () => Promise.resolve());
    const token = ctx.state['currentToken'] as CurrentToken | undefined;
    if (!token || !token.permissions.admin) throw Errors.unauthorized();
    const adminId = token.permissions.adminId;
    if (typeof adminId !== 'number') throw Errors.unauthorized();
    const admin = await store.findById(adminId);
    if (!admin) throw Errors.unauthorized();
    ctx.state['currentUser'] = {
      id: admin.id,
      name: admin.name,
      nickname: admin.nickname,
      mustChangePassword: admin.must_change_password === 1,
    } satisfies CurrentAdmin;
    return next();
  };
}

/**
 * 对外通道权限校验：按 :table 路由参数 + action 校验 ctx.state.currentToken.permissions。
 * - tables: ['*'] 放行；否则须包含 table
 * - actions: 须包含 action
 * 失败抛 FORBIDDEN（403）。
 *
 * @param action 'read' | 'write' | 'schema'
 * @param opts.tableKey 路由参数名（默认 'table'）；opts.tableFromBody 从 body 取表名（create_table 用）
 */
export function checkPermission(
  action: 'read' | 'write' | 'schema',
  opts?: { tableKey?: string; tableFromBody?: string },
): Middleware {
  const tableKey = opts?.tableKey ?? 'table';
  return async (ctx, next) => {
    const token = ctx.state['currentToken'] as CurrentToken | undefined;
    if (!token) throw Errors.invalidToken();
    let tableName: string;
    if (opts?.tableFromBody) {
      // before 钩子在 checker 之前运行，$validated 尚未注入；从原始 body 读
      const body = (ctx.body ?? {}) as Record<string, unknown>;
      tableName = String(body[opts.tableFromBody] ?? '');
    } else {
      tableName = String(ctx.params[tableKey] ?? '');
    }
    const { tables, actions } = token.permissions;
    // tables 类型 string[] | ['*']，includes 需按 string[] 调用避免元组窄化
    const allTables = tables as readonly string[];
    const tableOk = allTables.includes('*') || allTables.includes(tableName);
    const actionOk = actions.includes(action);
    if (!tableOk || !actionOk) throw Errors.forbidden();
    return next();
  };
}

/** 请求日志 middleware（可作组级 middleware 钩子） */
export function logMiddleware(): Middleware {
  return async (ctx, next) => {
    log.request('%s %s', ctx.method, ctx.path);
    return next();
  };
}
