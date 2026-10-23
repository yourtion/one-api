import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Errors } from '@1api/shared';
import { createTestDbs, type TestDbs } from '../test-helpers.js';
import { listTables, readTableSchema } from '../schema-reader.js';

describe('schema-reader', () => {
  let dbs: TestDbs;
  beforeEach(async () => {
    dbs = await createTestDbs();
  });
  afterEach(async () => {
    await dbs.cleanup();
  });

  function exec(sql: string) {
    dbs.businessRaw.exec(sql);
  }

  describe('listTables', () => {
    it('列出用户表（排除 sqlite_ 内部表）', () => {
      exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
      exec('CREATE TABLE posts (id INTEGER PRIMARY KEY)');
      const tables = listTables(dbs.businessRaw);
      expect(tables.sort()).toEqual(['posts', 'users']);
    });
  });

  describe('readTableSchema 类型推断', () => {
    it('INTEGER → integer；字段名 is_*/has_* + 默认 0/1 → boolean', () => {
      exec('CREATE TABLE t (id INTEGER PRIMARY KEY, is_active INTEGER DEFAULT 1, has_pet INTEGER DEFAULT 0)');
      const { fields, primaryKey } = readTableSchema(dbs.businessRaw, 't');
      expect(primaryKey).toBe('id');
      const isActive = fields.find((f) => f.name === 'is_active')!;
      expect(isActive.jsonType).toBe('boolean');
      expect(isActive.sqliteType).toBe('INTEGER');
      const hasPet = fields.find((f) => f.name === 'has_pet')!;
      expect(hasPet.jsonType).toBe('boolean');
    });

    it('REAL/NUMERIC → number', () => {
      exec('CREATE TABLE t (id INTEGER PRIMARY KEY, price REAL, amount NUMERIC)');
      const { fields } = readTableSchema(dbs.businessRaw, 't');
      expect(fields.find((f) => f.name === 'price')!.jsonType).toBe('number');
      expect(fields.find((f) => f.name === 'amount')!.jsonType).toBe('number');
    });

    it('TEXT → string；*_at/*_time/time → datetime', () => {
      exec(
        'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, created_at TEXT, login_time TEXT, time TEXT, other TEXT)',
      );
      const { fields } = readTableSchema(dbs.businessRaw, 't');
      expect(fields.find((f) => f.name === 'name')!.jsonType).toBe('string');
      expect(fields.find((f) => f.name === 'created_at')!.jsonType).toBe('datetime');
      expect(fields.find((f) => f.name === 'login_time')!.jsonType).toBe('datetime');
      expect(fields.find((f) => f.name === 'time')!.jsonType).toBe('datetime');
      expect(fields.find((f) => f.name === 'other')!.jsonType).toBe('string');
    });

    it('主键、自增、可空、默认值回填', () => {
      exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, note TEXT)');
      const { fields, primaryKey } = readTableSchema(dbs.businessRaw, 't');
      expect(primaryKey).toBe('id');
      const id = fields.find((f) => f.name === 'id')!;
      expect(id.isPrimary).toBe(true);
      expect(id.isAutoIncrement).toBe(true);
      const name = fields.find((f) => f.name === 'name')!;
      expect(name.nullable).toBe(false);
      const note = fields.find((f) => f.name === 'note')!;
      expect(note.nullable).toBe(true);
    });

    it('默认值解析完整字面量，未求值 SQL 表达式保留原文，NULL 保持 null', () => {
      exec(`CREATE TABLE defaults (
        id INTEGER PRIMARY KEY,
        amount INTEGER DEFAULT -5,
        price REAL DEFAULT 1.5,
        exponent NUMERIC DEFAULT 1e2,
        label TEXT DEFAULT 'O''Brien',
        string_null TEXT DEFAULT 'NULL',
        expr_string TEXT DEFAULT ('a' || 'b'),
        is_active INTEGER DEFAULT 1,
        has_pet INTEGER DEFAULT 0,
        int_null INTEGER DEFAULT NULL,
        real_null REAL DEFAULT NULL,
        text_null TEXT DEFAULT NULL,
        expr_amount INTEGER DEFAULT (abs(-5)),
        expr_price REAL DEFAULT (1.5 + 2.5),
        expr_integer INTEGER DEFAULT (1 + 2)
      )`);
      const { fields } = readTableSchema(dbs.businessRaw, 'defaults');
      const defaults = Object.fromEntries(fields.map((field) => [field.name, field.defaultValue]));
      expect(defaults).toMatchObject({
        amount: -5,
        price: 1.5,
        exponent: 100,
        label: "O'Brien",
        string_null: 'NULL',
        expr_string: "'a' || 'b'",
        is_active: true,
        has_pet: false,
        int_null: null,
        real_null: null,
        text_null: null,
        expr_amount: 'abs(-5)',
        expr_price: '1.5 + 2.5',
        expr_integer: '1 + 2',
      });
    });

    it('created_at/updated_at 默认标记 isReadonly', () => {
      exec('CREATE TABLE t (id INTEGER PRIMARY KEY, created_at TEXT, updated_at TEXT, name TEXT)');
      const { fields } = readTableSchema(dbs.businessRaw, 't');
      expect(fields.find((f) => f.name === 'created_at')!.isReadonly).toBe(true);
      expect(fields.find((f) => f.name === 'updated_at')!.isReadonly).toBe(true);
      expect(fields.find((f) => f.name === 'name')!.isReadonly).toBe(false);
    });
  });

  describe('主键策略', () => {
    it('无主键 → TABLE_NO_PRIMARY_KEY', () => {
      exec('CREATE TABLE t (a INTEGER, b INTEGER)');
      expect(() => readTableSchema(dbs.businessRaw, 't')).toThrow(Errors.tableNoPrimaryKey('t'));
    });

    it('复合主键 → TABLE_COMPOSITE_PRIMARY_KEY', () => {
      exec('CREATE TABLE t (a INTEGER, b INTEGER, PRIMARY KEY (a, b))');
      expect(() => readTableSchema(dbs.businessRaw, 't')).toThrow(
        Errors.tableCompositePrimaryKey('t'),
      );
    });
  });
});
