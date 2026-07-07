import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerConfigCommand } from '../commands/config-cmd.js';
import { registerConnectCommand } from '../commands/connect.js';
import { saveConfig, resolveConfigPath } from '../config.js';

let tmpHome: string;
const ORIG_HOME = process.env.HOME;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'cli-configcmd-'));
  process.env.HOME = tmpHome;
});
afterEach(() => {
  process.env.HOME = ORIG_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

/** 构造带全局 flag 的 program（模拟 index.ts 顶层）。 */
function buildProgram(): Command {
  const program = new Command();
  program
    .name('one-api-cli')
    .option('-H, --host <url>', '')
    .option('-T, --token <token>', '')
    .option('-D, --db <path>', '')
    .option('-S, --system-db <path>', '');
  registerConfigCommand(program);
  registerConnectCommand(program);
  return program;
}

async function run(program: Command, ...args: string[]): Promise<{ stdout: string; code: number }> {
  const out: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => out.push(a.join(' '));
  let code = 0;
  const origExit = process.exit;
  process.exit = ((n?: number) => {
    code = n ?? 0;
    throw new Error('__EXIT__');
  }) as never;
  try {
    await program.parseAsync(args, { from: 'user' });
  } catch (e) {
    if ((e as Error).message !== '__EXIT__') throw e;
  } finally {
    console.log = origLog;
    process.exit = origExit;
  }
  return { stdout: out.join('\n'), code };
}

describe('config 命令', () => {
  it('无配置 → 提示未配置', async () => {
    const res = await run(buildProgram(), 'config');
    expect(res.stdout).toContain('尚未配置');
    expect(res.stdout).toContain(resolveConfigPath());
  });

  it('远程配置 → 输出地址+脱敏 token', async () => {
    saveConfig({ mode: 'remote', host: 'http://x:3000', token: 'oa_abcdef123456' });
    const res = await run(buildProgram(), 'config');
    expect(res.stdout).toContain('远程');
    expect(res.stdout).toContain('http://x:3000');
    expect(res.stdout).toContain('****');
    // token 前 12 位可见
    expect(res.stdout).toContain('oa_abcdef123');
  });

  it('本地配置（含系统库）→ 输出业务库+系统库', async () => {
    saveConfig({ mode: 'local', dbPath: '/tmp/biz.db', systemDbPath: '/tmp/sys.db' });
    const res = await run(buildProgram(), 'config');
    expect(res.stdout).toContain('本地直连');
    expect(res.stdout).toContain('/tmp/biz.db');
    expect(res.stdout).toContain('系统库');
    expect(res.stdout).toContain('/tmp/sys.db');
  });

  it('本地配置（无系统库）→ 仅输出业务库', async () => {
    saveConfig({ mode: 'local', dbPath: '/tmp/biz.db' });
    const res = await run(buildProgram(), 'config');
    expect(res.stdout).toContain('本地直连');
    expect(res.stdout).toContain('/tmp/biz.db');
    expect(res.stdout).not.toContain('系统库');
  });

  it('config 命令不读取全局 flag（-D/-S 不影响）', async () => {
    // config 只读配置文件，不解析 flag；即使带 -D 也不改变输出
    const res = await run(buildProgram(), '-D', '/tmp/x.db', 'config');
    expect(res.stdout).toContain('尚未配置');
  });
});

describe('connect 命令（本地配置含 systemDb）', () => {
  it('connect --db --system-db → 保存 systemDbPath', async () => {
    const res = await run(buildProgram(), 'connect', '--db', '/tmp/biz.db', '--system-db', '/tmp/sys.db');
    expect(res.code).toBe(0);
    const cfg = JSON.parse(readFileSync(join(tmpHome, '.one-api-cli', 'config.json'), 'utf-8'));
    expect(cfg).toEqual({ mode: 'local', dbPath: '/tmp/biz.db', systemDbPath: '/tmp/sys.db' });
  });

  it('connect --db（无 system-db）→ 不写 systemDbPath', async () => {
    const res = await run(buildProgram(), 'connect', '--db', '/tmp/biz.db');
    expect(res.code).toBe(0);
    const cfg = JSON.parse(readFileSync(join(tmpHome, '.one-api-cli', 'config.json'), 'utf-8'));
    expect(cfg).toEqual({ mode: 'local', dbPath: '/tmp/biz.db' });
  });

  it('connect 全局 flag 形式 -D -S → 保存 systemDbPath（optsWithGlobals）', async () => {
    // 全局 flag 与子命令同名冲突场景：-D/-S 挂在 program 层
    const res = await run(buildProgram(), '-D', '/tmp/g.db', '-S', '/tmp/gsys.db', 'connect');
    expect(res.code).toBe(0);
    const cfg = JSON.parse(readFileSync(join(tmpHome, '.one-api-cli', 'config.json'), 'utf-8'));
    expect(cfg).toEqual({ mode: 'local', dbPath: '/tmp/g.db', systemDbPath: '/tmp/gsys.db' });
  });
});
