import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { MetadataStore } from '@1api/engine';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type ServerHandle } from '../server.js';
import { getEngine, _resetEngine } from '../core/engine.js';
import { getSystemDb } from '../core/system-db.js';

const handles: ServerHandle[] = [];
const dirs: string[] = [];
function makeServer(port = 0) {
  const dir = mkdtempSync(join(tmpdir(), '1api-lib-'));
  dirs.push(dir);
  const handle = createServer({ config: { port, systemDbPath: join(dir, 'system.db'), businessDbPath: join(dir, 'business.db') }, adminRoot: null });
  handles.push(handle);
  return { handle, dir };
}
const url = (handle: ServerHandle) => `http://127.0.0.1:${handle.port}`;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled(handles.splice(0).map((h) => h.close()));
  _resetEngine();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createServer 生命周期', () => {
  it('第二实例在写库前拒绝，第一实例继续可用', async () => {
    const first = makeServer().handle;
    const second = makeServer();
    await first.listen();
    await expect(second.handle.listen()).rejects.toThrow(/实例|启动|监听/);
    expect(existsSync(join(second.dir, 'system.db'))).toBe(false);
    expect((await fetch(url(first) + '/healthz')).status).toBe(200);
  });

  it('并发 listen 也在写第二个库前拒绝', async () => {
    const first = makeServer().handle;
    const second = makeServer();
    const started = first.listen();
    await expect(second.handle.listen()).rejects.toThrow(/实例|启动|监听/);
    await started;
    expect(existsSync(join(second.dir, 'system.db'))).toBe(false);
  });

  it('端口冲突后清理全局资源，并允许下一生命周期', async () => {
    const blocker = createHttpServer();
    await new Promise<void>((resolve) => blocker.listen(0, '0.0.0.0', resolve));
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const failed = makeServer(address.port).handle;
    try {
      await expect(failed.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(() => getEngine()).toThrow(/未装配/);
      expect(() => getSystemDb()).toThrow(/未装配/);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
    const next = makeServer().handle;
    await next.listen();
    expect((await fetch(url(next) + '/healthz')).status).toBe(200);
  });

  it('已监听后启动失败也释放端口，清理异常不覆盖原始异常', async () => {
    const handle = makeServer().handle;
    const original = new Error('metadata unavailable');
    const list = vi.spyOn(MetadataStore.prototype, 'listMetas').mockImplementationOnce(async () => {
      const engine = getEngine();
      const destroy = engine.destroy.bind(engine);
      vi.spyOn(engine, 'destroy').mockImplementation(async () => {
        await destroy();
        throw new Error('cleanup failed');
      });
      throw original;
    });
    await expect(handle.listen()).rejects.toBe(original);
    list.mockRestore();
    expect(() => getSystemDb()).toThrow(/未装配/);
    const next = makeServer(handle.port).handle;
    await next.listen();
    expect((await fetch(url(next) + '/healthz')).status).toBe(200);
  });

  it('engine 初始化中途失败后清理系统库并允许新启动', async () => {
    const failed = makeServer();
    mkdirSync(join(failed.dir, 'business.db'));
    await expect(failed.handle.listen()).rejects.toThrow();
    expect(() => getSystemDb()).toThrow(/未装配/);
    const next = makeServer().handle;
    await next.listen();
    expect((await fetch(url(next) + '/healthz')).status).toBe(200);
  });

  it('并发 close 等待同一次实际资源释放', async () => {
    const handle = makeServer().handle;
    await handle.listen();
    const engine = getEngine();
    const destroy = engine.destroy.bind(engine);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(engine, 'destroy').mockImplementation(async () => { await gate; await destroy(); });
    const first = handle.close();
    const second = handle.close();
    expect(second).toBe(first);
    let secondDone = false;
    void second.then(() => { secondDone = true; });
    await Promise.resolve();
    expect(secondDone).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(engine.destroy).toHaveBeenCalledTimes(1);
    expect(() => getEngine()).toThrow(/未装配/);
  });

  it('close 与 listen 并发时等待启动及清理完成', async () => {
    const handle = makeServer().handle;
    const starting = handle.listen();
    await handle.close();
    await starting;
    expect(() => getEngine()).toThrow(/未装配/);
    const next = makeServer().handle;
    await next.listen();
  });

  it('关闭后新的库可启动，旧 session cookie 失效', async () => {
    const first = makeServer().handle;
    await first.listen();
    const login = await fetch(url(first) + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'admin', password: '123456' }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toBeTruthy();
    await first.close();
    const second = makeServer().handle;
    await second.listen();
    const me = await fetch(url(second) + '/api/auth/me', { headers: { cookie: cookie! } });
    expect(me.status).toBe(401);
    expect((await fetch(url(second) + '/healthz')).status).toBe(200);
  });

  it('未 listen 的 close 幂等，并关闭该句柄生命周期', async () => {
    const { handle, dir } = makeServer();
    await Promise.all([handle.close(), handle.close()]);
    expect(existsSync(join(dir, 'system.db'))).toBe(false);
    await expect(handle.listen()).rejects.toThrow(/关闭/);
  });
});
