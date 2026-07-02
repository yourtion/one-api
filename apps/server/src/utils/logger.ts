import debug from 'debug';
import { format as utilFormat } from 'node:util';

/**
 * 日志分级：
 * - startup / error：关键日志，**始终输出**（不受 DEBUG 控制），确保 dev/prod 都能看到启动信息和报错。
 * - request / sql：噪音日志，按需开启（DEBUG=one-api:request 或 DEBUG=one-api:*）。
 *
 * 之所以 startup/error 不复用 debug()：debug 默认静默（需 DEBUG 环境变量），会导致 dev 时
 * 完全看不到服务端发生了什么，排查困难。关键日志必须默认可见。
 * 采用与 debug 一致的 printf 格式化（%s/%d/%j 等，由 node:util.format 处理），保持调用处风格统一。
 */
const ts = () => new Date().toISOString();

export const log = {
  request: debug('one-api:request'),
  sql: debug('one-api:sql'),
  error: (fmt: string, ...args: unknown[]): void => {
    console.error('[one-api:error]', ts(), utilFormat(fmt, ...args));
  },
  startup: (fmt: string, ...args: unknown[]): void => {
    console.log('[one-api:startup]', ts(), utilFormat(fmt, ...args));
  },
};
