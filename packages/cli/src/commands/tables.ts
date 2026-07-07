import type { Command } from 'commander';
import type { JsonType, FieldMetaInput } from '@1api/shared';
import type { Connection } from '../connection.js';
import { renderTable, renderJson } from '../output.js';

/** `one-api-cli tables` 子命令：列出所有表。 */
export function registerTablesCommand(program: Command, getConn: () => Promise<Connection>): void {
  program
    .command('tables')
    .description('列出所有表')
    .option('-f, --format <fmt>', '输出格式：table|json', 'table')
    .action(async (opts) => {
      const conn = await getConn();
      const metas = await conn.listTables();
      if (opts.format === 'json') {
        console.log(
          renderJson(metas.map((m) => ({ name: m.name, label: m.label, primaryKey: m.primaryKey, isPublished: m.isPublished }))),
        );
      } else {
        console.log(
          renderTable(
            metas.map((m) => ({ name: m.name, label: m.label, pk: m.primaryKey, published: m.isPublished ? 'Y' : 'N' })),
            ['name', 'label', 'pk', 'published'],
          ),
        );
      }
    });
}

/** `one-api-cli tables-create` 子命令：新建表（扁平命名避免与 tables 冲突）。 */
export function registerTablesCreateCommand(program: Command, getConn: () => Promise<Connection>): void {
  program
    .command('tables-create <name>')
    .description('新建表（--fields 格式 a:string,b:integer）')
    .option('-f, --fields <list>', '字段定义，逗号分隔 name:type', '')
    .option('-L, --label <label>', '表标签')
    .option('--auto-timestamps', '自动加 created_at/updated_at')
    .option('-F, --format <fmt>', '输出格式', 'table')
    .action(async (name: string, opts) => {
      const conn = await getConn();
      const fields = parseFields(opts.fields);
      if (fields.length === 0) {
        console.error('✗ --fields 不能为空（格式 name:type,...）');
        process.exit(1);
      }
      const createOpts: {
        name: string;
        label: string;
        fields: FieldMetaInput[];
        autoTimestamps?: boolean;
      } = { name, label: opts.label ?? name, fields };
      if (opts.autoTimestamps) createOpts.autoTimestamps = true;
      const meta = await conn.schema.createTable(createOpts);
      if (opts.format === 'json') console.log(renderJson(meta));
      else console.log(`✓ 表 ${meta.name} 已创建（${meta.fields.length} 字段）`);
    });
}

/** `one-api-cli add-field` 子命令：加字段。 */
export function registerAddFieldCommand(program: Command, getConn: () => Promise<Connection>): void {
  program
    .command('add-field <table> <field> <type>')
    .description('向表新增字段（type 为 jsonType：string|integer|number|boolean|datetime）')
    .option('-L, --label <label>', '字段标签')
    .option('-F, --format <fmt>', '输出格式', 'table')
    .action(async (table: string, field: string, type: string, opts) => {
      const conn = await getConn();
      const fieldInput: FieldMetaInput = { name: field, jsonType: type as JsonType };
      if (opts.label) fieldInput.label = opts.label;
      const meta = await conn.schema.addField(table, fieldInput);
      if (opts.format === 'json') console.log(renderJson(meta));
      else console.log(`✓ 字段 ${field} 已加入表 ${table}`);
    });
}

/**
 * 解析 "id:integer,name:string" → FieldMetaInput[]。
 * 约定：名为 `id` 且类型为 integer 的字段自动标记为自增主键
 * （与 engine 默认主键策略一致，避免与自动注入的 id 列冲突）。
 */
function parseFields(list: string): FieldMetaInput[] {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [name, type] = pair.split(':');
      const f: FieldMetaInput = { name: name ?? '', jsonType: (type ?? 'string') as JsonType };
      // id:integer → 自增主键（CLI 约定）
      if (f.name === 'id' && f.jsonType === 'integer') {
        f.isPrimary = true;
        f.isAutoIncrement = true;
        f.nullable = false;
      }
      return f;
    })
    .filter((f) => f.name);
}
