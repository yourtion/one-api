import { z } from 'zod';

/**
 * MCP tool inputSchema 集中定义。
 * MCP SDK 的 McpServer.registerTool 接受 zod 对象，自动转 JSON Schema 暴露给 agent。
 * 用 zod（非 erest 再导出的 z），避免符号链接穿透触发 TS2742（见 AGENTS.md Phase 2 踩坑）。
 */

// —— 数据 CRUD tools ——

export const describeTableSchema = z.object({
  table: z.string().describe('表名'),
});

export const listRecordsSchema = z.object({
  table: z.string().describe('表名'),
  page: z.number().int().positive().optional().describe('页码，默认 1'),
  size: z.number().int().positive().max(100).optional().describe('每页条数，默认 20，最大 100'),
  order: z.string().optional().describe('排序，格式 "field:desc,field2:asc"'),
  q: z.string().optional().describe('全文模糊搜索（对所有文本字段 LIKE）'),
  filters: z
    .record(z.string(), z.tuple([z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'in']), z.unknown()]))
    .optional()
    .describe('字段过滤，键为字段名，值为 [操作符, 值]；in 操作符的值用逗号分隔字符串'),
});

export const getRecordSchema = z.object({
  table: z.string().describe('表名'),
  pk: z.union([z.string(), z.number()]).describe('主键值'),
});

export const createRecordSchema = z.object({
  table: z.string().describe('表名'),
  data: z.record(z.string(), z.unknown()).describe('要创建的行数据（字段名→值）'),
});

export const updateRecordSchema = z.object({
  table: z.string().describe('表名'),
  pk: z.union([z.string(), z.number()]).describe('主键值'),
  data: z.record(z.string(), z.unknown()).describe('要更新的字段（补丁）'),
});

export const deleteRecordSchema = z.object({
  table: z.string().describe('表名'),
  pk: z.union([z.string(), z.number()]).describe('主键值'),
});

export const incrementFieldSchema = z.object({
  table: z.string().describe('表名'),
  pk: z.union([z.string(), z.number()]).describe('主键值'),
  field: z.string().describe('要自增的字段名（须为 integer/number 类型）'),
  count: z.number().optional().describe('增量，默认 1'),
});

// —— Schema 演进 tools ——

const fieldMetaInputSchema = z.object({
  name: z.string().describe('字段名，须匹配 ^[a-z][a-z0-9_]*$ 且非保留字'),
  jsonType: z.enum(['string', 'integer', 'number', 'boolean', 'datetime']).describe('JSON 类型'),
  label: z.string().optional().describe('字段标签（显示用），默认同 name'),
  nullable: z.boolean().optional().describe('是否允许 NULL，默认 true'),
  defaultValue: z.unknown().optional().describe('默认值'),
  isPrimary: z.boolean().optional().describe('是否主键，默认 false'),
  isAutoIncrement: z.boolean().optional().describe('是否自增（仅 integer 主键），默认 false'),
  isHidden: z.boolean().optional().describe('是否在列表隐藏，默认 false'),
  isReadonly: z.boolean().optional().describe('是否只读，默认 false'),
  enumValues: z.array(z.string()).optional().describe('枚举可选值（仅 string 类型有意义）'),
});

export const createTableSchema = z.object({
  name: z.string().describe('表名，须匹配 ^[a-z][a-z0-9_]*$ 且非保留字（schema/records/incr）'),
  label: z.string().describe('表标签（显示用）'),
  fields: z.array(fieldMetaInputSchema).min(1).describe('字段定义列表，至少 1 个'),
  note: z.string().nullable().optional().describe('备注'),
  autoTimestamps: z.boolean().optional().describe('是否自动加 created_at/updated_at 字段'),
});

export const addFieldSchema = z.object({
  table: z.string().describe('目标表名'),
  field: fieldMetaInputSchema.describe('要新增的字段定义'),
});
