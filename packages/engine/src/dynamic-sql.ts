import { type Kysely, sql } from 'kysely';
import {
  DEFAULT_PAGE,
  DEFAULT_SIZE,
  coerceBool,
  Errors,
  MAX_SIZE,
  type FieldMeta,
  type ListOptions,
  type ListResult,
  type TableMeta,
} from '@1api/shared';
import { validateIncrement, validateWriteData } from './data-validation.js';

type Row = Record<string, unknown>;
type SqlFragment = ReturnType<typeof sql>;

/** 校验字段在 meta 白名单中 */
export function assertFieldExists(meta: TableMeta, name: string): FieldMeta {
  const f = meta.fields.find((x) => x.name === name);
  if (!f) throw Errors.validationFail(`字段不存在: ${name}`);
  return f;
}

/** 解析 order 字符串 → [{field, dir}]，全部字段经白名单 */
interface OrderClause {
  field: string;
  dir: 'ASC' | 'DESC';
}
function parseOrder(meta: TableMeta, order?: string): OrderClause[] {
  if (!order) return [];
  const out: OrderClause[] = [];
  for (const part of order.split(',')) {
    const seg = part.trim();
    if (!seg) continue;
    const [field, dirRaw] = seg.split(':');
    if (!field) continue;
    assertFieldExists(meta, field); // 白名单
    const dir = (dirRaw ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    out.push({ field, dir });
  }
  return out;
}

/** datetime 值归一为 ISO8601；失败原样返回（业务库多格式适配） */
export function normalizeDatetime(value: unknown): unknown {
  if (typeof value !== 'string' || value === '') return value;
  // 3. 纯数字（Unix 秒/毫秒启发式：>1e12 视为毫秒）
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  // 2. SQLite 原生 'YYYY-MM-DD HH:MM:SS' → 按 UTC 拼接 Z
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(value)) {
    const iso = value.replace(' ', 'T');
    const withTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
    const d = new Date(withTz);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  // 1. ISO8601（含 T/Z）或 Date 可解析
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/** 对行中的逻辑类型做归一；保留 null 及不能解析的已有业务数据。 */
function transformRow(meta: TableMeta, row: Row): Row {
  for (const f of meta.fields) {
    if (f.jsonType === 'datetime' && row[f.name] !== undefined) {
      row[f.name] = normalizeDatetime(row[f.name]);
    }
    if (f.jsonType === 'boolean' && row[f.name] !== null && row[f.name] !== undefined) {
      const parsed = coerceBool.safeParse(row[f.name]);
      if (parsed.success) row[f.name] = parsed.data;
    }
  }
  return row;
}

/** 双引号包裹标识符（支持非 snake_case） */
function col(name: string) {
  return sql.id(name);
}

export class DynamicSql {
  constructor(private readonly businessDb: Kysely<Record<string, never>>) {}

  /** SELECT 列表 + WHERE + ORDER + LIMIT/OFFSET + COUNT */
  async selectList(meta: TableMeta, opts: ListOptions): Promise<ListResult<Row>> {
    const page = Math.max(opts.page ?? DEFAULT_PAGE, 1);
    const size = Math.min(Math.max(opts.size ?? DEFAULT_SIZE, 1), MAX_SIZE);
    const offset = (page - 1) * size;
    const table = sql.id(meta.name);

    const whereParts: SqlFragment[] = [];

    // filters
    if (opts.filters) {
      for (const [name, [op, value]] of Object.entries(opts.filters)) {
        const field = assertFieldExists(meta, name);
        whereParts.push(this.buildFilterClause(field, op, value));
      }
    }
    // q：所有 TEXT/非主键字段 OR LIKE
    if (opts.q) {
      const qFields = meta.fields.filter((f) => f.sqliteType === 'TEXT' && !f.isPrimary);
      if (qFields.length > 0) {
        const likes = qFields.map((f) => sql`${col(f.name)} LIKE ${'%' + opts.q + '%'}`);
        whereParts.push(sql`(${sql.join(likes, sql.raw(' OR '))})`);
      }
    }

    const whereClause: SqlFragment =
      whereParts.length > 0 ? sql` WHERE ${sql.join(whereParts, sql.raw(' AND '))}` : sql``;

    // COUNT
    const countSql = sql<{ total: number }>`SELECT COUNT(*) AS total FROM ${table}${whereClause}`;
    const countRes = await countSql.execute(this.businessDb);
    const total = Number(countRes.rows[0]?.total ?? 0);

    // DATA
    const orderClauses = parseOrder(meta, opts.order);
    const orderBy: SqlFragment =
      orderClauses.length > 0
        ? sql` ORDER BY ${sql.join(
            orderClauses.map((o) => sql`${col(o.field)} ${sql.raw(o.dir)}`),
            sql.raw(', '),
          )}`
        : sql``;

    const dataSql = sql<Row>`SELECT * FROM ${table}${whereClause}${orderBy} LIMIT ${size} OFFSET ${offset}`;
    const dataRes = await dataSql.execute(this.businessDb);
    const rows = dataRes.rows.map((r) => transformRow(meta, { ...r }));

    return { rows, total, page, size };
  }

  async selectOne(meta: TableMeta, pk: unknown): Promise<Row | undefined> {
    const res = await sql<Row>`SELECT * FROM ${sql.id(meta.name)} WHERE ${col(meta.primaryKey)} = ${pk}`
      .execute(this.businessDb);
    const row = res.rows[0];
    return row ? transformRow(meta, { ...row }) : undefined;
  }

  async insertRow(meta: TableMeta, data: Record<string, unknown>): Promise<unknown> {
    const values = validateWriteData(meta, data, 'create');
    const cols = Object.keys(values);

    const colNodes = sql.join(
      cols.map((c) => col(c)),
      sql.raw(', '),
    );
    const valNodes = sql.join(
      cols.map((c) => sql`${values[c]}`),
      sql.raw(', '),
    );
    const insert =
      cols.length === 0
        ? sql`INSERT INTO ${sql.id(meta.name)} DEFAULT VALUES`
        : sql`INSERT INTO ${sql.id(meta.name)} (${colNodes}) VALUES (${valNodes})`;
    const res = await sql<Row>`${insert} RETURNING ${col(meta.primaryKey)}`.execute(this.businessDb);
    const inserted = res.rows[0];
    if (inserted && inserted[meta.primaryKey] !== undefined) return inserted[meta.primaryKey];
    // 兜底：last_insert_rowid()
    const r = await sql<{ id: number }>`SELECT last_insert_rowid() AS id`.execute(this.businessDb);
    return r.rows[0]?.id;
  }

  async updateRow(meta: TableMeta, pk: unknown, patch: Record<string, unknown>): Promise<void> {
    const values = validateWriteData(meta, patch, 'update');
    const setNodes = Object.entries(values).map(([name, value]) => sql`${col(name)} = ${value}`);
    if (setNodes.length === 0) return;
    const setNode = sql.join(setNodes, sql.raw(', '));
    await sql`UPDATE ${sql.id(meta.name)} SET ${setNode} WHERE ${col(meta.primaryKey)} = ${pk}`.execute(
      this.businessDb,
    );
  }

  async deleteRow(meta: TableMeta, pk: unknown): Promise<void> {
    await sql`DELETE FROM ${sql.id(meta.name)} WHERE ${col(meta.primaryKey)} = ${pk}`.execute(
      this.businessDb,
    );
  }

  async incrementField(meta: TableMeta, pk: unknown, field: string, n: number): Promise<void> {
    const f = assertFieldExists(meta, field);
    validateIncrement(f, n);
    await sql`UPDATE ${sql.id(meta.name)} SET ${col(field)} = ${col(field)} + ${n} WHERE ${col(
      meta.primaryKey,
    )} = ${pk}`.execute(this.businessDb);
  }

  // —— 内部：过滤子句 ——

  private buildFilterClause(field: FieldMeta, op: string, value: unknown): SqlFragment {
    const name = col(field.name);
    switch (op) {
      case 'eq':
        return sql`${name} = ${value}`;
      case 'ne':
        return sql`${name} <> ${value}`;
      case 'gt':
        return sql`${name} > ${value}`;
      case 'gte':
        return sql`${name} >= ${value}`;
      case 'lt':
        return sql`${name} < ${value}`;
      case 'lte':
        return sql`${name} <= ${value}`;
      case 'like':
        return sql`${name} LIKE ${value}`;
      case 'in': {
        const arr = String(value)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (arr.length === 0) throw Errors.validationFail('in 操作符值非法');
        const nodes = sql.join(
          arr.map((a) => sql`${a}`),
          sql.raw(', '),
        );
        return sql`${name} IN (${nodes})`;
      }
      default:
        throw Errors.validationFail(`不支持的过滤操作符: ${op}`);
    }
  }
}
