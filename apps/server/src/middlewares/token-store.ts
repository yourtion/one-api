import type { Kysely } from 'kysely';
import type { ServerSystemDB } from '../db/types.js';
import type { TokenPermissions } from '@1api/shared';
import { hashToken } from '../utils/token.js';

export interface ResolvedToken {
  id: number;
  name: string;
  permissions: TokenPermissions;
  isActive: boolean;
  expiresAt: number | null;
}

/** 进程内存：记录每个 token 上次写 last_used_at 的时间（降频：60s 内不重复写） */
const lastWriteAt = new Map<number, number>();
const WRITE_INTERVAL_MS = 60_000;

/** 测试辅助：重置降频计数（避免用例间串扰） */
export function _resetLastWriteAt(): void {
  lastWriteAt.clear();
}

/**
 * 按 Bearer 明文解析 token：sha256 比对 token_hash，校验 is_active + 未过期。
 * 返回 undefined 表示无效（调用方抛 INVALID_TOKEN）。
 */
export async function resolveToken(
  db: Kysely<ServerSystemDB>,
  bearer: string,
): Promise<ResolvedToken | undefined> {
  const hash = hashToken(bearer);
  const row = await db
    .selectFrom('api_token')
    .select(['id', 'name', 'permissions', 'is_active', 'expires_at', 'last_used_at'])
    .where('token_hash', '=', hash)
    .executeTakeFirst();
  if (!row) return undefined;

  const isActive = row.is_active === 1;
  const expired = row.expires_at !== null && row.expires_at < Date.now();
  if (!isActive || expired) return undefined;

  return {
    id: row.id,
    name: row.name,
    permissions: JSON.parse(row.permissions) as TokenPermissions,
    isActive,
    expiresAt: row.expires_at,
  };
}

/**
 * 降频更新 last_used_at：每 60s 最多写一次。
 * 进程内存记录上次写时间；未满 60s 跳过写库。仅审计用途，准确度足够。
 */
export async function touchLastUsed(db: Kysely<ServerSystemDB>, tokenId: number): Promise<void> {
  const now = Date.now();
  const prev = lastWriteAt.get(tokenId);
  if (prev !== undefined && now - prev < WRITE_INTERVAL_MS) return;
  lastWriteAt.set(tokenId, now);
  await db.updateTable('api_token').set({ last_used_at: now }).where('id', '=', tokenId).execute();
}
