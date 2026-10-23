import { type Kysely, sql } from 'kysely';
import {
  DEFAULT_PAGE,
  DEFAULT_SIZE,
  Errors,
  MAX_SIZE,
  type FieldMeta,
  type ListOptions,
  type ListResult,
  type TableMeta,
} from '@1api/shared';

type Row = Record<string, unknown>;
type SqlFragment = ReturnType<typeof sql>;

const TIMESTAMP_CREATED = 'created_at';
const TIMESTAMP_UPDATED = 'updated_at';

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

/** 对行中的 datetime 字段做归一 */
function transformRow(meta: TableMeta, row: Row): Row {
  for (const f of meta.fields) {
    if (f.jsonType === 'datetime' && row[f.name] !== undefined) {
      row[f.name] = normalizeDatetime(row[f.name]);
    }
  }
  return row;
}

/** 双引号包裹标识符（支持非 snake_case） */
function col(name: string) {
  return sql.id(name);
}

/** 是否含自动时间戳字段 */
function hasTimestamps(meta: TableMeta): boolean {
  return meta.fields.some((f) => f.name === TIMESTAMP_CREATED || f.name === TIMESTAMP_UPDATED);
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
    // 只接受 meta 白名单内、且非只读时间戳（由本层填）的字段
    const cols = Object.keys(data).filter(
      (k) =>
        meta.fields.some((f) => f.name === k) &&
        k !== TIMESTAMP_CREATED &&
        k !== TIMESTAMP_UPDATED,
    );
    if (cols.length === 0) throw Errors.validationFail('无可写入字段');

    // 时间戳约定：建表含 created_at/updated_at 时由 engine 填 Date.now()
    if (hasTimestamps(meta)) {
      const now = Date.now();
      if (
        meta.fields.some((f) => f.name === TIMESTAMP_CREATED) &&
        data[TIMESTAMP_CREATED] === undefined
      ) {
        cols.push(TIMESTAMP_CREATED);
        data[TIMESTAMP_CREATED] = now;
      }
      if (
        meta.fields.some((f) => f.name === TIMESTAMP_UPDATED) &&
        data[TIMESTAMP_UPDATED] === undefined
      ) {
        cols.push(TIMESTAMP_UPDATED);
        data[TIMESTAMP_UPDATED] = now;
      }
    }

    const colNodes = sql.join(
      cols.map((c) => col(c)),
      sql.raw(', '),
    );
    const valNodes = sql.join(
      cols.map((c) => sql`${data[c]}`),
      sql.raw(', '),
    );
    const res = await sql<Row>`INSERT INTO ${sql.id(meta.name)} (${colNodes}) VALUES (${valNodes}) RETURNING ${col(
      meta.primaryKey,
    )}`.execute(this.businessDb);
    const inserted = res.rows[0];
    if (inserted && inserted[meta.primaryKey] !== undefined) return inserted[meta.primaryKey];
    // 兜底：last_insert_rowid()
    const r = await sql<{ id: number }>`SELECT last_insert_rowid() AS id`.execute(this.businessDb);
    return r.rows[0]?.id;
  }

  async updateRow(meta: TableMeta, pk: unknown, patch: Record<string, unknown>): Promise<void> {
    // 只读字段忽略（如 created_at/updated_at 由本层管理）；updated_at 由本层刷新
    const sets = Object.keys(patch).filter((k) => {
      const f = meta.fields.find((x) => x.name === k);
      return f && !f.isReadonly;
    });
    if (sets.length === 0 && !meta.fields.some((f) => f.name === TIMESTAMP_UPDATED)) return;

    const setNodes: SqlFragment[] = sets.map((c) => sql`${col(c)} = ${patch[c]}`);
    // 刷新 updated_at（SQLite 无 ON UPDATE，由 engine 负责）
    if (meta.fields.some((f) => f.name === TIMESTAMP_UPDATED)) {
      setNodes.push(sql`${col(TIMESTAMP_UPDATED)} = ${Date.now()}`);
    }
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
    if (f.jsonType !== 'integer' && f.jsonType !== 'number') {
      throw Errors.validationFail(`字段 ${field} 非数值类型，不可自增`);
    }
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
