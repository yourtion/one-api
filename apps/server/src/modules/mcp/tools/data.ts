import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Errors, type ListOptions } from '@1api/shared';
import { getEngine } from '../../../core/engine.js';
import type { McpCurrentToken } from '../auth.js';
import { checkTableAction } from '../auth.js';
import {
  describeTableSchema,
  listRecordsSchema,
  getRecordSchema,
  createRecordSchema,
  updateRecordSchema,
  deleteRecordSchema,
  incrementFieldSchema,
} from '../schemas.js';

/**
 * 注册 7 个数据 CRUD tools 到 McpServer。
 * 每个 tool：checkTableAction(token, table, action) → 调 engine.data.*（internal:false）。
 * engine 抛 AppError 由 MCP SDK 自动转 isError 响应（无需 try/catch）。
 *
 * 约定（spec §4.2）：未发布表对 MCP 不可见——describe 遇 is_published=false 抛 tableNotFound。
 * list/get 由 engine 内部 resolveForRead 校验 is_published，无需 MCP 侧重复处理。
 */
export function registerDataTools(server: McpServer, token: McpCurrentToken): void {
  const engine = () => getEngine();

  server.registerTool(
    'describe_table',
    {
      title: '查看表结构',
      description: '获取指定表的字段定义、主键、是否发布/可编辑等元信息。未发布表返回 404。',
      inputSchema: describeTableSchema,
    },
    async ({ table }) => {
      checkTableAction(token, table, 'read');
      const meta = await engine().data.describe(table);
      // engine.describe 不校验 is_published；MCP 侧按 spec 显式拦截未发布表
      if (!meta.isPublished) throw Errors.tableNotFound(table);
      return { content: [{ type: 'text', text: JSON.stringify(meta) }] };
    },
  );

  server.registerTool(
    'list_records',
    {
      title: '查询记录列表',
      description: '分页查询表记录，支持排序、全文搜索、字段过滤。未发布表返回 404。',
      inputSchema: listRecordsSchema,
    },
    async ({ table, page, size, order, q, filters }) => {
      checkTableAction(token, table, 'read');
      // exactOptionalPropertyTypes：条件挂载可选属性（与 utils/list-query.ts 一致）
      const opts: ListOptions = {};
      if (page !== undefined) opts.page = page;
      if (size !== undefined) opts.size = size;
      if (order !== undefined) opts.order = order;
      if (q !== undefined) opts.q = q;
      if (filters !== undefined) opts.filters = filters;
      const result = await engine().data.list(table, opts);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'get_record',
    {
      title: '查询单条记录',
      description: '按主键取单条记录。不存在或未发布表返回 404。',
      inputSchema: getRecordSchema,
    },
    async ({ table, pk }) => {
      checkTableAction(token, table, 'read');
      const row = await engine().data.get(table, pk);
      if (!row) throw Errors.tableNotFound(table);
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    },
  );

  server.registerTool(
    'create_record',
    {
      title: '创建记录',
      description: '在指定表新增一行。不可编辑表返回 403。',
      inputSchema: createRecordSchema,
    },
    async ({ table, data }) => {
      checkTableAction(token, table, 'write');
      const row = await engine().data.create(table, data);
      return { content: [{ type: 'text', text: JSON.stringify(row) }] };
    },
  );

  server.registerTool(
    'update_record',
    {
      title: '更新记录',
      description: '按主键更新字段（补丁）。不可编辑表返回 403。',
      inputSchema: updateRecordSchema,
    },
    async ({ table, pk, data }) => {
      checkTableAction(token, table, 'write');
      await engine().data.update(table, pk, data);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    },
  );

  server.registerTool(
    'delete_record',
    {
      title: '删除记录',
      description: '按主键删除一行。不可编辑表返回 403。',
      inputSchema: deleteRecordSchema,
    },
    async ({ table, pk }) => {
      checkTableAction(token, table, 'write');
      await engine().data.delete(table, pk);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    },
  );

  server.registerTool(
    'increment_field',
    {
      title: '自增字段',
      description: '对指定记录的数值字段做原子自增（默认 +1）。不可编辑表返回 403。',
      inputSchema: incrementFieldSchema,
    },
    async ({ table, pk, field, count }) => {
      checkTableAction(token, table, 'write');
      await engine().data.incr(table, pk, field, count ?? 1);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    },
  );
}
