import type { FieldMeta } from '@1api/shared';

/** 毫秒时间戳 → YYYY-MM-DD HH:mm；无值返回 — */
export function formatTs(ts: number | null | undefined): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 布尔（兼容 0/1）→ 是/否 */
export function formatBool(v: boolean | number | null | undefined): string {
  return v === true || v === 1 ? '是' : '否';
}

/**
 * 判断字段是否为（毫秒）时间戳：
 * - jsonType === 'integer' 且字段名以 _at 结尾 / 名为 created_at|updated_at（系统时间戳约定）
 */
function isTimestampField(field: { jsonType: string; name?: string }): boolean {
  if (field.jsonType === 'integer' && field.name) {
    return field.name === 'created_at' || field.name === 'updated_at' || field.name.endsWith('_at');
  }
  return false;
}

/** 按字段类型渲染单元格值 */
export function formatCell(value: unknown, field: Pick<FieldMeta, 'jsonType' | 'name'>): string {
  if (value === null || value === undefined) return '—';
  if (field.jsonType === 'datetime') {
    const ts = typeof value === 'number' ? value : Date.parse(String(value));
    return Number.isFinite(ts) ? formatTs(ts) : String(value);
  }
  if (isTimestampField(field)) return formatTs(typeof value === 'number' ? value : Number(value));
  if (field.jsonType === 'boolean') return formatBool(value as boolean | number);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
