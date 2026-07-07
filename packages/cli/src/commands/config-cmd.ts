import type { Command } from 'commander';
import { loadConfig, resolveConfigPath } from '../config.js';

/** `one-api-cli config` 子命令：查看当前连接配置。 */
export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('查看当前连接配置')
    .action(() => {
      const cfg = loadConfig();
      console.log(`配置文件：${resolveConfigPath()}`);
      if (!cfg) {
        console.log('（尚未配置，请运行 one-api-cli connect）');
        return;
      }
      if (cfg.mode === 'remote') {
        console.log(`模式：远程\n地址：${cfg.host ?? '-'}\nToken：${(cfg.token ?? '').slice(0, 12)}****`);
      } else {
        console.log(`模式：本地直连\n业务库：${cfg.dbPath ?? '-'}`);
        if (cfg.systemDbPath) console.log(`系统库：${cfg.systemDbPath}`);
      }
    });
}
