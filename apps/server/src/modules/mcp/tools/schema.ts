import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isReservedName, Errors, type FieldMetaInput } from '@1api/shared';
import { getEngine } from '../../../core/engine.js';
import type { McpCurrentToken } from '../auth.js';
import { checkTableAction } from '../auth.js';
import { createTableSchema, addFieldSchema } from '../schemas.js';

/**
 * 注册 Schema 演进 tools：create_table / add_field。
 * 要求 token permissions 含 'schema' action，且 tables 覆盖目标表
 * （create_table 时 tables 须含 '*' 或新表名——见 checkTableAction）。
 *
 * 与 Phase 2 /api/data/_schema/* HTTP API 完全对称（同 engine 调用、同权限校验、同保留字拦截）。
 */
export function registerSchemaTools(server: McpServer, token: McpCurrentToken): void {
  const engine = () => getEngine();

  server.registerTool(
    'create_table',
    {
      title: '新建表（模型）',
      description:
        '创建一张新表并注册元信息。表名须匹配 ^[a-z][a-z0-9_]*$ 且非保留字（schema/records/incr）。要求 token 含 schema 权限且 tables 覆盖新表名。',
      inputSchema: createTableSchema,
    },
    async ({ name, label, fields, note, autoTimestamps }) => {
      // checkTableAction 的 table 参数用新表名（与 data-schema.ts 的 tableFromBody:'name' 对称）
      checkTableAction(token, name, 'schema');
      if (isReservedName(name)) throw Errors.reservedName(name);
      const opts: {
        name: string;
        label: string;
        fields: FieldMetaInput[];
        note?: string | null;
        autoTimestamps?: boolean;
      } = { name, label, fields: fields as unknown as FieldMetaInput[] };
      // exactOptionalPropertyTypes：条件挂载可选属性（见 AGENTS.md §2）
      if (note !== undefined) opts.note = note;
      if (autoTimestamps !== undefined) opts.autoTimestamps = autoTimestamps;
      const meta = await engine().schema.createModel(opts);
      return { content: [{ type: 'text', text: JSON.stringify(meta) }] };
    },
  );

  server.registerTool(
    'add_field',
    {
      title: '新增字段',
      description: '向已存在的表新增一个字段。要求 token 含 schema 权限且 tables 覆盖目标表。',
      inputSchema: addFieldSchema,
    },
    async ({ table, field }) => {
      checkTableAction(token, table, 'schema');
      const meta = await engine().schema.addField(table, field as unknown as FieldMetaInput);
      return { content: [{ type: 'text', text: JSON.stringify(meta) }] };
    },
  );
}
