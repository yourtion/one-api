import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 确保数据库文件所在目录存在（递归创建）。
 * better-sqlite3 打开不存在的目录下的 db 路径会抛
 * "Cannot open database because the directory does not exist"，
 * 故在 new Database(path) 前调用本函数兜底。
 */
export function ensureDbDir(path: string): void {
  const dir = dirname(path);
  if (dir) mkdirSync(dir, { recursive: true });
}
