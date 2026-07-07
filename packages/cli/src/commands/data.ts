import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import type { Connection } from '../connection.js';
import type { FilterOperator, ListOptions } from '@1api/shared';
import { renderTable, renderJson, renderCsv } from '../output.js';
import { readFileSync, writeFileSync } from 'node:fs';

/** 注册数据操作子命令：describe / list / get / create / update / delete / export / import。 */
export function registerDataCommands(program: Command, getConn: () => Promise<Connection>): void {
  // describe
  program
    .command('describe <table>')
    .description('查看表结构')
    .option('-F, --format <fmt>', '输出格式', 'json')
    .action(async (table: string, opts) => {
      const conn = await getConn();
      const meta = await conn.describe(table);
      console.log(
        opts.format === 'json'
          ? renderJson(meta)
          : renderTable([metaToRow(meta)], ['name', 'label', 'pk', 'published']),
      );
    });

  // list
  program
    .command('list <table>')
    .description('查询记录列表')
    .option('-w, --where <expr>', '过滤，格式 field__op=value（如 name__eq=alice）')
    .option('-o, --order <expr>', '排序，如 -id 或 id:desc')
    .option('-l, --limit <n>', '每页条数', '20')
    .option('-p, --page <n>', '页码', '1')
    .option('-q, --query <text>', '全文模糊搜索')
    .option('-F, --format <fmt>', '输出格式：table|json|csv', 'table')
    .action(async (table: string, opts) => {
      const conn = await getConn();
      const listOpts: ListOptions = {
        page: Number(opts.page),
        size: Number(opts.limit),
      };
      if (opts.order) listOpts.order = normalizeOrder(opts.order);
      if (opts.query) listOpts.q = opts.query;
      if (opts.where) listOpts.filters = parseWhere(opts.where);
      const result = await conn.list(table, listOpts);
      if (opts.format === 'json') console.log(renderJson(result));
      else if (opts.format === 'csv') console.log(renderCsv(result.rows, inferCols(result.rows)));
      else console.log(renderTable(result.rows, inferCols(result.rows)));
    });

  // get
  program
    .command('get <table> <pk>')
    .description('查询单条记录')
    .option('-F, --format <fmt>', '输出格式', 'json')
    .action(async (table: string, pk: string, opts) => {
      const conn = await getConn();
      const row = await conn.get(table, pk);
      console.log(opts.format === 'json' ? renderJson(row) : renderTable([row], inferCols([row])));
    });

  // create
  program
    .command('create <table>')
    .description('创建记录（--data JSON 或 --data-file 路径，或 @file 简写）')
    .option('-d, --data <json>', 'JSON 数据')
    .option('--data-file <path>', '从文件读 JSON 数据')
    .option('-F, --format <fmt>', '输出格式（create 恒输出 JSON；保留选项以与其它命令一致）')
    .action(async (table: string, opts) => {
      const conn = await getConn();
      const data = parseDataInput(opts.data, opts.dataFile);
      const row = await conn.create(table, data);
      console.log(renderJson(row));
    });

  // update
  program
    .command('update <table> <pk>')
    .description('更新记录')
    .option('-d, --data <json>', 'JSON 数据')
    .option('--data-file <path>', '从文件读 JSON 数据')
    .action(async (table: string, pk: string, opts) => {
      const conn = await getConn();
      const data = parseDataInput(opts.data, opts.dataFile);
      await conn.update(table, pk, data);
      console.log('✓ 已更新');
    });

  // delete
  program
    .command('delete <table> <pk>')
    .description('删除记录（交互确认，--yes 跳过）')
    .option('-y, --yes', '跳过确认')
    .action(async (table: string, pk: string, opts) => {
      if (!opts.yes) {
        const ok = await confirm({ message: `确定删除 ${table}/${pk}？`, default: false });
        if (!ok) {
          console.log('已取消');
          return;
        }
      }
      const conn = await getConn();
      await conn.delete(table, pk);
      console.log('✓ 已删除');
    });

  // export
  program
    .command('export <table>')
    .description('导出全部数据（分页拉取）')
    .option('-F, --format <fmt>', '输出格式：csv|json', 'csv')
    .option('-o, --output <path>', '写入文件（默认 stdout）')
    .option('-s, --size <n>', '每页拉取条数', '100')
    .action(async (table: string, opts) => {
      const conn = await getConn();
      const all: Record<string, unknown>[] = [];
      let page = 1;
      const size = Number(opts.size);
      while (true) {
        const r = await conn.list(table, { page, size });
        all.push(...r.rows);
        if (all.length >= r.total || r.rows.length === 0) break;
        page += 1;
      }
      const cols = inferCols(all);
      const content = opts.format === 'json' ? renderJson(all) : renderCsv(all, cols);
      if (opts.output) {
        writeFileSync(opts.output, content, 'utf-8');
        console.log(`✓ 已导出 ${all.length} 行到 ${opts.output}`);
      } else {
        console.log(content);
      }
    });

  // import
  program
    .command('import <table> <file>')
    .description('从 CSV/JSON 文件导入数据（逐行 create）')
    .action(async (table: string, file: string) => {
      const conn = await getConn();
      const rows = readDataFile(file);
      let ok = 0;
      for (const row of rows) {
        try {
          await conn.create(table, row);
          ok += 1;
        } catch (e) {
          console.error(`✗ 行导入失败：${(e as Error).message}`);
        }
      }
      console.log(`✓ 导入完成（成功 ${ok}/${rows.length}）`);
    });
}

// —— 辅助函数 ——

export function inferCols(rows: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) set.add(k);
  return [...set];
}

function metaToRow(m: {
  name: string;
  label: string;
  primaryKey: string;
  isPublished: boolean;
}): Record<string, unknown> {
  return { name: m.name, label: m.label, pk: m.primaryKey, published: m.isPublished ? 'Y' : 'N' };
}

/** "--where name__eq=alice,age__gt=18" → { name: ['eq','alice'], age: ['gt',18] } */
export function parseWhere(expr: string): Record<string, [FilterOperator, unknown]> {
  const out: Record<string, [FilterOperator, unknown]> = {};
  for (const pair of expr.split(',')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    const fi = key.indexOf('__');
    if (fi <= 0) continue;
    const field = key.slice(0, fi);
    const op = key.slice(fi + 2) as FilterOperator;
    // 只在非空且严格是纯数字（无前导零）时才转数字：
    // 避免空值 '' → Number('')===0；避免 '01234' → Number('01234')===1234 丢前导零。
    // 接受 '0' 或 '123'，拒绝 ''、'01234'、'9.99'、'-5'。
    const numVal = /^(0|[1-9]\d*)$/.test(val) ? Number(val) : val;
    out[field] = [op, numVal];
  }
  return out;
}

/** "-id" → "id:desc"，"id" → "id:asc"，"id:desc" 原样 */
export function normalizeOrder(o: string): string {
  if (o.startsWith('-')) return `${o.slice(1)}:desc`;
  if (o.startsWith('+')) return `${o.slice(1)}:asc`;
  if (!o.includes(':')) return `${o}:asc`;
  return o;
}

/** 解析 --data JSON / --data-file / @file 简写 */
function parseDataInput(
  data: string | undefined,
  dataFile: string | undefined,
): Record<string, unknown> {
  if (dataFile) return JSON.parse(readFileSync(dataFile, 'utf-8'));
  if (data) {
    if (data.startsWith('@')) return JSON.parse(readFileSync(data.slice(1), 'utf-8'));
    return JSON.parse(data);
  }
  console.error('✗ 需要 --data <json> 或 --data-file <path>');
  process.exit(1);
}

/** 读 CSV 或 JSON 文件 → 行数组（CSV 用首行表头） */
function readDataFile(file: string): Record<string, unknown>[] {
  const content = readFileSync(file, 'utf-8').trim();
  if (file.endsWith('.json') || content.startsWith('[') || content.startsWith('{')) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  // CSV 解析（简易，不处理多行单元格）
  const lines = content.split('\n');
  const header = lines[0]!.split(',').map((s) => s.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, unknown> = {};
    header.forEach((h, i) => {
      row[h] = cells[i]?.trim() ?? '';
    });
    return row;
  });
}
