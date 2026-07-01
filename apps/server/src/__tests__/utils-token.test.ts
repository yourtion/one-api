import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generatePlainToken, hashToken, tokenPrefix } from '../utils/token.js';

describe('token utils', () => {
  it('generatePlainToken：oa_ 前缀 + 32 字节 hex（共 67 字符）', () => {
    const t = generatePlainToken();
    expect(t.startsWith('oa_')).toBe(true);
    expect(t.length).toBe(3 + 64); // oa_ + 32 字节 hex
    expect(/^[0-9a-f]+$/.test(t.slice(3))).toBe(true);
  });

  it('generatePlainToken：每次随机不同', () => {
    expect(generatePlainToken()).not.toBe(generatePlainToken());
  });

  it('hashToken：sha256(明文)', () => {
    const t = 'oa_deadbeef';
    expect(hashToken(t)).toBe(createHash('sha256').update(t).digest('hex'));
  });

  it('tokenPrefix：前 8 位 + ****（不含明文后段）', () => {
    const t = 'oa_a3f9c0ffee1234abcd'; // 取前 8 位 oa_a3f9c
    const p = tokenPrefix(t);
    expect(p).toBe('oa_a3f9c' + '****');
    expect(p.endsWith('****')).toBe(true);
    expect(p.length).toBe(8 + 4);
    // 不泄露明文后段
    expect(p).not.toContain('ffee');
  });
});
