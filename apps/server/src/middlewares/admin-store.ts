import type { Kysely } from 'kysely';
import type { ServerSystemDB } from '../db/types.js';

/** admin 行（含 password_hash，供登录校验；对外序列化时剔除） */
export interface AdminRow {
  id: number;
  name: string;
  nickname: string;
  password_hash: string;
  must_change_password: number;
  created_at: number;
  updated_at: number;
}

export interface AdminStore {
  findById(id: number): Promise<AdminRow | undefined>;
  findByName(name: string): Promise<AdminRow | undefined>;
  list(): Promise<AdminRow[]>;
  insert(input: {
    name: string;
    nickname: string;
    passwordHash: string;
    mustChangePassword?: number;
  }): Promise<AdminRow>;
  updatePassword(id: number, passwordHash: string): Promise<void>;
  setMustChangePassword(id: number, value: 0 | 1): Promise<void>;
  updateProfile(id: number, patch: { nickname?: string }): Promise<void>;
  delete(id: number): Promise<void>;
}

/** 工厂：注入系统库 Kysely 句柄，返回 admin 数据访问层 */
export function createAdminStore(systemDb: Kysely<ServerSystemDB>): AdminStore {
  return {
    async findById(id) {
      const r = await systemDb.selectFrom('admin').selectAll().where('id', '=', id).executeTakeFirst();
      return (r as AdminRow | undefined) ?? undefined;
    },
    async findByName(name) {
      const r = await systemDb.selectFrom('admin').selectAll().where('name', '=', name).executeTakeFirst();
      return (r as AdminRow | undefined) ?? undefined;
    },
    async list() {
      const r = await systemDb.selectFrom('admin').selectAll().orderBy('id', 'asc').execute();
      return r as AdminRow[];
    },
    async insert(input) {
      const now = Date.now();
      const r = await systemDb
        .insertInto('admin')
        .values({
          name: input.name,
          nickname: input.nickname,
          password_hash: input.passwordHash,
          must_change_password: input.mustChangePassword ?? 1,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return r as AdminRow;
    },
    async updatePassword(id, passwordHash) {
      const now = Date.now();
      await systemDb
        .updateTable('admin')
        .set({ password_hash: passwordHash, updated_at: now })
        .where('id', '=', id)
        .execute();
    },
    async setMustChangePassword(id, value) {
      const now = Date.now();
      await systemDb
        .updateTable('admin')
        .set({ must_change_password: value, updated_at: now })
        .where('id', '=', id)
        .execute();
    },
    async updateProfile(id, patch) {
      const now = Date.now();
      const sets: Record<string, unknown> = { updated_at: now };
      if (patch.nickname !== undefined) sets['nickname'] = patch.nickname;
      await systemDb.updateTable('admin').set(sets).where('id', '=', id).execute();
    },
    async delete(id) {
      await systemDb.deleteFrom('admin').where('id', '=', id).execute();
    },
  };
}
