import type { TokenPermissions } from '@1api/shared';
import { api } from './index.js';
import type { TokenCreateVO, TokenListVO } from './types.js';

export function listTokens(): Promise<TokenListVO[]> {
  return api('get', '/admin/tokens');
}

export function createToken(name: string, permissions: TokenPermissions): Promise<TokenCreateVO> {
  return api('post', '/admin/tokens', { data: { name, permissions } });
}

export function updateToken(
  id: number,
  patch: { name?: string; permissions?: TokenPermissions; isActive?: boolean; expiresAt?: number | null },
): Promise<{ success: boolean }> {
  return api('put', `/admin/tokens/${id}`, { data: patch });
}

export function deleteToken(id: number): Promise<{ success: boolean }> {
  return api('delete', `/admin/tokens/${id}`);
}
