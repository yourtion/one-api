import type { Kysely } from 'kysely';
import type { ServerSystemDB } from '../db/types.js';

let systemDbInstance: Kysely<ServerSystemDB> | null = null;

/** 装配并缓存全局系统库 Kysely 单例（与 engine 单例一致的模式） */
export function setSystemDb(db: Kysely<ServerSystemDB> | null): void {
  systemDbInstance = db;
}

/** 取已装配的系统库（未装配抛错） */
export function getSystemDb(): Kysely<ServerSystemDB> {
  if (!systemDbInstance) throw new Error('systemDb 未装配：请先调 setSystemDb()');
  return systemDbInstance;
}
