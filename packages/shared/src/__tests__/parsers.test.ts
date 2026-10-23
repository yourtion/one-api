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

describe('转换失败统一为 Zod 校验失败', () => {
  it.each(['yes', 'no', '', 'maybe', 2, null, [], {}])('布尔值 %j 不抛普通 Error', (value) => {
    expect(coerceBool.safeParse(value).success).toBe(false);
  });

  for (const [name, parser] of [
    ['integer', coerceInt],
    ['number', coerceNum],
  ] as const) {
    it.each([null, undefined, '', '   ', true, false, [], [1], {}, NaN, Infinity, -Infinity, 'Infinity'])(
      `${name} 拒绝非数值输入 %j`,
      (value) => {
        expect(parser.safeParse(value).success).toBe(false);
      },
    );
    it(`${name} 接受有限数字和非空数字字符串`, () => {
      expect(parser.parse(42)).toBe(42);
      expect(parser.parse('42')).toBe(42);
      expect(parser.parse(' -12 ')).toBe(-12);
      expect(parser.parse('0')).toBe(0);
    });
  }
});
