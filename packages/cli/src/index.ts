#!/usr/bin/env node
import { ONE_API_VERSION } from '@1api/shared';
import { Command } from 'commander';
import { registerConnectCommand } from './commands/connect.js';
import { registerConfigCommand } from './commands/config-cmd.js';
import {
  registerTablesCommand,
  registerTablesCreateCommand,
  registerAddFieldCommand,
} from './commands/tables.js';
import { registerDataCommands } from './commands/data.js';
import { resolveConnectOptions } from './config.js';
import { createRemoteConnection, createLocalConnection, type Connection } from './connection.js';
import { ensureSystemDb } from './local-auth.js';
import { dirname, join } from 'node:path';

const program = new Command();
program
  .name('one-api-cli')
  .description('one-api 终端工具（远程模式走 HTTP，本地模式直连 SQLite）')
  .version(ONE_API_VERSION)
  .option('-H, --host <url>', '远程 server 地址（覆盖配置文件）')
  .option('-T, --token <token>', '远程 token')
  .option('-D, --db <path>', '本地业务库路径')
  .option('-S, --system-db <path>', '本地系统库路径');

/** 解析全局 flag + 配置文件 → Connection（延迟建立：仅需要时）。 */
async function getConnection(): Promise<Connection> {
  const opts = program.opts();
  const cfg = resolveConnectOptions({
    host: opts.host,
    token: opts.token,
    db: opts.db,
    systemDb: opts.systemDb,
  });
  if (!cfg) {
    console.error(
      '✗ 未配置连接。请先运行：one-api-cli connect --host <url> --token <t>（或 --db <path>）',
    );
    process.exit(1);
  }
  if (cfg.mode === 'remote') {
    return createRemoteConnection(`${cfg.host}/api/data`, cfg.token!);
  }
  // 本地：确保系统库存在；token 可选（无 token 时信任本地，见 createLocalConnection）
  const sysPath = cfg.systemDbPath ?? join(dirname(cfg.dbPath!), 'system.db');
  ensureSystemDb(sysPath);
  const localToken = cfg.token ?? process.env.ONE_API_CLI_TOKEN ?? null;
  return createLocalConnection(cfg.dbPath!, sysPath, localToken);
}

// connect / config 不需要 Connection
registerConnectCommand(program);
registerConfigCommand(program);

// 其余命令通过 getConnection 延迟建立连接
registerTablesCommand(program, getConnection);
registerTablesCreateCommand(program, getConnection);
registerAddFieldCommand(program, getConnection);
registerDataCommands(program, getConnection);

program.parseAsync(process.argv).catch((e) => {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
});
