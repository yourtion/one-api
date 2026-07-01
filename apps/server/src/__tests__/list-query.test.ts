import { describe, expect, it } from 'vitest';
import { parseListQuery } from '../utils/list-query.js';

describe('parseListQuery', () => {
  it('基础分页 + order + q', () => {
    expect(parseListQuery({ page: '2', size: '5', order: 'id:desc', q: 'abc' })).toEqual({
      page: 2,
      size: 5,
      order: 'id:desc',
      q: 'abc',
      filters: {},
    });
  });

  it('field__op=value 过滤 → filters', () => {
    expect(parseListQuery({ name__eq: 'tom', age__gt: '18', tags__in: 'a,b,c' })).toEqual({
      page: 1,
      size: 20,
      filters: { name: ['eq', 'tom'], age: ['gt', '18'], tags: ['in', 'a,b,c'] },
    });
  });

  it('未知 op 忽略（不进 filters）', () => {
    expect(parseListQuery({ name__bogus: 'x' }).filters).toEqual({});
  });

  it('size 超上限截断为 100', () => {
    expect(parseListQuery({ size: '999' }).size).toBe(100);
  });

  it('page/size 非法回退默认', () => {
    expect(parseListQuery({ page: 'abc', size: '-1' })).toEqual({ page: 1, size: 20, filters: {} });
  });

  it('无任何参数 → 全默认 + 空 filters', () => {
    expect(parseListQuery({})).toEqual({ page: 1, size: 20, filters: {} });
  });
});
