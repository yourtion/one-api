import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTest } from '@1api/server/__tests__/helpers.js';
import type { TestSetup } from '@1api/server/__tests__/helpers.js';
import { registerDataCommands } from '../commands/data.js';
import { registerTablesCommand, registerTablesCreateCommand, registerAddFieldCommand } from '../commands/tables.js';
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
  registerAddFieldCommand(program, getConn);
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

  it('export → 文件（CSV）+ import 回来', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'exp', '--fields', 'id:integer,n:string', '-F', 'json');
    await run(buildProgram(conn), 'create', 'exp', '-d', '{"n":"a"}');
    await run(buildProgram(conn), 'create', 'exp', '-d', '{"n":"b"}');

    const dir = mkdtempSync(join(tmpdir(), 'cli-export-'));
    try {
      const csvPath = join(dir, 'exp.csv');
      const expRes = await run(buildProgram(conn), 'export', 'exp', '-F', 'csv', '-o', csvPath);
      expect(expRes.stdout).toContain('已导出 2 行');
      const csv = readFileSync(csvPath, 'utf-8');
      expect(csv).toContain('id');
      expect(csv).toContain('n');
      expect(csv).toContain('a');
      expect(csv).toContain('b');

      // 导入到新表
      await run(buildProgram(conn), 'tables-create', 'imp', '--fields', 'id:integer,n:string', '-F', 'json');
      const impRes = await run(buildProgram(conn), 'import', 'imp', csvPath);
      expect(impRes.stdout).toContain('成功 2/2');
      const listRes = await run(buildProgram(conn), 'list', 'imp', '-F', 'json');
      expect(JSON.parse(listRes.stdout).total).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('export → stdout（JSON）', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'expj', '--fields', 'id:integer,n:string', '-F', 'json');
    await run(buildProgram(conn), 'create', 'expj', '-d', '{"n":"x"}');
    const res = await run(buildProgram(conn), 'export', 'expj', '-F', 'json');
    const arr = JSON.parse(res.stdout);
    expect(arr).toHaveLength(1);
    expect(arr[0].n).toBe('x');
  });

  it('import JSON 文件', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'impj', '--fields', 'id:integer,n:string', '-F', 'json');
    const dir = mkdtempSync(join(tmpdir(), 'cli-impj-'));
    try {
      const jsonPath = join(dir, 'data.json');
      writeFileSync(jsonPath, JSON.stringify([{ n: 'p' }, { n: 'q' }]), 'utf-8');
      const res = await run(buildProgram(conn), 'import', 'impj', jsonPath);
      expect(res.stdout).toContain('成功 2/2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('create --data-file 从文件读 JSON', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'df', '--fields', 'id:integer,n:string', '-F', 'json');
    const dir = mkdtempSync(join(tmpdir(), 'cli-datafile-'));
    try {
      const f = join(dir, 'r.json');
      writeFileSync(f, '{"n":"fromfile"}', 'utf-8');
      const res = await run(buildProgram(conn), 'create', 'df', '--data-file', f, '-F', 'json');
      expect(JSON.parse(res.stdout).n).toBe('fromfile');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('create -d @file 简写读文件', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'at', '--fields', 'id:integer,n:string', '-F', 'json');
    const dir = mkdtempSync(join(tmpdir(), 'cli-atfile-'));
    try {
      const f = join(dir, 'r.json');
      writeFileSync(f, '{"n":"atval"}', 'utf-8');
      const res = await run(buildProgram(conn), 'create', 'at', '-d', `@${f}`, '-F', 'json');
      expect(JSON.parse(res.stdout).n).toBe('atval');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('create 无 --data/--data-file → exit 1', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'nd', '--fields', 'id:integer,n:string', '-F', 'json');
    const res = await run(buildProgram(conn), 'create', 'nd');
    expect(res.code).toBe(1);
  });

  it('tables -F json → 远程模式抛友好错误（listTables 不支持）', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await expect(run(buildProgram(conn), 'tables', '-f', 'json')).rejects.toThrow(/远程模式|不支持枚举/);
  });

  it('describe -F table（非 json）输出表格', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'dt', '--fields', 'id:integer', '-F', 'json');
    const res = await run(buildProgram(conn), 'describe', 'dt', '-F', 'table');
    expect(res.stdout).toContain('dt');
  });

  it('tables-create 无 --fields → exit 1', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    const res = await run(buildProgram(conn), 'tables-create', 'nofields', '-F', 'json');
    expect(res.code).toBe(1);
  });

  it('tables-create --label + --auto-timestamps', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    const res = await run(
      buildProgram(conn),
      'tables-create', 'lbl', '--fields', 'id:integer,n:string', '--label', '我的表', '--auto-timestamps', '-F', 'json',
    );
    const meta = JSON.parse(res.stdout);
    expect(meta.label).toBe('我的表');
    expect(meta.fields.map((f: { name: string }) => f.name)).toContain('created_at');
  });

  it('tables-create -F table（非 json）输出文本', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    const res = await run(buildProgram(conn), 'tables-create', 'tf', '--fields', 'id:integer', '-F', 'table');
    expect(res.stdout).toContain('已创建');
  });

  it('add-field 向表新增字段（带 label）', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'af', '--fields', 'id:integer', '-F', 'json');
    const res = await run(buildProgram(conn), 'add-field', 'af', 'note', 'string', '-L', '备注', '-F', 'json');
    const fields = JSON.parse(res.stdout).fields.map((f: { name: string }) => f.name);
    expect(fields).toContain('note');
  });

  it('add-field -F table（非 json）输出文本', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await run(buildProgram(conn), 'tables-create', 'aft', '--fields', 'id:integer', '-F', 'json');
    const res = await run(buildProgram(conn), 'add-field', 'aft', 'note', 'string', '-F', 'table');
    expect(res.stdout).toContain('已加入');
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

