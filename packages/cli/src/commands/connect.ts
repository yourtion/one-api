import type { Command } from 'commander';
import { saveConfig } from '../config.js';

/** `one-api-cli connect` 子命令：保存连接配置到 ~/.one-api-cli/config.json。
 *
 * 注意：本命令定义的 -H/-T/-D/-S 与 index.ts 顶层 program 选项同名。
 * commander 在二者同名时把值挂在 program 层，子命令的 opts 参数取不到，
 * 故 action 内用 `this.optsWithGlobals()` 合并读取（含 program 层）。 */
export function registerConnectCommand(program: Command): void {
  program
    .command('connect')
    .description('保存连接配置（远程 --host+--token 或本地 --db）')
    .option('-H, --host <url>', '远程 server 地址（如 http://localhost:3000）')
    .option('-T, --token <token>', '对外通道 token（oa_xxx）')
    .option('-D, --db <path>', '本地业务库路径（本地直连模式）')
    .option('-S, --system-db <path>', '本地系统库路径（默认 <db 同目录>/system.db）')
    .action(function (this: Command) {
      // 合并 program 层（全局 flag）+ connect 子命令层同名 flag 的解析结果。
      const opts = this.optsWithGlobals();
      if (opts.db) {
        const cfg: { mode: 'local'; dbPath: string; systemDbPath?: string } = {
          mode: 'local',
          dbPath: opts.db,
        };
        if (opts.systemDb) cfg.systemDbPath = opts.systemDb;
        saveConfig(cfg);
        console.log(`✓ 已保存本地直连配置（业务库：${opts.db}）`);
        return;
      }
      if (opts.host && opts.token) {
        saveConfig({ mode: 'remote', host: opts.host, token: opts.token });
        console.log(`✓ 已保存远程连接配置（${opts.host}）`);
        return;
      }
      console.error('✗ 需要 --host + --token（远程）或 --db（本地）。见 --help。');
      process.exit(1);
    });
}
