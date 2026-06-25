import type { Kysely } from 'kysely';
import { Errors } from '@1api/shared';
import type { ServerSystemDB } from '../db/types.js';
import type { AppContext } from '../types/context.js';
import { resolveToken, touchLastUsed } from './token-store.js';

/**
 * 对外通道鉴权（工厂）。解析 `Authorization: Bearer oa_xxx`，校验有效性，注入 ctx.currentToken。
 * 失败抛 INVALID_TOKEN（401）。不校验 permissions（由 checkPermission 负责）。
 *
 * 单参数中间件：抛出的 AppError 由全局 errorMiddleware 捕获。
 */
export function createRequireToken(systemDb: Kysely<ServerSystemDB>) {
  return async function requireTokenMiddleware(ctx: AppContext): Promise<void> {
    const auth = ctx.request.headers['authorization'] ?? '';
    const m = /^Bearer\s+(oa_\S+)$/i.exec(auth);
    if (!m || !m[1]) throw Errors.invalidToken();
    const resolved = await resolveToken(systemDb, m[1]);
    if (!resolved) throw Errors.invalidToken();
    ctx.currentToken = {
      id: resolved.id,
      name: resolved.name,
      permissions: resolved.permissions,
    };
    // 降频更新 last_used_at（fire-and-forget：不阻塞响应，失败忽略）
    void touchLastUsed(systemDb, resolved.id).catch(() => {
      /* last_used_at 仅审计用途，失败不影响鉴权 */
    });
    ctx.next();
  };
}

/**
 * 权限校验（工厂）。按 :table 路由参数 + action 校验 token.permissions。
 * - tables: ['*'] 放行；否则须包含 table
 * - actions: 须包含 action
 * 失败抛 FORBIDDEN（403）。
 *
 * @param action 'read' | 'write' | 'schema'
 * @param opts.tableKey 路由参数名（默认 'table'）；opts.tableFromBody 从 body 取表名（create_table 用）
 */
export function createCheckPermission(
  action: 'read' | 'write' | 'schema',
  opts?: { tableKey?: string; tableFromBody?: string },
) {
  const tableKey = opts?.tableKey ?? 'table';
  return async function checkPermissionMiddleware(ctx: AppContext): Promise<void> {
    const token = ctx.currentToken;
    if (!token) throw Errors.invalidToken();
    let tableName: string;
    if (opts?.tableFromBody) {
      const body = ctx.paramsInput['body'] as Record<string, unknown> | undefined;
      tableName = String(body?.[opts.tableFromBody] ?? '');
    } else {
      tableName = String(ctx.request.params[tableKey] ?? '');
    }
    const { tables, actions } = token.permissions;
    // tables 类型为 string[] | ['*']，includes 须 cast 避免字面量元组的窄化问题
    const tableOk = (tables as string[]).includes('*') || (tables as string[]).includes(tableName);
    const actionOk = actions.includes(action);
    if (!tableOk || !actionOk) throw Errors.forbidden();
    ctx.next();
  };
}
