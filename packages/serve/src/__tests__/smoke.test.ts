import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

let dir = '';
let proc: ChildProcess | null = null;
let baseURL = '';

function waitReady(p: ChildProcess, timeout = 10000): Promise<void> {
  return new Promise((resolveP, reject) => {
    const timer = setTimeout(() => reject(new Error('启动超时')), timeout);
    p.stdout!.on('data', (d: Buffer) => {
      const s = d.toString();
      if (s.includes('启动完成')) {
        clearTimeout(timer);
        resolveP();
      }
    });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`进程意外退出 code=${code}`));
    });
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), '1api-serve-'));
  const port = 14099;
  baseURL = `http://127.0.0.1:${port}`;
  // 跑编译后的 dist/index.js（需先 build serve）。
  // here = packages/serve/src/__tests__ → 上溯 2 级到 packages/serve，再进 dist/index.js。
  const entry = join(here, '..', '..', 'dist', 'index.js');
  proc = spawn('node', [entry, '--port', String(port), '--data-dir', dir], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await waitReady(proc);
  // 多等一拍让 listen 完全就绪
  await new Promise((r) => setTimeout(r, 300));
}, 20000);

afterAll(async () => {
  if (proc) {
    proc.kill('SIGTERM');
    await new Promise<void>((r) => proc!.on('exit', () => r()));
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('serve 烟雾测试', () => {
  it('/healthz 返回信封', async () => {
    const r = await fetch(baseURL + '/healthz');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { success: boolean }).success).toBe(true);
  });

  it('--data-dir 生成了 system.db + business.db', async () => {
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(dir, 'system.db'))).toBe(true);
    expect(existsSync(join(dir, 'business.db'))).toBe(true);
  });

  it('/admin/ 若 web 已 build 则 200，否则跳过', async () => {
    const r = await fetch(baseURL + '/admin/');
    // monorepo 内 web 已 build 时 200；未 build 时可能 404——两者都接受（环境差异）
    expect([200, 404]).toContain(r.status);
  });
});

// --no-web 回归：独立进程（erest api 全局单例，不可与上面实例共用），
// 验证 adminRoot:null 真正跳过 web 挂载（曾因接口无法区分「未传」与「禁用」而失效）
describe('serve --no-web 纯 API 模式', () => {
  let noWebDir = '';
  let noWebProc: ChildProcess | null = null;
  let noWebBaseURL = '';

  beforeAll(async () => {
    noWebDir = mkdtempSync(join(tmpdir(), '1api-serve-noweb-'));
    const port = 14098;
    noWebBaseURL = `http://127.0.0.1:${port}`;
    const entry = join(here, '..', '..', 'dist', 'index.js');
    noWebProc = spawn('node', [entry, '--port', String(port), '--no-web', '--data-dir', noWebDir], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    await waitReady(noWebProc);
    await new Promise((r) => setTimeout(r, 300));
  }, 20000);

  afterAll(async () => {
    if (noWebProc) {
      noWebProc.kill('SIGTERM');
      await new Promise<void>((r) => noWebProc!.on('exit', () => r()));
    }
    rmSync(noWebDir, { recursive: true, force: true });
  });

  it('/admin/ 返回 404（web 被明确禁用）', async () => {
    const r = await fetch(noWebBaseURL + '/admin/');
    expect(r.status).toBe(404);
  });

  it('/healthz 仍可用（API 不受影响）', async () => {
    const r = await fetch(noWebBaseURL + '/healthz');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { success: boolean }).success).toBe(true);
  });
});
