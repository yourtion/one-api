/** 默认分页 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_SIZE = 20;
export const MAX_SIZE = 100;

/** API 路径前缀 */
export const API_PATHS = {
  auth: '/api/auth',
  admin: '/api/admin',
  data: '/api/data',
  mcp: '/mcp',
} as const;

/** 角色 */
export const ROLE = {
  ADMIN: 'admin',
} as const;

/** 动作（与 TokenPermissions.actions 对齐） */
export const ACTION = {
  READ: 'read',
  WRITE: 'write',
  SCHEMA: 'schema',
} as const;

/** 新建模型/字段的名称校验：小写字母开头，仅小写字母/数字/下划线 */
export const NAME_REGEX = /^[a-z][a-z0-9_]*$/;

/** 系统保留字（新建模型/字段时禁止使用） */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'schema',
  'records',
  'incr',
]);

/** 是否为保留字 */
export function isReservedName(name: string): boolean {
  return RESERVED_NAMES.has(name);
}

/** 名称是否合法（正则 + 非保留字） */
export function isValidName(name: string): boolean {
  return NAME_REGEX.test(name) && !RESERVED_NAMES.has(name);
}

/** 错误码（按前缀分类，前后端共用） */
export const ErrorCode = {
  // TABLE_*
  TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
  TABLE_NO_PRIMARY_KEY: 'TABLE_NO_PRIMARY_KEY',
  TABLE_COMPOSITE_PRIMARY_KEY: 'TABLE_COMPOSITE_PRIMARY_KEY',
  TABLE_NOT_EDITABLE: 'TABLE_NOT_EDITABLE',
  TABLE_ALREADY_EXISTS: 'TABLE_ALREADY_EXISTS',
  // VALIDATION_*
  VALIDATION_FAIL: 'VALIDATION_FAIL',
  INVALID_NAME: 'INVALID_NAME',
  RESERVED_NAME: 'RESERVED_NAME',
  // DB_*
  DB_ERROR: 'DB_ERROR',
  // INTERNAL_*
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // AUTH_* / TOKEN_*（Phase 2 起用，此处先定义保持前缀完整）
  INVALID_TOKEN: 'INVALID_TOKEN',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'AUTH_PASSWORD_CHANGE_REQUIRED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
