import { describe, expect, it } from 'vitest';
import { formatTs, formatBool, formatCell } from '../lib/format.js';
import type { FieldMeta } from '@1api/shared';

type CellField = Pick<FieldMeta, 'jsonType' | 'name'>;

describe('formatTs', () => {
  it('毫秒时间戳 → YYYY-MM-DD HH:mm', () => {
    expect(formatTs(1717200000000)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  it('null → —', () => {
    expect(formatTs(null)).toBe('—');
  });
  it('0 → —（视为无值）', () => {
    expect(formatTs(0)).toBe('—');
  });
});

describe('formatBool', () => {
  it('true/1 → 是', () => { expect(formatBool(true)).toBe('是'); expect(formatBool(1)).toBe('是'); });
  it('false/0 → 否', () => { expect(formatBool(false)).toBe('否'); expect(formatBool(0)).toBe('否'); });
});

describe('formatCell', () => {
  it('datetime 字段 → 格式化时间', () => {
    expect(formatCell(1717200000000, { jsonType: 'datetime', name: 'when' } as CellField)).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
  it('integer + _at 后缀 → 格式化时间（系统时间戳约定）', () => {
    expect(formatCell(1717200000000, { jsonType: 'integer', name: 'created_at' })).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(formatCell(1717200000000, { jsonType: 'integer', name: 'updated_at' })).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(formatCell(1717200000000, { jsonType: 'integer', name: 'login_at' })).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
  it('integer 非 _at → 原值字符串', () => {
    expect(formatCell(42, { jsonType: 'integer', name: 'count' })).toBe('42');
  });
  it('boolean 字段 → 是/否', () => {
    expect(formatCell(true, { jsonType: 'boolean', name: 'active' } as CellField)).toBe('是');
  });
  it('null → —', () => {
    expect(formatCell(null, { jsonType: 'string', name: 'title' } as CellField)).toBe('—');
  });
  it('对象/数组 → JSON', () => {
    expect(formatCell({ a: 1 }, { jsonType: 'string', name: 'title' } as CellField)).toBe('{"a":1}');
  });
});
