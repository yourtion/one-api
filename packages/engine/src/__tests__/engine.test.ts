import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngine } from '../engine.js';

describe('createEngine + DataEngine', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), '1api-engine-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('从路径创建 + 系统库建 table_meta + 缓存预热（空）', async () => {
    const engine = await createEngine({
      businessDbPath: join(dir, 'biz.db'),
      systemDbPath: join(dir, 'sys.db'),
    });
    // 空库预热：list 未知表 → TABLE_NOT_FOUND
    await expect(engine.data.list('__any__', {}, { internal: true })).rejects.toThrow(
      /TABLE_NOT_FOUND|不存在/,
    );
    // schema.import 一张表，data.list 能读到
    engine.businessRaw.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    await engine.schema.importExisting('users');
    const r = await engine.data.list('users', {}, { internal: true });
    expect(r.total).toBe(0);
    await engine.destroy();
  });

  it('describe 返回导入表元数据', async () => {
    const engine = await createEngine({
      businessDbPath: join(dir, 'biz.db'),
      systemDbPath: join(dir, 'sys.db'),
    });
    engine.businessRaw.exec('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)');
    await engine.schema.importExisting('posts');
    const m = await engine.data.describe('posts');
    expect(m.name).toBe('posts');
    await engine.destroy();
  });
});
