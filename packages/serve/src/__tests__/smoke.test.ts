import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', '..', 'dist', 'index.js');
interface Running {
  proc: ChildProcess;
  output: string;
  error?: Error;
  dir: string;
}
const runs: Running[] = [];

function launch(args: string[], env: NodeJS.ProcessEnv = {}, preload?: string): Running {
  const dir = mkdtempSync(join(tmpdir(), '1api-serve-'));
  const nodeArgs = preload ? ['--import', preload, entry] : [entry];
  const childEnv = { ...process.env };
  for (const key of ['ONE_API_SYSTEM_DB', 'ONE_API_BUSINESS_DB', 'ONE_API_DATA_DIR', 'ONE_API_ADMIN_ROOT']) delete childEnv[key];
  const proc = spawn(process.execPath, [...nodeArgs, '--data-dir', dir, ...args], {
    env: { ...childEnv, PORT: '0', ...env },
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const run: Running = { proc, output: '', dir };
  proc.stdout!.on('data', (data: Buffer) => { run.output += data.toString(); });
  proc.stderr!.on('data', (data: Buffer) => { run.output += data.toString(); });
  proc.on('error', (error) => { run.error = error; });
  runs.push(run);
  return run;
}

function waitOutput(run: Running, pattern: RegExp, timeout = 10000): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    const { proc } = run;
    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout!.off('data', check);
      proc.stderr!.off('data', check);
      proc.off('exit', check);
      proc.off('error', check);
    };
    const check = () => {
      const match = run.output.match(pattern);
      if (match) { cleanup(); resolve(match); }
      else if (run.error || proc.exitCode !== null || proc.signalCode !== null) {
        cleanup();
        reject(new Error(`启动/等待失败 code=${proc.exitCode} signal=${proc.signalCode}: ${run.output}`, { cause: run.error }));
      }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`等待日志超时 ${pattern}: ${run.output}`)); }, timeout);
    proc.stdout!.on('data', check);
    proc.stderr!.on('data', check);
    proc.on('exit', check);
    proc.on('error', check);
    check();
  });
}

function waitExit(run: Running, timeout = 5000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const { proc } = run;
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolve({ code, signal });
    };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timer); proc.off('exit', finish); proc.off('error', fail); };
    const timer = setTimeout(() => fail(new Error(`等待退出超时: ${run.output}`)), timeout);
    proc.once('exit', finish);
    proc.once('error', fail);
    if (run.error) fail(run.error);
    else if (proc.exitCode !== null || proc.signalCode !== null) finish(proc.exitCode, proc.signalCode);
  });
}

async function ready(run: Running): Promise<string> {
  const match = await waitOutput(run, /启动完成：端口 (\d+)/);
  const port = Number(match[1]);
  expect(port).toBeGreaterThan(0);
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  for (const run of runs.splice(0)) {
    if (run.proc.exitCode === null && run.proc.signalCode === null && !run.error) {
      run.proc.kill('SIGTERM');
      try { await waitExit(run, 1000); }
      catch { run.proc.kill('SIGKILL'); await waitExit(run, 1000); }
    }
    rmSync(run.dir, { recursive: true, force: true });
  }
});

describe('serve 真实进程', () => {
  it('默认启动严格提供已构建 web、健康检查和两个库', async () => {
    const run = launch(['--port', '0']);
    const baseURL = await ready(run);
    const health = await fetch(baseURL + '/healthz');
    expect(health.status).toBe(200);
    expect((await health.json() as { success: boolean }).success).toBe(true);
    const admin = await fetch(baseURL + '/admin/');
    expect(admin.status).toBe(200);
    expect(admin.headers.get('content-type')).toContain('text/html');
    expect(await admin.text()).toContain('id="app"');
    expect(existsSync(join(run.dir, 'system.db'))).toBe(true);
    expect(existsSync(join(run.dir, 'business.db'))).toBe(true);
    run.proc.kill('SIGTERM');
    expect(await waitExit(run)).toEqual({ code: 0, signal: null });
  });

  it('--no-web 明确禁用 fallback，API 仍提供服务', async () => {
    const run = launch(['--port', '0', '--no-web'], { ONE_API_ADMIN_ROOT: join(here, '../../../../apps/web/dist') });
    const baseURL = await ready(run);
    expect((await fetch(baseURL + '/admin/')).status).toBe(404);
    expect((await fetch(baseURL + '/healthz')).status).toBe(200);
  });

  it.each([['--port'], ['--port', '1.5'], ['--port', '65536'], ['--data-dir', '--no-web'], ['--admin-name', '']])('非法参数 %j 非零退出且不创建库', async (...args) => {
    const run = launch(args);
    const result = await waitExit(run);
    expect(result.code).toBe(1);
    expect(run.output).toMatch(/启动失败/);
    expect(existsSync(join(run.dir, 'system.db'))).toBe(false);
  });

  it('非法 PORT 非零退出且有效 --port 可覆盖它', async () => {
    const bad = launch([], { PORT: 'bad' });
    expect((await waitExit(bad)).code).toBe(1);
    expect(bad.output).toMatch(/端口/);
    expect(existsSync(join(bad.dir, 'system.db'))).toBe(false);
    const good = launch(['--port', '0', '--no-web'], { PORT: 'bad' });
    const baseURL = await ready(good);
    expect((await fetch(baseURL + '/healthz')).status).toBe(200);
  });

  it('重复 SIGINT/SIGTERM 等待同一次完整关闭再成功退出', async () => {
    // 在真实 HTTP close 回调外加可控栅栏，第二个信号不得提前 process.exit。
    const fixtureDir = mkdtempSync(join(tmpdir(), '1api-signals-'));
    const preload = join(fixtureDir, 'preload.mjs');
    writeFileSync(preload, `
      import { Server } from 'node:http';
      const close = Server.prototype.close;
      const released = new Promise(resolve => process.stdin.once('data', resolve));
      process.on('SIGTERM', () => process.stdout.write('SECOND_SIGNAL\\n'));
      Server.prototype.close = function(callback) {
        process.stdout.write('CLOSE_STARTED\\n');
        return close.call(this, (...args) => released.then(() => {
          process.stdout.write('CLOSE_FINISHED\\n');
          callback?.(...args);
        }));
      };
    `);
    try {
      const run = launch(['--port', '0', '--no-web'], {}, preload);
      await ready(run);
      run.proc.kill('SIGINT');
      await waitOutput(run, /CLOSE_STARTED/);
      run.proc.kill('SIGTERM');
      await waitOutput(run, /SECOND_SIGNAL/);
      run.proc.stdin!.end('release');
      expect(await waitExit(run)).toEqual({ code: 0, signal: null });
      expect(run.output).toContain('CLOSE_FINISHED');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
