import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createEngine } from '../engine.js';
import { MetadataStore } from '../metadata.js';
import { createTestDbs } from '../test-helpers.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('engine 工厂初始化失败', () => {
  it('缓存预热失败时关闭工厂尚未返回的两个 SQLite 句柄', async () => {
    const dbs = await createTestDbs();
    cleanups.push(dbs.cleanup);
    const original = new Error('warmup failed');
    vi.spyOn(MetadataStore.prototype, 'warmup').mockRejectedValue(original);
    const close = vi.spyOn(Database.prototype, 'close');
    await expect(createEngine({ businessDbPath: dbs.businessDbPath, systemDbPath: dbs.systemDbPath })).rejects.toBe(original);
    expect(close).toHaveBeenCalledTimes(2);
    for (const raw of close.mock.contexts) expect(raw.open).toBe(false);
  });
});
