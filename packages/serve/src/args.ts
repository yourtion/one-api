import type { AppConfig } from '@1api/server';

export interface ServeArgs {
  port?: number;
  noWeb?: boolean;
  dataDir?: string;
  systemDb?: string;
  businessDb?: string;
  adminName?: string;
  adminPassword?: string;
}

const VALUE_FLAGS = new Set(['--port', '--data-dir', '--system-db', '--business-db', '--admin-name', '--admin-password']);
const BOOL_FLAGS = new Set(['--no-web']);

/** 手写 argv 解析：仅支持 --key value 与 --no-key 两种形态。 */
export function parseArgs(argv: string[]): ServeArgs {
  const args: ServeArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) continue;
    if (BOOL_FLAGS.has(tok)) {
      args.noWeb = true;
    } else if (VALUE_FLAGS.has(tok)) {
      const val = argv[++i];
      if (val === undefined) throw new Error(`参数 ${tok} 缺少值`);
      switch (tok) {
        case '--port': {
          const n = Number(val);
          if (!Number.isFinite(n)) throw new Error(`端口必须是数字，收到: ${val}`);
          args.port = n;
          break;
        }
        case '--data-dir': args.dataDir = val; break;
        case '--system-db': args.systemDb = val; break;
        case '--business-db': args.businessDb = val; break;
        case '--admin-name': args.adminName = val; break;
        case '--admin-password': args.adminPassword = val; break;
      }
    } else {
      throw new Error(`未知参数: ${tok}`);
    }
  }
  return args;
}

/**
 * 合并 flag + env → Partial<AppConfig>（flag > env > 默认）。
 * 返回的字段用于覆盖 server loadConfig 的默认值；未提供的字段不出现（走 server 默认）。
 */
export function mergeConfig(args: ServeArgs): Partial<AppConfig> {
  const cfg: Partial<AppConfig> = {};

  const port = args.port ?? (process.env['PORT'] ? Number(process.env['PORT']) : undefined);
  if (port !== undefined && Number.isFinite(port)) cfg.port = port;

  // dataDir 优先级：flag > env；用于派生 db 路径
  const dataDir = args.dataDir ?? process.env['ONE_API_DATA_DIR'];
  const systemDb = args.systemDb ?? process.env['ONE_API_SYSTEM_DB'] ?? (dataDir ? `${dataDir}/system.db` : undefined);
  const businessDb = args.businessDb ?? process.env['ONE_API_BUSINESS_DB'] ?? (dataDir ? `${dataDir}/business.db` : undefined);
  if (systemDb !== undefined) cfg.systemDbPath = systemDb;
  if (businessDb !== undefined) cfg.businessDbPath = businessDb;

  const adminName = args.adminName ?? process.env['ONE_API_DEFAULT_ADMIN_NAME'];
  const adminPassword = args.adminPassword ?? process.env['ONE_API_DEFAULT_ADMIN_PASSWORD'];
  if (adminName !== undefined || adminPassword !== undefined) {
    cfg.defaultAdmin = {
      name: adminName ?? 'admin',
      password: adminPassword ?? '123456',
    };
  }

  return cfg;
}
