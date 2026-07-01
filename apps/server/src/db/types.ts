import type { Generated } from 'kysely';

/** Phase 1 已有：table_meta 行（与 packages/engine system-db.ts 对齐） */
export interface TableMetaRow {
  id: Generated<number>;
  name: string;
  label: string;
  primary_key: string;
  fields: string; // JSON: FieldMeta[]
  is_published: number; // 0/1
  is_editable: number; // 0/1
  note: string | null;
  created_at: number; // 毫秒时间戳
  updated_at: number;
}

/** Phase 2 新增：admin 行 */
export interface AdminRow {
  id: Generated<number>;
  name: string;
  nickname: string;
  password_hash: string; // bcrypt
  must_change_password: number; // 0/1
  created_at: number;
  updated_at: number;
}

/** Phase 2 新增：api_token 行 */
export interface ApiTokenRow {
  id: Generated<number>;
  name: string;
  token_hash: string; // sha256(明文)，UNIQUE
  token_prefix: string; // 如 oa_a3f9****
  permissions: string; // JSON: TokenPermissions
  is_active: number; // 0/1
  expires_at: number | null; // 毫秒时间戳，可空
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

/** 系统库完整类型（server 侧使用：admin/api_token/table_meta） */
export interface ServerSystemDB {
  admin: AdminRow;
  api_token: ApiTokenRow;
  table_meta: TableMetaRow;
}
