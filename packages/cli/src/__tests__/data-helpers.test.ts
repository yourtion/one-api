import { describe, it, expect } from 'vitest';
import { parseWhere, normalizeOrder, inferCols } from '../commands/data.js';

describe('parseWhere', () => {
  it('纯数字 → 转数字', () => {
    expect(parseWhere('age__gt=18')).toEqual({ age: ['gt', 18] });
  });

  it('非数字 → 保留字符串', () => {
    expect(parseWhere('name__eq=alice')).toEqual({ name: ['eq', 'alice'] });
  });

  it('多条件（逗号分隔）', () => {
    expect(parseWhere('name__eq=alice,age__gt=18')).toEqual({
      name: ['eq', 'alice'],
      age: ['gt', 18],
    });
  });

  it('空值 → 不转成 0（保留空串）', () => {
    // 回归：旧实现 Number('')===0 会错误变成数字 0
    expect(parseWhere('name__eq=')).toEqual({ name: ['eq', ''] });
  });

  it('前导零 → 保留字符串（不丢失前导零）', () => {
    // 回归：旧实现 Number('01234')===1234 会丢前导零
    expect(parseWhere('zip__eq=01234')).toEqual({ zip: ['eq', '01234'] });
  });

  it('负数 → 保留字符串（不是纯 \\d+）', () => {
    expect(parseWhere('temp__lt=-5')).toEqual({ temp: ['lt', '-5'] });
  });

  it('小数 → 保留字符串（不是纯 \\d+）', () => {
    expect(parseWhere('price__gt=9.99')).toEqual({ price: ['gt', '9.99'] });
  });

  it('无 __ 分隔符 → 跳过', () => {
    expect(parseWhere('name=alice')).toEqual({});
  });

  it('无 = 分隔符 → 跳过', () => {
    expect(parseWhere('name__eq')).toEqual({});
  });
});

describe('normalizeOrder', () => {
  it('-id → id:desc', () => {
    expect(normalizeOrder('-id')).toBe('id:desc');
  });

  it('+id → id:asc', () => {
    expect(normalizeOrder('+id')).toBe('id:asc');
  });

  it('id → id:asc（无方向补 :asc）', () => {
    expect(normalizeOrder('id')).toBe('id:asc');
  });

  it('id:desc → 原样', () => {
    expect(normalizeOrder('id:desc')).toBe('id:desc');
  });

  it('id:asc → 原样', () => {
    expect(normalizeOrder('id:asc')).toBe('id:asc');
  });
});

describe('inferCols', () => {
  it('合并多行键（保持插入序）', () => {
    expect(inferCols([{ a: 1 }, { b: 2 }, { a: 3, c: 4 }])).toEqual(['a', 'b', 'c']);
  });

  it('空数组 → []', () => {
    expect(inferCols([])).toEqual([]);
  });
});
