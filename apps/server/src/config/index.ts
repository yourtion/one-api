import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AppConfig {
  port: number;
  systemDbPath: string;
  businessDbPath: string;
  /** 默认管理员账号（仅首启用） */
  defaultAdmin: { name: string; password: string };
}

/** 在初始化数据库前校验最终生效的端口（显式配置优先于环境变量）。 */
export function parsePort(value: string | number): number {
  const port = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`端口必须是 0..65535 的整数，收到: ${value}`);
  }
  return port;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = process.env['ONE_API_DATA_DIR'] ?? join(homedir(), '.one-api');
  return {
    port: parsePort(overrides.port ?? process.env['PORT'] ?? 3000),
    systemDbPath: overrides.systemDbPath ?? process.env['ONE_API_SYSTEM_DB'] ?? join(dataDir, 'system.db'),
    businessDbPath: overrides.businessDbPath ?? process.env['ONE_API_BUSINESS_DB'] ?? join(dataDir, 'business.db'),
    defaultAdmin: overrides.defaultAdmin ?? {
      name: process.env['ONE_API_DEFAULT_ADMIN_NAME'] ?? 'admin',
      password: process.env['ONE_API_DEFAULT_ADMIN_PASSWORD'] ?? '123456',
    },
  };
}
