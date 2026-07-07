import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/** 持久化连接配置（远程或本地二选一） */
export interface ConnectConfig {
  mode: 'remote' | 'local';
  /** 远程模式：server base url（含协议+端口，如 http://localhost:3000） */
  host?: string;
  /** 远程模式：明文 token（oa_xxx） */
  token?: string;
  /** 本地模式：业务库路径 */
  dbPath?: string;
  /** 本地模式：系统库路径（默认 <dbPath 同目录>/system.db） */
  systemDbPath?: string;
}

/** 配置文件路径（~/.one-api-cli/config.json） */
export function resolveConfigPath(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, '.one-api-cli', 'config.json');
}

/** 读取配置；不存在返回 null。 */
export function loadConfig(): ConnectConfig | null {
  const p = resolveConfigPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ConnectConfig;
  } catch {
    return null;
  }
}

/** 写入配置（自动创建目录）。 */
export function saveConfig(cfg: ConnectConfig): void {
  const p = resolveConfigPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
}

/**
 * 从命令行 flag + 文件合并出连接配置。
 * 优先级：flag（显式提供）> 文件 > null（缺失）。
 *
 * @param flag 命令行选项（远程：host/token；本地：db）
 * @returns 合并后的配置；若关键字段缺失返回 null（调用方提示用户 connect）
 */
export function resolveConnectOptions(flag: {
  host?: string;
  token?: string;
  db?: string;
}): ConnectConfig | null {
  const file = loadConfig();
  // 本地模式：flag.db 或 file.mode==='local'
  if (flag.db) {
    return { mode: 'local', dbPath: flag.db };
  }
  if (file?.mode === 'local' && file.dbPath) {
    // exactOptionalPropertyTypes：可选属性不可赋 undefined，条件挂载 systemDbPath。
    const cfg: ConnectConfig = { mode: 'local', dbPath: file.dbPath };
    if (file.systemDbPath) cfg.systemDbPath = file.systemDbPath;
    return cfg;
  }
  // 远程模式：flag host+token 或 file host+token
  const host = flag.host ?? file?.host;
  const token = flag.token ?? file?.token;
  if (host && token) {
    return { mode: 'remote', host, token };
  }
  return null;
}
