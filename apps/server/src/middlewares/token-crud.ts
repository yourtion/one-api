import type { Kysely } from 'kysely';
import type { ServerSystemDB } from '../db/types.js';
import type { TokenPermissions } from '@1api/shared';
import { generatePlainToken, hashToken, tokenPrefix } from '../utils/token.js';

export interface TokenRow {
  id: number;
  name: string;
  token_prefix: string;
  permissions: TokenPermissions;
  is_active: boolean;
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TokenStore {
  list(): Promise<TokenRow[]>;
  create(input: { name: string; permissions: TokenPermissions }): Promise<{ row: TokenRow; plain: string }>;
  update(
    id: number,
    patch: {
      name?: string;
      permissions?: TokenPermissions;
      isActive?: boolean;
      expiresAt?: number | null;
    },
  ): Promise<void>;
  delete(id: number): Promise<void>;
}

interface DbTokenRow {
  id: number;
  name: string;
  token_prefix: string;
  permissions: string;
  is_active: number;
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

export function createTokenStore(systemDb: Kysely<ServerSystemDB>): TokenStore {
  function rowToToken(r: DbTokenRow): TokenRow {
    return {
      id: r.id,
      name: r.name,
      token_prefix: r.token_prefix,
      permissions: JSON.parse(r.permissions) as TokenPermissions,
      is_active: r.is_active === 1,
      expires_at: r.expires_at,
      last_used_at: r.last_used_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  return {
    async list() {
      const rows = (await systemDb.selectFrom('api_token').selectAll().orderBy('id', 'asc').execute()) as DbTokenRow[];
      return rows.map(rowToToken);
    },
    async create(input) {
      const plain = generatePlainToken();
      const tokenHash = hashToken(plain);
      const prefix = tokenPrefix(plain);
      const now = Date.now();
      const inserted = (await systemDb
        .insertInto('api_token')
        .values({
          name: input.name,
          token_hash: tokenHash,
          token_prefix: prefix,
          permissions: JSON.stringify(input.permissions),
          is_active: 1,
          expires_at: null,
          last_used_at: null,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as DbTokenRow;
      return { row: rowToToken(inserted), plain };
    },
    async update(id, patch) {
      const sets: Record<string, unknown> = { updated_at: Date.now() };
      if (patch.name !== undefined) sets['name'] = patch.name;
      if (patch.permissions !== undefined) sets['permissions'] = JSON.stringify(patch.permissions);
      if (patch.isActive !== undefined) sets['is_active'] = patch.isActive ? 1 : 0;
      // exactOptionalPropertyTypes：expiresAt 用 has 判断（null 也是合法值）
      if (Object.prototype.hasOwnProperty.call(patch, 'expiresAt')) sets['expires_at'] = patch.expiresAt;
      await systemDb.updateTable('api_token').set(sets).where('id', '=', id).execute();
    },
    async delete(id) {
      await systemDb.deleteFrom('api_token').where('id', '=', id).execute();
    },
  };
}

/** 列表 VO：剥离 hash（绝不外泄 token_hash / 明文 token） */
export function tokenToListVO(r: TokenRow) {
  return {
    id: r.id,
    name: r.name,
    token_prefix: r.token_prefix,
    permissions: r.permissions,
    is_active: r.is_active,
    expires_at: r.expires_at,
    last_used_at: r.last_used_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** 创建响应 VO：明文仅此一次 + prefix，绝不返回 hash */
export function tokenToCreateVO(r: TokenRow, plain: string) {
  return {
    id: r.id,
    name: r.name,
    token: plain,
    tokenPrefix: r.token_prefix,
    permissions: r.permissions,
  };
}
