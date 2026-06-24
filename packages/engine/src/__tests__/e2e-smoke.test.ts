import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEngine } from '../engine.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 端到端冒烟：覆盖验收标准里 engine 对临时 SQLite 的完整流程。
 * （原计划用 tsx 跑 smoke.ts，tsx 属 Phase2 dev 工具未安装，改用 vitest 集成测试。）
 */
describe('e2e smoke', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), '1api-smoke-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('导入 → 新建 → CRUD → schema 演进 → 刷新 diff 全流程', async () => {
    const engine = await createEngine({
      businessDbPath: join(dir, 'biz.db'),
      systemDbPath: join(dir, 'sys.db'),
    });

    // 1. 导入已有表
    engine.businessRaw.exec('CREATE TABLE legacy (id INTEGER PRIMARY KEY, name TEXT)');
    const m1 = await engine.schema.importExisting('legacy');
    expect(m1.name).toBe('legacy');

    // 2. 新建模型（含时间戳）
    const m2 = await engine.schema.createModel({
      name: 'posts',
      label: '文章',
      fields: [{ name: 'title', jsonType: 'string', nullable: false }],
      autoTimestamps: true,
    });
    expect(m2.fields.map((f) => f.name)).toEqual(['id', 'title', 'created_at', 'updated_at']);

    // 3. CRUD + 时间戳自动填充
    const created = await engine.data.create('posts', { title: 'hello' }, { internal: true });
    expect(created.created_at).toBeTypeOf('number');
    expect(created.updated_at).toBe(created.created_at);

    const list = await engine.data.list('posts', { order: 'id:desc' }, { internal: true });
    expect(list.total).toBe(1);

    // 4. schema 演进：addField（ALTER TABLE 追加到末尾）
    await engine.schema.addField('posts', { name: 'views', jsonType: 'integer', nullable: true });
    const refreshed = await engine.schema.refresh('posts');
    expect(refreshed.fields.map((f) => f.name)).toEqual([
      'id',
      'title',
      'created_at',
      'updated_at',
      'views',
    ]);

    // 5. 刷新表结构 diff（业务库删字段）
    engine.businessRaw.exec('ALTER TABLE posts DROP COLUMN title');
    const after = await engine.schema.refresh('posts');
    expect(after.fields.map((f) => f.name)).toEqual(['id', 'created_at', 'updated_at', 'views']);

    await engine.destroy();
  });
});
