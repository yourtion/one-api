import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type ServerHandle } from '../server.js';
import { _resetEngine } from '../core/engine.js';

let dir = '';
let baseURL = '';
let handle: ServerHandle;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), '1api-lib-'));
  _resetEngine();
  // port: 0 = 随机端口；createServer 支持 port=0 回填实际端口
  handle = createServer({
    config: {
      port: 0,
      systemDbPath: join(dir, 'system.db'),
      businessDbPath: join(dir, 'business.db'),
    },
  });
  await handle.listen();
  baseURL = `http://127.0.0.1:${handle.port}`;
}, 15000);

afterAll(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('createServer 库函数', () => {
  it('listen 后 /healthz 可访问', async () => {
    const r = await fetch(baseURL + '/healthz');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { success: boolean }).success).toBe(true);
  });

  it('close 后再次 close 幂等（不抛错）', async () => {
    // afterAll 已会 close 一次；这里再调一次验证幂等（listening 已为 false，直接返回）
    await expect(handle.close()).resolves.toBeUndefined();
  });
});
