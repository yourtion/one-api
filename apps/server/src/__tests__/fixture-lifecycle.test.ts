import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { setupTest } from './helpers.js';

describe('真实 HTTP 夹具生命周期', () => {
  it('反复创建/关闭不增加 exit 监听器，关闭 HTTP 后释放数据库和目录，重复 cleanup 安全', async () => {
    const listeners = process.listeners('exit');
    for (let i = 0; i < 3; i++) {
      const t = await setupTest();
      try {
        expect(process.listeners('exit')).toEqual(listeners);
        expect((await fetch(`${new URL(t.mcpUrl).origin}/data/missing`)).status).toBe(401);
      } finally {
        await t.cleanup();
      }
      await expect(fetch(t.mcpUrl)).rejects.toThrow();
      await expect(t.systemDb.selectFrom('admin').selectAll().execute()).rejects.toThrow();
      expect(existsSync(dirname(t.businessDbPath))).toBe(false);
      await expect(t.cleanup()).resolves.toBeUndefined();
    }
    expect(process.listeners('exit')).toEqual(listeners);
  });
});

it('保留原有的 once exit 监听器，清理不触发或替换它', async () => {
  const onExit = () => {};
  process.once('exit', onExit);
  const listeners = process.rawListeners('exit');
  const t = await setupTest();
  try {
    expect(process.rawListeners('exit')).toEqual(listeners);
    await t.cleanup();
    expect(process.rawListeners('exit')).toEqual(listeners);
  } finally {
    await t.cleanup();
    process.removeListener('exit', onExit);
  }
});
