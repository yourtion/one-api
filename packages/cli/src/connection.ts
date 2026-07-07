import { createClient, type OneApiClient } from '@1api/sdk';
import type {
  TableMeta,
  ListOptions,
  ListResult,
  CreateModelOptions,
  FieldMetaInput,
} from '@1api/shared';
import { createEngine } from '@1api/engine';
import { resolveLocalToken } from './local-auth.js';

type Row = Record<string, unknown>;

/**
 * 连接抽象：屏蔽远程（SDK）/ 本地（engine）差异。命令层只依赖此接口。
 */
export interface Connection {
  /** 列出所有表（本地：枚举 table_meta；远程：不支持，抛错提示） */
  listTables(): Promise<TableMeta[]>;
  /** 表结构 */
  describe(table: string): Promise<TableMeta>;
  /** 列表查询 */
  list(table: string, opts?: ListOptions): Promise<ListResult<Row>>;
  /** 单条 */
  get(table: string, pk: string | number): Promise<Row>;
  /** 创建 */
  create(table: string, data: Row): Promise<Row>;
  /** 更新 */
  update(table: string, pk: string | number, data: Row): Promise<{ success: true }>;
  /** 删除 */
  delete(table: string, pk: string | number): Promise<{ success: true }>;
  /** 自增 */
  incr(table: string, pk: string | number, field: string, count?: number): Promise<{ success: true }>;
  /** Schema 演进 */
  schema: {
    createTable(opts: CreateModelOptions): Promise<TableMeta>;
    addField(table: string, field: FieldMetaInput): Promise<TableMeta>;
  };
  /** 关闭（释放句柄，本地模式有用） */
  close?(): Promise<void>;
}

/** 远程连接：包装 SDK 客户端。 */
export function createRemoteConnection(baseUrl: string, token: string): Connection & { client: OneApiClient } {
  const client = createClient(baseUrl, token);
  return {
    client,
    async listTables() {
      throw new Error(
        '远程模式不支持枚举表（对外通道无 list 接口）。请用本地直连模式（--db）或管理界面查看全部表。',
      );
    },
    describe: (table) => client.describe(table),
    list: (table, opts) => client.list(table, opts),
    get: (table, pk) => client.get(table, pk),
    create: (table, data) => client.create(table, data),
    update: (table, pk, data) => client.update(table, pk, data),
    delete: (table, pk) => client.delete(table, pk),
    incr: (table, pk, field, count) => client.incr(table, pk, field, count),
    schema: client.schema,
  };
}

/**
 * 本地直连连接：包装 engine。token 从系统库校验（与 server 鉴权语义一致）。
 * 数据操作用 internal:true（管理员级，跳过 is_published/is_editable；保留白名单注入防护）。
 *
 * @param token 明文 token；null 表示信任本地（CLI 运行者有文件系统权限）
 */
export async function createLocalConnection(
  dbPath: string,
  systemDbPath: string,
  token: string | null,
): Promise<Connection> {
  if (token) {
    const resolved = await resolveLocalToken(systemDbPath, token);
    if (!resolved) throw new Error('无效或已过期的 Token（本地系统库校验失败）');
  }
  // 无 token：本地直连信任模式（CLI 运行者有文件系统权限，token 校验非安全边界）

  const engine = await createEngine({ businessDbPath: dbPath, systemDbPath });

  return {
    async listTables() {
      return engine.metadata.listMetas();
    },
    describe: (table) => engine.data.describe(table, { internal: true }),
    list: (table, opts) => engine.data.list(table, opts, { internal: true }),
    get: async (table, pk) => {
      const row = await engine.data.get(table, pk, { internal: true });
      if (!row) throw new Error(`记录 ${pk} 不存在于表 ${table}`);
      return row;
    },
    create: (table, data) => engine.data.create(table, data, { internal: true }),
    update: async (table, pk, data) => {
      await engine.data.update(table, pk, data, { internal: true });
      return { success: true } as const;
    },
    delete: async (table, pk) => {
      await engine.data.delete(table, pk, { internal: true });
      return { success: true } as const;
    },
    incr: async (table, pk, field, count = 1) => {
      await engine.data.incr(table, pk, field, count, { internal: true });
      return { success: true } as const;
    },
    schema: {
      createTable: (opts) => engine.schema.createModel(opts),
      addField: (table, field) => engine.schema.addField(table, field),
    },
    async close() {
      await engine.destroy();
    },
  };
}
