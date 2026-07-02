import type { FieldMeta, TableMeta, TokenPermissions } from '@1api/shared';

/** /api/auth/me 与 login.admin 返回（camelCase） */
export interface CurrentAdmin {
  id: number;
  name: string;
  nickname: string;
  mustChangePassword: boolean;
}

/** Token 列表项（snake_case，DB 透传，无 hash/明文） */
export interface TokenListVO {
  id: number;
  name: string;
  token_prefix: string;
  permissions: TokenPermissions;
  is_active: boolean;
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Token 创建返回（camelCase，含明文 token 仅一次） */
export interface TokenCreateVO {
  id: number;
  name: string;
  token: string;
  tokenPrefix: string;
  permissions: TokenPermissions;
}

/** 管理员列表项（snake_case） */
export interface AdminVO {
  id: number;
  name: string;
  nickname: string;
  must_change_password: number; // 0/1
  created_at: number;
  updated_at: number;
}

/** 新建模型入参 */
export interface CreateModelInput {
  name: string;
  label: string;
  fields: FieldMetaInput[];
  note?: string | null;
  autoTimestamps?: boolean;
}

/** 单字段配置入参（提交新建/编辑模型用） */
export interface FieldMetaInput {
  name: string;
  jsonType: 'string' | 'integer' | 'number' | 'boolean' | 'datetime';
  label?: string;
  nullable?: boolean;
  defaultValue?: unknown;
  isPrimary?: boolean;
  isAutoIncrement?: boolean;
  isHidden?: boolean;
  isReadonly?: boolean;
  enumValues?: string[];
}

/** 列表结果（与 shared ListResult 对齐，rows 非 items） */
export interface ListResult<T> { rows: T[]; total: number; page: number; size: number }

/** 列表查询参数 */
export interface ListQuery {
  page?: number;
  size?: number;
  order?: string;
  q?: string;
  [key: string]: unknown; // field__op=v 过滤
}

export type { TableMeta, FieldMeta, TokenPermissions };
