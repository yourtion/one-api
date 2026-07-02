import type { Kysely } from 'kysely';
import { Errors, type TokenPermissions } from '@1api/shared';
import type { ServerSystemDB } from '../../db/types.js';
import { resolveToken, touchLastUsed } from '../../middlewares/token-store.js';

/** 已解析的 token（注入 MCP 会话/tool handler）——与 hooks.ts 的 CurrentToken 同构。 */
export interface McpCurrentToken {
  id: number;
  name: string;
  permissions: TokenPermissions;
}

/**
 * 从 Authorization 头解析 Bearer token，返回 CurrentToken。
 * 复用 Phase 2 的 resolveToken（sha256 比对 + is_active/expires_at 校验）。
 * 无效/过期/无凭证 → 抛 INVALID_TOKEN（与 requireToken 行为一致）。
 */
export async function resolveTokenFromHeader(
  systemDb: Kysely<ServerSystemDB>,
  authHeader: string,
): Promise<McpCurrentToken> {
  const m = /^Bearer\s+(oa_\S+)$/i.exec(authHeader ?? '');
  if (!m || !m[1]) throw Errors.invalidToken();
  const resolved = await resolveToken(systemDb, m[1]);
  if (!resolved) throw Errors.invalidToken();
  // 降频更新 last_used_at（fire-and-forget）——与 hooks.ts requireToken 行为一致
  void touchLastUsed(systemDb, resolved.id).catch(() => {
    /* last_used_at 仅审计用途，失败不影响鉴权 */
  });
  return {
    id: resolved.id,
    name: resolved.name,
    permissions: resolved.permissions,
  };
}

/**
 * 校验 token 对 (table, action) 的权限。命中 → 通过；未命中 → 抛 FORBIDDEN。
 * 逻辑与 hooks.ts 的 checkPermission 完全一致（tables 白名单 + actions 白名单）。
 */
export function checkTableAction(
  token: McpCurrentToken,
  table: string,
  action: 'read' | 'write' | 'schema',
): void {
  const { tables, actions } = token.permissions;
  // tables 类型 string[] | ['*']，includes 需按 string[] 调用避免元组窄化（与 hooks.ts checkPermission 一致）
  const allTables = tables as readonly string[];
  const tableOk = allTables.includes('*') || allTables.includes(table);
  const actionOk = actions.includes(action);
  if (!tableOk || !actionOk) throw Errors.forbidden();
}
