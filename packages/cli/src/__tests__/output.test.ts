import { describe, it, expect } from 'vitest';
import { renderTable, renderJson, renderCsv } from '../output.js';

const rows = [
  { id: 1, name: 'alice', age: 30 },
  { id: 2, name: 'bob', age: 25 },
];
const fields = ['id', 'name', 'age'] as const;

describe('renderJson', () => {
  it('输出 JSON 字符串（无额外日志）', () => {
    const out = renderJson(rows);
    expect(JSON.parse(out)).toEqual(rows);
  });

  it('单行 → JSON 对象（非数组）', () => {
    const out = renderJson(rows[0]!);
    expect(JSON.parse(out)).toEqual(rows[0]);
  });

  it('ListResult → 保留结构', () => {
    const out = renderJson({ rows, total: 2, page: 1, size: 20 });
    expect(JSON.parse(out)).toEqual({ rows, total: 2, page: 1, size: 20 });
  });
});

describe('renderCsv', () => {
  it('输出 CSV（表头 + 行，逗号分隔）', () => {
    const out = renderCsv(rows, [...fields]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('id,name,age');
    expect(lines[1]).toBe('1,alice,30');
    expect(lines[2]).toBe('2,bob,25');
  });

  it('含逗号/引号 → 双引号转义', () => {
    const out = renderCsv([{ v: 'a,b', w: 'c"d' }], ['v', 'w']);
    const lines = out.split('\n');
    expect(lines[0]).toBe('v,w');
    expect(lines[1]).toBe('"a,b","c""d"');
  });

  it('null/undefined → 空字符串', () => {
    const out = renderCsv([{ a: null, b: undefined } as unknown as Record<string, unknown>], ['a', 'b']);
    expect(out.split('\n')[1]).toBe(',');
  });
});

describe('renderTable', () => {
  it('输出含表头 + 数据行的表格字符串', () => {
    const out = renderTable(rows, [...fields]);
    // cli-table3 输出含边框字符；断言关键字段出现
    expect(out).toContain('id');
    expect(out).toContain('name');
    expect(out).toContain('alice');
    expect(out).toContain('bob');
  });

  it('字段名即列顺序', () => {
    const out = renderTable(rows, ['name', 'id']);
    // name 列在 id 列之前（表头行）
    const headerLine = out.split('\n').find((l) => l.includes('name') && l.includes('id'))!;
    expect(headerLine.indexOf('name')).toBeLessThan(headerLine.indexOf('id'));
  });
});
