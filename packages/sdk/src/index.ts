// @1api/sdk 入口
export { createClient } from './client.js';
export type { OneApiClient, CreateClientOptions } from './client.js';
export { OneApiError } from './error.js';
// re-export shared 类型，便于消费侧一处导入
export type {
  TableMeta,
  FieldMeta,
  FieldMetaInput,
  CreateModelOptions,
  ListOptions,
  ListResult,
  FilterOperator,
} from '@1api/shared';
