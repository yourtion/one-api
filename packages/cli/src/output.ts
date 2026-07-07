import Table from 'cli-table3';

/** 渲染为表格（cli-table3，默认格式）。 */
export function renderTable(rows: Record<string, unknown>[], fields: string[]): string {
  if (rows.length === 0) {
    return '(无数据)';
  }
  const table = new Table({
    head: fields,
    style: { head: ['cyan'] },
  });
  for (const row of rows) {
    table.push(fields.map((f) => formatCell(row[f])));
  }
  return table.toString();
}

/** 渲染为 JSON 字符串（管道友好，2 空格缩进）。 */
export function renderJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** 渲染为 CSV（RFC4180 风格，表头 + 行）。 */
export function renderCsv(rows: Record<string, unknown>[], fields: string[]): string {
  const lines = [fields.join(',')];
  for (const row of rows) {
    lines.push(fields.map((f) => csvCell(row[f])).join(','));
  }
  return lines.join('\n');
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
