import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTest, seedBusinessTable, type TestSetup } from './helpers.js';

let t: TestSetup;
let tableId: number;
let admin: Awaited<ReturnType<TestSetup['adminSession']>>;

beforeAll(async () => {
  t = await setupTest();
  admin = await t.adminSession();
  await seedBusinessTable(t.businessDbPath, `
    CREATE TABLE export_rows (id INTEGER PRIMARY KEY, title TEXT, category TEXT, score INTEGER);
  `);
  const meta = await admin.post('/admin/tables/import').input({ name: 'export_rows' }).success() as { id: number };
  tableId = meta.id;
});

beforeEach(() => {
  const db = new Database(t.businessDbPath);
  try {
    db.exec('DELETE FROM export_rows');
  } finally {
    db.close();
  }
});

afterAll(async () => {
  await t.cleanup();
});

function seedRows(count: number, row = (id: number) => [id, `row-${id}`, 'keep', id]) {
  const db = new Database(t.businessDbPath);
  try {
    const insert = db.prepare('INSERT INTO export_rows (id, title, category, score) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      for (let id = 1; id <= count; id++) insert.run(...row(id));
    })();
  } finally {
    db.close();
  }
}

describe('CSV 导出完整性（真实 HTTP）', () => {
  it('105 行全部导出，普通列表仍限制为 100 行', async () => {
    seedRows(105);
    const res = await admin.get(`/admin/tables/${tableId}/export`).input({ page: 3, size: 1, order: 'id:asc' }).raw();
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(String(res.text).split('\r\n')).toEqual([
      'id,title,category,score',
      ...Array.from({ length: 105 }, (_, i) => `${i + 1},row-${i + 1},keep,${i + 1}`),
    ]);
    expect(res.headers['x-export-truncated']).toBeUndefined();
    expect(res.headers['x-export-total']).toBeUndefined();
    const list = await admin.get(`/admin/tables/${tableId}/data`).input({ size: 10000 }).success() as { rows: unknown[]; total: number };
    expect(list.rows).toHaveLength(100);
    expect(list.total).toBe(105);
  });

  it.each([10000, 10001])('%i 行导出恰好 10000 行，只有超限才提示真实总数', async (count) => {
    seedRows(count);
    const res = await admin.get(`/admin/tables/${tableId}/export`).input({ order: 'id:asc' }).raw();
    expect(res.status).toBe(200);
    const lines = String(res.text).split('\r\n');
    expect(lines).toHaveLength(10001);
    expect(lines[1]).toBe('1,row-1,keep,1');
    expect(lines.at(-1)).toBe('10000,row-10000,keep,10000');
    expect(res.headers['x-export-truncated']).toBe(count > 10000 ? 'true' : undefined);
    expect(res.headers['x-export-total']).toBe(count > 10000 ? String(count) : undefined);
  });

  it('跨页保留关键词、字段过滤及排序，只计算匹配记录的总数', async () => {
    seedRows(216, (id) => [id, id <= 210 ? 'wanted' : 'other', id % 2 ? 'keep' : 'drop', Math.floor(id / 10)]);
    const res = await admin.get(`/admin/tables/${tableId}/export`).input({
      q: 'wanted', category__eq: 'keep', order: 'score:desc,id:desc', page: 2, size: 2,
    }).raw();
    const expectedIds = Array.from({ length: 105 }, (_, i) => 209 - 2 * i);
    expect(String(res.text).split('\r\n')).toEqual([
      'id,title,category,score',
      ...expectedIds.map((id) => `${id},wanted,keep,${Math.floor(id / 10)}`),
    ]);
    expect(res.headers['x-export-truncated']).toBeUndefined();
    expect(res.headers['x-export-total']).toBeUndefined();
  });

  it('没有匹配记录时仅返回表头', async () => {
    seedRows(1);
    const res = await admin.get(`/admin/tables/${tableId}/export`).input({ q: 'absent' }).raw();
    expect(res.status).toBe(200);
    expect(res.text).toBe('id,title,category,score');
    expect(res.headers['x-export-truncated']).toBeUndefined();
    expect(res.headers['x-export-total']).toBeUndefined();
  });

  it('列名和数据均转义逗号、双引号、CR、LF，null 输出空单元格', async () => {
    await seedBusinessTable(t.businessDbPath, `
      CREATE TABLE export_escaped (id INTEGER PRIMARY KEY, "comma,name" TEXT, "quote""name" TEXT, "cr\rname" TEXT, "lf\nname" TEXT, empty TEXT);
      INSERT INTO export_escaped VALUES (1, 'a,b', 'a"b', 'a\rb', 'a\nb', NULL);
    `);
    const meta = await admin.post('/admin/tables/import').input({ name: 'export_escaped' }).success() as { id: number };
    const res = await admin.get(`/admin/tables/${meta.id}/export`).raw();
    expect(res.status).toBe(200);
    expect(res.text).toBe('id,"comma,name","quote""name","cr\rname","lf\nname",empty\r\n1,"a,b","a""b","a\rb","a\nb",');
  });
});
