import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resolveTokenFromHeader, checkTableAction } from '../auth.js';
import { setupTest } from '../../../__tests__/helpers.js';
import type { TestSetup } from '../../../__tests__/helpers.js';
import { Errors } from '@1api/shared';

let t: TestSetup;
beforeEach(async () => {
  t = await setupTest();
});
afterAll(async () => {
  await t.cleanup();
});

describe('resolveTokenFromHeader', () => {
  it('有效 Bearer token → 返回 CurrentToken', async () => {
    const plain = await t.insertToken({ tables: ['*'], actions: ['read', 'write'] });
    const token = await resolveTokenFromHeader(t.systemDb, `Bearer ${plain}`);
    expect(token).toBeDefined();
    expect(token!.name).toBe('test');
    expect(token!.permissions.tables).toEqual(['*']);
    expect(token!.permissions.actions).toEqual(['read', 'write']);
  });

  it('无 Authorization 头 → 抛 INVALID_TOKEN', async () => {
    await expect(resolveTokenFromHeader(t.systemDb, '')).rejects.toThrow(/无效|token/i);
  });

  it('非 Bearer 前缀 → 抛 INVALID_TOKEN', async () => {
    await expect(resolveTokenFromHeader(t.systemDb, 'Basic abc')).rejects.toThrow(/无效|token/i);
  });

  it('无效 token（哈希不匹配）→ 抛 INVALID_TOKEN', async () => {
    await expect(resolveTokenFromHeader(t.systemDb, 'Bearer oa_nope_not_real')).rejects.toThrow(/无效|token/i);
  });

  it('失效 token（is_active=0）→ 抛 INVALID_TOKEN', async () => {
    const plain = await t.insertToken({ tables: ['*'], actions: ['read'] }, { isActive: false });
    await expect(resolveTokenFromHeader(t.systemDb, `Bearer ${plain}`)).rejects.toThrow(/无效|token/i);
  });

  it('过期 token → 抛 INVALID_TOKEN', async () => {
    const plain = await t.insertToken({ tables: ['*'], actions: ['read'] }, { expiresAt: Date.now() - 1000 });
    await expect(resolveTokenFromHeader(t.systemDb, `Bearer ${plain}`)).rejects.toThrow(/无效|token/i);
  });
});

describe('checkTableAction', () => {
  const token = (tables: string[], actions: string[]) =>
    ({ id: 1, name: 't', permissions: { tables, actions } });

  it('tables 通配 * + action 命中 → 通过', () => {
    expect(() => checkTableAction(token(['*'], ['read', 'write']), 'users', 'write')).not.toThrow();
  });

  it('tables 显式命中 + action 命中 → 通过', () => {
    expect(() => checkTableAction(token(['users'], ['read']), 'users', 'read')).not.toThrow();
  });

  it('tables 未命中 → 抛 FORBIDDEN', () => {
    expect(() => checkTableAction(token(['users'], ['read']), 'orders', 'read')).toThrow(Errors.forbidden());
  });

  it('action 未命中（有 read 要 write）→ 抛 FORBIDDEN', () => {
    expect(() => checkTableAction(token(['*'], ['read']), 'users', 'write')).toThrow(Errors.forbidden());
  });

  it('action 未命中（有 read/write 要 schema）→ 抛 FORBIDDEN', () => {
    expect(() => checkTableAction(token(['*'], ['read', 'write']), 'users', 'schema')).toThrow(Errors.forbidden());
  });
});
