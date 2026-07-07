import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTest } from '@1api/server/__tests__/helpers.js';
import type { TestSetup } from '@1api/server/__tests__/helpers.js';
import { registerDataCommands } from '../commands/data.js';
import { registerTablesCommand, registerTablesCreateCommand } from '../commands/tables.js';
import { registerConnectCommand } from '../commands/connect.js';
import { createRemoteConnection, type Connection } from '../connection.js';

let t: TestSetup;
let baseUrl: string;


/** 构造一个 commander program，注入预建的 Connection（跳过 config 解析）。 */
function buildProgram(conn: Connection): Command {
  const program = new Command();
  const getConn = async () => conn;
  registerTablesCommand(program, getConn);
  registerTablesCreateCommand(program, getConn);
  registerDataCommands(program, getConn);
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
    // commander { from: 'user' }：argv 仅含用户参数（不含 node/脚本路径）。
    await program.parseAsync(args, { from: 'user' });
  } catch (e) {
    if ((e as Error).message !== '__EXIT__') throw e;
  } finally {
    console.log = origLog;
    process.exit = origExit;
  }
  return { stdout: out.join('\n'), code };
}

describe('CLI 命令端到端（远程）', () => {
  beforeEach(async () => {
    t = await setupTest();
    // ⚠️ setupTest 在根路径挂载 erest，data 路由在 /data/*（非 /api/data/*）
    baseUrl = `${new URL(t.mcpUrl).origin}/data`;
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it('tables-create → create → list → get → update → delete', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);

    await run(buildProgram(conn), 'tables-create', 'widgets', '--fields', 'id:integer,name:string', '-F', 'json');
    const createRes = await run(buildProgram(conn), 'create', 'widgets', '-d', '{"name":"w1"}', '-F', 'json');
    const created = JSON.parse(createRes.stdout);
    expect(created.name).toBe('w1');

    const listRes = await run(buildProgram(conn), 'list', 'widgets', '-F', 'json');
    expect(JSON.parse(listRes.stdout).total).toBe(1);

    const pk = created.id;
    await run(buildProgram(conn), 'update', 'widgets', String(pk), '-d', '{"name":"w2"}');
    const getRes = await run(buildProgram(conn), 'get', 'widgets', String(pk), '-F', 'json');
    expect(JSON.parse(getRes.stdout).name).toBe('w2');

    await run(buildProgram(conn), 'delete', 'widgets', String(pk), '-y');
    expect(JSON.parse((await run(buildProgram(conn), 'list', 'widgets', '-F', 'json')).stdout).total).toBe(0);
  });

  it('describe -F json 输出 TableMeta', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'things', '--fields', 'id:integer', '-F', 'json');
    const res = await run(buildProgram(conn), 'describe', 'things', '-F', 'json');
    const meta = JSON.parse(res.stdout);
    expect(meta.name).toBe('things');
  });

  it('list --format csv 输出 CSV', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'csv_t', '--fields', 'id:integer,n:string', '-F', 'json');
    await run(buildProgram(conn), 'create', 'csv_t', '-d', '{"n":"a"}');
    await run(buildProgram(conn), 'create', 'csv_t', '-d', '{"n":"b"}');
    const res = await run(buildProgram(conn), 'list', 'csv_t', '-F', 'csv');
    expect(res.stdout).toContain('id');
    expect(res.stdout).toContain('n');
    expect(res.stdout).toContain('a');
    expect(res.stdout).toContain('b');
  });

  it('list --where 过滤', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'flt', '--fields', 'id:integer,n:string', '-F', 'json');
    await run(buildProgram(conn), 'create', 'flt', '-d', '{"n":"apple"}');
    await run(buildProgram(conn), 'create', 'flt', '-d', '{"n":"banana"}');
    const res = await run(buildProgram(conn), 'list', 'flt', '--where', 'n__eq=apple', '-F', 'json');
    expect(JSON.parse(res.stdout).total).toBe(1);
  });
});

describe('connect / config（全局 flag 与子命令同名冲突）', () => {
  // 回归：index.ts 顶层 program 与 connect 子命令同名定义 -H/-T/-D/-S，
  // commander 把值挂在 program 层，connect action 须用 optsWithGlobals() 取回。
  it('connect --host --token → 保存远程配置', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'cli-connect-'));
    const origHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      const program = new Command();
      program
        .name('one-api-cli')
        .option('-H, --host <url>', '')
        .option('-T, --token <token>', '')
        .option('-D, --db <path>', '')
        .option('-S, --system-db <path>', '');
      registerConnectCommand(program);
      const res = await run(program, 'connect', '--host', 'http://x:3000', '--token', 'oa_abc123');
      expect(res.code).toBe(0);
      const cfg = JSON.parse(readFileSync(join(tmpHome, '.one-api-cli', 'config.json'), 'utf-8'));
      expect(cfg).toEqual({ mode: 'remote', host: 'http://x:3000', token: 'oa_abc123' });
    } finally {
      process.env.HOME = origHome;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('connect --db → 保存本地直连配置', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'cli-connect-'));
    const origHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      const program = new Command();
      program
        .name('one-api-cli')
        .option('-D, --db <path>', '')
        .option('-S, --system-db <path>', '');
      registerConnectCommand(program);
      const res = await run(program, 'connect', '--db', '/tmp/biz.db', '--system-db', '/tmp/sys.db');
      expect(res.code).toBe(0);
      const cfg = JSON.parse(readFileSync(join(tmpHome, '.one-api-cli', 'config.json'), 'utf-8'));
      expect(cfg).toEqual({ mode: 'local', dbPath: '/tmp/biz.db', systemDbPath: '/tmp/sys.db' });
    } finally {
      process.env.HOME = origHome;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('connect 无参数 → exit 1', async () => {
    const program = new Command();
    program.name('one-api-cli').option('-H, --host <url>', '').option('-T, --token <t>', '');
    registerConnectCommand(program);
    const res = await run(program, 'connect');
    expect(res.code).toBe(1);
  });
});

