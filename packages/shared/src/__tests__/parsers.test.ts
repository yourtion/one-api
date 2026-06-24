import { describe, expect, it } from 'vitest';
import { coerceBool, coerceInt, coerceNum } from '../index.js';

describe('coerceBool 严格性', () => {
  it('"false" → false（核心：避免 z.coerce.boolean 的 truthiness 坑）', () => {
    expect(coerceBool.parse('false')).toBe(false);
  });
  it('"true" → true', () => {
    expect(coerceBool.parse('true')).toBe(true);
  });
  it('"1"/1 → true，"0"/0 → false', () => {
    expect(coerceBool.parse('1')).toBe(true);
    expect(coerceBool.parse(1)).toBe(true);
    expect(coerceBool.parse('0')).toBe(false);
    expect(coerceBool.parse(0)).toBe(false);
  });
  it('boolean 原值直通', () => {
    expect(coerceBool.parse(true)).toBe(true);
    expect(coerceBool.parse(false)).toBe(false);
  });
  it('非法值报错（"yes"/"no"/空串/任意字符串）', () => {
    expect(() => coerceBool.parse('yes')).toThrow();
    expect(() => coerceBool.parse('no')).toThrow();
    expect(() => coerceBool.parse('')).toThrow();
    expect(() => coerceBool.parse('maybe')).toThrow();
  });
});

describe('coerceInt', () => {
  it('字符串数字转 int', () => {
    expect(coerceInt.parse('42')).toBe(42);
  });
  it('非整数报错', () => {
    expect(() => coerceInt.parse('3.14')).toThrow();
    expect(() => coerceInt.parse('abc')).toThrow();
  });
});

describe('coerceNum', () => {
  it('字符串数字转 number', () => {
    expect(coerceNum.parse('3.14')).toBe(3.14);
    expect(coerceNum.parse('42')).toBe(42);
  });
  it('非数字报错', () => {
    expect(() => coerceNum.parse('abc')).toThrow();
  });
});
