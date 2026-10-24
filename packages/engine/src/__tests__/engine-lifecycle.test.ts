import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely } from 'kysely';
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


describe('engine 正常销毁', () => {
  async function makeEngine() {
    const dbs = await createTestDbs();
    cleanups.push(dbs.cleanup);
    const engine = await createEngine({ businessDbPath: dbs.businessDbPath, systemDbPath: dbs.systemDbPath });
    cleanups.unshift(async () => {
      await engine.destroy().catch(() => {});
      if (engine.businessRaw.open) engine.businessRaw.close();
    });
    return engine;
  }

  it('未经过 data 查询时也关闭原生业务库，且可重复销毁', async () => {
    const engine = await makeEngine();
    expect(engine.businessRaw.open).toBe(true);
    const first = engine.destroy();
    expect(engine.destroy()).toBe(first);
    await first;
    expect(engine.businessRaw.open).toBe(false);
    await expect(engine.destroy()).resolves.toBeUndefined();
  });

  it('仅通过 schema 使用业务库后也关闭原生句柄', async () => {
    const engine = await makeEngine();
    await engine.schema.createModel({ name: 'example', label: 'Example', fields: [{ name: 'title', jsonType: 'string' }] });
    await engine.destroy();
    expect(engine.businessRaw.open).toBe(false);
  });

  it('两个 Kysely destroy 都失败时仍尝试并关闭两个原生句柄，保留首个失败', async () => {
    const engine = await makeEngine();
    const original = new Error('business driver destroy failed');
    const second = new Error('system driver destroy failed');
    const destroy = vi.spyOn(Kysely.prototype, 'destroy').mockRejectedValueOnce(original).mockRejectedValueOnce(second);
    const close = vi.spyOn(Database.prototype, 'close');
    await expect(engine.destroy()).rejects.toBe(original);
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
    for (const raw of close.mock.contexts) expect(raw.open).toBe(false);
  });

  it('业务原生句柄 close 抛错时仍关闭系统句柄并保留该异常', async () => {
    const engine = await makeEngine();
    vi.spyOn(Kysely.prototype, 'destroy').mockResolvedValue(undefined);
    const original = new Error('native close failed');
    const close = vi.spyOn(Database.prototype, 'close').mockImplementationOnce(() => { throw original; });
    await expect(engine.destroy()).rejects.toBe(original);
    expect(close).toHaveBeenCalledTimes(2);
    expect(close.mock.contexts[1]!.open).toBe(false);
  });

});
