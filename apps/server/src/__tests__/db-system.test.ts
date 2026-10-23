import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { initSystemDb } from '../db/system.js';

let dir: string;
afterEach(() => {
  vi.restoreAllMocks();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('initSystemDb', () => {
  it('首次启动：建 admin/api_token/table_meta 表 + 插入默认 admin（must_change_password=1）', async () => {
    dir = mkdtempSync(join(tmpdir(), '1api-sys-'));
    const path = join(dir, 'system.db');
    const { raw, close } = await initSystemDb(path);

    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('admin');
    expect(names).toContain('api_token');
    expect(names).toContain('table_meta');

    const admin = raw
      .prepare('SELECT name, must_change_password FROM admin WHERE name = ?')
      .get('admin') as { name: string; must_change_password: number };
    expect(admin).toBeDefined();
    expect(admin.must_change_password).toBe(1);

    await close();
  });

  it('再次启动：不重复插入 admin，表已存在不报错（幂等）', async () => {
    dir = mkdtempSync(join(tmpdir(), '1api-sys-'));
    const path = join(dir, 'system.db');
    await (await initSystemDb(path)).close();
    const { close } = await initSystemDb(path); // 第二次
    const db = new Database(path);
    const count = (db.prepare('SELECT COUNT(*) AS c FROM admin').get() as { c: number }).c;
    expect(count).toBe(1);
    db.close();
    await close();
  });
});


describe('系统库工厂失败清理', () => {
  it('已有库的 DDL/初始化失败时关闭尚未返回的 SQLite 句柄', async () => {
    dir = mkdtempSync(join(tmpdir(), '1api-sys-failed-'));
    const path = join(dir, 'system.db');
    const bad = new Database(path);
    bad.exec('CREATE TABLE admin (name TEXT)');
    bad.close();
    const close = vi.spyOn(Database.prototype, 'close');
    await expect(initSystemDb(path)).rejects.toThrow(/nickname/);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close.mock.contexts[0]!.open).toBe(false);
  });
});
