import { DEFAULT_PAGE, DEFAULT_SIZE, MAX_SIZE, type FilterOperator, type ListOptions } from '@1api/shared';

const VALID_OPS: ReadonlySet<string> = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'like', 'in']);

/** URL query → ListOptions（page/size/order/q/`field__op=value`） */
export function parseListQuery(query: Record<string, unknown>): ListOptions {
  const page = toInt(query['page'], DEFAULT_PAGE);
  const size = Math.min(toInt(query['size'], DEFAULT_SIZE), MAX_SIZE);

  const out: ListOptions = {
    page: Math.max(page, 1),
    size: Math.max(size, 1),
  };
  // exactOptionalPropertyTypes：仅当提供时挂载 order/q
  const order = typeof query['order'] === 'string' ? query['order'] : undefined;
  if (order !== undefined) out.order = order;
  const q = typeof query['q'] === 'string' ? query['q'] : undefined;
  if (q !== undefined) out.q = q;

  const filters: Record<string, [FilterOperator, unknown]> = {};
  for (const [key, raw] of Object.entries(query)) {
    const idx = key.indexOf('__');
    if (idx <= 0) continue;
    const field = key.slice(0, idx);
    const op = key.slice(idx + 2);
    if (!VALID_OPS.has(op)) continue;
    filters[field] = [op as FilterOperator, raw];
  }
  // 始终挂 filters（含空对象，简化消费侧）
  out.filters = filters;
  return out;
}

function toInt(v: unknown, def: number): number {
  if (typeof v !== 'string' && typeof v !== 'number') return def;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
}
