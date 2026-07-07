import { describe, it, expect } from 'vitest';
import { OneApiError } from '../error.js';

describe('OneApiError', () => {
  it('携带 code / message / statusCode', () => {
    const e = new OneApiError('TABLE_NOT_FOUND', '表 users 不存在', 404);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(OneApiError);
    expect(e.code).toBe('TABLE_NOT_FOUND');
    expect(e.message).toBe('表 users 不存在');
    expect(e.statusCode).toBe(404);
    expect(e.name).toBe('OneApiError');
  });

  it(' NETWORK_ERROR 的 statusCode 默认 0', () => {
    const e = new OneApiError('NETWORK_ERROR', '连接失败');
    expect(e.statusCode).toBe(0);
  });

  it('可被 throw + instanceof 捕获', () => {
    try {
      throw new OneApiError('FORBIDDEN', '无权', 403);
    } catch (e) {
      expect(e).toBeInstanceOf(OneApiError);
      expect((e as OneApiError).code).toBe('FORBIDDEN');
    }
  });
});
