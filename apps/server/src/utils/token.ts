import { createHash, randomBytes } from 'node:crypto';

/** 生成明文 token：`oa_` + 32 字节随机 hex（共 67 字符） */
export function generatePlainToken(): string {
  return 'oa_' + randomBytes(32).toString('hex');
}

/** sha256(明文) → token_hash（仅存哈希） */
export function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/** 前 8 位 + `****`（列表展示用，不泄露明文后段） */
export function tokenPrefix(plain: string): string {
  return plain.slice(0, 8) + '****';
}
