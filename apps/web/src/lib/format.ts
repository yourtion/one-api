import type { FieldMeta } from '@1api/shared';

/** 毫秒时间戳 → YYYY-MM-DD HH:mm；无值返回 — */
export function formatTs(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 布尔（兼容 0/1）→ 是/否 */
export function formatBool(v: boolean | number | null | undefined): string {
  return v === true || v === 1 ? '是' : '否';
}

/** 按字段类型渲染单元格值 */
export function formatCell(value: unknown, field: Pick<FieldMeta, 'jsonType'>): string {
  if (value === null || value === undefined) return '—';
  if (field.jsonType === 'datetime') return formatTs(typeof value === 'number' ? value : Number(value));
  if (field.jsonType === 'boolean') return formatBool(value as boolean | number);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
