import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE,
  DEFAULT_SIZE,
  MAX_SIZE,
  NAME_REGEX,
  RESERVED_NAMES,
  isValidName,
  isReservedName,
  ErrorCode,
  API_PATHS,
  ROLE,
  ACTION,
} from '../index.js';

describe('constants', () => {
  describe('分页常量', () => {
    it('默认值与上限', () => {
      expect(DEFAULT_PAGE).toBe(1);
      expect(DEFAULT_SIZE).toBe(20);
      expect(MAX_SIZE).toBe(100);
    });
  });

  describe('名称正则', () => {
    it('合法名', () => {
      expect(NAME_REGEX.test('users')).toBe(true);
      expect(NAME_REGEX.test('user_posts')).toBe(true);
      expect(NAME_REGEX.test('a')).toBe(true);
      expect(NAME_REGEX.test('t1')).toBe(true);
    });
    it('非法名', () => {
      expect(NAME_REGEX.test('Users')).toBe(false); // 大写
      expect(NAME_REGEX.test('1users')).toBe(false); // 数字开头
      expect(NAME_REGEX.test('user-posts')).toBe(false); // 连字符
      expect(NAME_REGEX.test('user posts')).toBe(false); // 空格
      expect(NAME_REGEX.test('')).toBe(false);
    });
  });

  describe('保留字', () => {
    it('含 schema/records/incr', () => {
      expect(RESERVED_NAMES.has('schema')).toBe(true);
      expect(RESERVED_NAMES.has('records')).toBe(true);
      expect(RESERVED_NAMES.has('incr')).toBe(true);
    });
    it('isReservedName', () => {
      expect(isReservedName('schema')).toBe(true);
      expect(isReservedName('users')).toBe(false);
    });
    it('isValidName 综合校验', () => {
      expect(isValidName('users')).toBe(true);
      expect(isValidName('Schema')).toBe(false); // 大写非法
      expect(isValidName('schema')).toBe(false); // 保留字
      expect(isValidName('records')).toBe(false);
    });
  });

  describe('错误码前缀分类', () => {
    it('TABLE_* / VALIDATION_* / DB_* 存在', () => {
      expect(ErrorCode.TABLE_NOT_FOUND).toBe('TABLE_NOT_FOUND');
      expect(ErrorCode.TABLE_NOT_EDITABLE).toBe('TABLE_NOT_EDITABLE');
      expect(ErrorCode.VALIDATION_FAIL).toBe('VALIDATION_FAIL');
      expect(ErrorCode.DB_ERROR).toBe('DB_ERROR');
    });
  });

  describe('API 路径前缀', () => {
    it('四类前缀', () => {
      expect(API_PATHS.auth).toBe('/api/auth');
      expect(API_PATHS.admin).toBe('/api/admin');
      expect(API_PATHS.data).toBe('/api/data');
      expect(API_PATHS.mcp).toBe('/mcp');
    });
  });

  describe('角色 / 动作枚举', () => {
    it('ROLE', () => {
      expect(ROLE.ADMIN).toBe('admin');
    });
    it('ACTION', () => {
      expect(ACTION.READ).toBe('read');
      expect(ACTION.WRITE).toBe('write');
      expect(ACTION.SCHEMA).toBe('schema');
    });
  });
});
