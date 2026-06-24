/** SQLite 列存储类型 */
export type SqliteType = 'INTEGER' | 'REAL' | 'TEXT' | 'NUMERIC' | 'BLOB';

/** 逻辑类型（SQLite 无原生 boolean/datetime，用此标记） */
export type JsonType = 'string' | 'integer' | 'number' | 'boolean' | 'datetime';

/** 字段元数据 */
export interface FieldMeta {
  name: string;
  label: string;
  sqliteType: SqliteType;
  jsonType: JsonType;
  nullable: boolean;
  defaultValue: unknown;
  isPrimary: boolean;
  isAutoIncrement: boolean;
  /** —— 用户可自定义的展示层标记（导入/刷新时保留）—— */
  isHidden: boolean;
  isReadonly: boolean;
  enumValues?: string[];
}

/** 建模时的字段输入（省略由系统推断的 sqliteType 等结构字段） */
export interface FieldMetaInput {
  name: string;
  jsonType: JsonType;
  label?: string;
  nullable?: boolean;
  defaultValue?: unknown;
  isPrimary?: boolean;
  isAutoIncrement?: boolean;
  isHidden?: boolean;
  isReadonly?: boolean;
  enumValues?: string[];
}

/** 表元数据 */
export interface TableMeta {
  id: number;
  name: string;
  label: string;
  primaryKey: string;
  fields: FieldMeta[];
  isPublished: boolean;
  isEditable: boolean;
  note: string | null;
  createdAt: number; // 毫秒时间戳
  updatedAt: number;
}

/** Token 权限 */
export interface TokenPermissions {
  tables: string[] | ['*'];
  actions: ('read' | 'write' | 'schema')[];
}

/** 统一响应信封 */
export interface ApiResponse<T> {
  success: true;
  data: T;
}
export interface ApiError {
  success: false;
  error: { code: string; message: string };
}

/** 过滤操作符 */
export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in';

/** 列表查询选项 */
export interface ListOptions {
  page?: number;
  size?: number;
  /** 形如 "id:desc,name:asc" */
  order?: string;
  q?: string;
  filters?: Record<string, [FilterOperator, unknown]>;
}

/** 列表结果 */
export interface ListResult<T> {
  rows: T[];
  total: number;
  page: number;
  size: number;
}

/** 新建模型选项 */
export interface CreateModelOptions {
  name: string;
  label: string;
  fields: FieldMetaInput[];
  note?: string | null;
  autoTimestamps?: boolean;
}
