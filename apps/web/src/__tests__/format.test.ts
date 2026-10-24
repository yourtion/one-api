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
  it('Unix epoch 0 是有效时间', () => {
    expect(formatTs(0)).toMatch(/^19(?:69-12-31|70-01-01) \d{2}:\d{2}$/);
  });
  it('undefined → —', () => {
    expect(formatTs(undefined)).toBe('—');
  });
});

describe('formatBool', () => {
  it('true/1 → 是', () => {
    expect(formatBool(true)).toBe('是');
    expect(formatBool(1)).toBe('是');
  });
  it('false/0 → 否', () => {
    expect(formatBool(false)).toBe('否');
    expect(formatBool(0)).toBe('否');
  });
});

describe('formatCell', () => {
  const datetimeField: CellField = { jsonType: 'datetime', name: 'event_time' };

  it('engine 返回的 ISO datetime 按本地年月日时分显示', () => {
    const iso = new Date(2026, 9, 24, 13, 14).toISOString();
    expect(formatCell(iso, datetimeField)).toBe('2026-10-24 13:14');
  });
  it('带时区偏移的 datetime 按实际时间显示', () => {
    expect(formatCell('2026-10-24T13:14:00+08:00', datetimeField)).toBe(
      formatTs(Date.UTC(2026, 9, 24, 5, 14)),
    );
  });
  it('datetime 的 epoch 0 有效，null/undefined 为无值', () => {
    expect(formatCell(0, datetimeField)).toMatch(/^19(?:69-12-31|70-01-01) \d{2}:\d{2}$/);
    expect(formatCell(null, datetimeField)).toBe('—');
    expect(formatCell(undefined, datetimeField)).toBe('—');
  });
  it('无法解析的历史 datetime 保留原文本', () => {
    expect(formatCell('legacy date: unknown', datetimeField)).toBe('legacy date: unknown');
  });
  it('系统 integer 时间戳仍以毫秒解析（包括数字字符串）', () => {
    const ts = new Date(2026, 9, 24, 13, 14).getTime();
    expect(formatCell(ts, { jsonType: 'integer', name: 'created_at' })).toBe('2026-10-24 13:14');
    expect(formatCell(String(ts), { jsonType: 'integer', name: 'updated_at' })).toBe(
      '2026-10-24 13:14',
    );
  });
  it('datetime 字段 → 格式化时间', () => {
    expect(formatCell(1717200000000, { jsonType: 'datetime', name: 'when' } as CellField)).toMatch(
      /^\d{4}-\d{2}-\d{2}/,
    );
  });
  it('integer + _at 后缀 → 格式化时间（系统时间戳约定）', () => {
    expect(formatCell(1717200000000, { jsonType: 'integer', name: 'created_at' })).toMatch(
      /^\d{4}-\d{2}-\d{2}/,
    );
    expect(formatCell(1717200000000, { jsonType: 'integer', name: 'updated_at' })).toMatch(
      /^\d{4}-\d{2}-\d{2}/,
    );
    expect(formatCell(1717200000000, { jsonType: 'integer', name: 'login_at' })).toMatch(
      /^\d{4}-\d{2}-\d{2}/,
    );
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
    expect(formatCell({ a: 1 }, { jsonType: 'string', name: 'title' } as CellField)).toBe(
      '{"a":1}',
    );
  });
});
