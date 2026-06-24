import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface AppConfig {
  port: number;
  systemDbPath: string;
  businessDbPath: string;
  sessionSecret: string;
  /** 默认管理员账号（仅首启用） */
  defaultAdmin: { name: string; password: string };
}

function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function loadConfig(): AppConfig {
  const dataDir = join(homedir(), '.one-api');
  return {
    port: envInt('PORT', 3000),
    systemDbPath: process.env['ONE_API_SYSTEM_DB'] ?? join(dataDir, 'system.db'),
    businessDbPath: process.env['ONE_API_BUSINESS_DB'] ?? join(dataDir, 'business.db'),
    sessionSecret: process.env['ONE_API_SESSION_SECRET'] ?? randomBytes(32).toString('hex'),
    defaultAdmin: {
      name: process.env['ONE_API_DEFAULT_ADMIN_NAME'] ?? 'admin',
      password: process.env['ONE_API_DEFAULT_ADMIN_PASSWORD'] ?? '123456',
    },
  };
}
