import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemoteConnection, createLocalConnection } from '../connection.js';
import { setupTest } from '@1api/server/__tests__/helpers.js';
import type { TestSetup } from '@1api/server/__tests__/helpers.js';
import { ensureSystemDb } from '../local-auth.js';
import { createEngine } from '@1api/engine';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

// —— RemoteConnection 集成（连临时 server）——
let t: TestSetup;
let baseUrl: string;

beforeEach(async () => {
  t = await setupTest();
  // ⚠️ 重要：server 的 setupTest 在根路径挂载 erest（非 /api 子挂载），故 data 路由在 /data/*（不是 /api/data/*）
  baseUrl = `${new URL(t.mcpUrl).origin}/data`;
});
afterAll(async () => {
  await t.cleanup();
});

describe('RemoteConnection（走 SDK）', () => {
  it('完整 CRUD + schema', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await conn.schema.createTable({
      name: 'rc', label: 'rc',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'n', jsonType: 'string', nullable: true },
      ],
    });
    const created = await conn.create('rc', { n: 'a' });
    expect(created.n).toBe('a');
    const list = await conn.list('rc');
    expect(list.total).toBe(1);
    const got = await conn.get('rc', (created as { id: number }).id);
    expect(got.n).toBe('a');
    await conn.update('rc', (created as { id: number }).id, { n: 'b' });
    expect((await conn.get('rc', (created as { id: number }).id)).n).toBe('b');
    await conn.delete('rc', (created as { id: number }).id);
    expect((await conn.list('rc')).total).toBe(0);
  });

  it('describe / incr / addField', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read', 'write', 'schema'] });
    const conn = createRemoteConnection(baseUrl, token);
    await conn.schema.createTable({
      name: 'rc2', label: 'rc2',
      fields: [
        { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
        { name: 'v', jsonType: 'integer', nullable: false, defaultValue: 0 },
      ],
    });
    const meta = await conn.describe('rc2');
    expect(meta.name).toBe('rc2');
    // 注意：engine 要求至少一个可写字段（空对象 {} 会被拒），v 虽有默认值仍需显式写入
    const row = await conn.create('rc2', { v: 0 });
    await conn.incr('rc2', (row as { id: number }).id, 'v', 3);
    expect((await conn.get('rc2', (row as { id: number }).id)).v).toBe(3);
    const after = await conn.schema.addField('rc2', { name: 'n', jsonType: 'string', nullable: true });
    expect(after.fields.map((f) => f.name)).toContain('n');
  });

  it('listTables 远程模式不支持 → 抛友好错误', async () => {
    const token = await t.insertToken({ tables: ['*'], actions: ['read'] });
    const conn = createRemoteConnection(baseUrl, token);
    await expect(conn.listTables()).rejects.toThrow(/远程模式|不支持枚举/);
  });
});

// —— LocalConnection 集成（临时 DB）——
describe('LocalConnection（走 engine）', () => {
  let dir: string;
  let bizPath: string;
  let sysPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cli-local-conn-'));
    bizPath = join(dir, 'biz.db');
    sysPath = join(dir, 'sys.db');
    ensureSystemDb(sysPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('完整 CRUD + schema（internal 通道）', async () => {
    const engine = await createEngine({ businessDbPath: bizPath, systemDbPath: sysPath });
    try {
      // 插一个全权 token 到系统库
      const raw = new Database(sysPath);
      raw.prepare(`INSERT INTO api_token (name, token_hash, token_prefix, permissions, is_active, expires_at, last_used_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`).run(
        't', createHash('sha256').update('oa_local').digest('hex'), 'oa_local'.slice(0, 8) + '****',
        JSON.stringify({ tables: ['*'], actions: ['read', 'write', 'schema'] }), 1, Date.now(), Date.now(),
      );
      raw.close();

      const conn = await createLocalConnection(bizPath, sysPath, 'oa_local');
      await conn.schema.createTable({
        name: 'lc', label: 'lc',
        fields: [
          { name: 'id', jsonType: 'integer', isPrimary: true, isAutoIncrement: true, nullable: false },
          { name: 'n', jsonType: 'string', nullable: true },
        ],
      });
      const created = await conn.create('lc', { n: 'x' });
      expect(created.n).toBe('x');
      const list = await conn.list('lc');
      expect(list.total).toBe(1);
      const tables = await conn.listTables();
      expect(tables.map((m) => m.name)).toContain('lc');
      await conn.delete('lc', (created as { id: number }).id);
      expect((await conn.list('lc')).total).toBe(0);
    } finally {
      await engine.destroy();
    }
  });

  it('无 token（null）→ 信任本地，可操作', async () => {
    const engine = await createEngine({ businessDbPath: bizPath, systemDbPath: sysPath });
    try {
      const conn = await createLocalConnection(bizPath, sysPath, null);
      await conn.schema.createTable({
        name: 'nt', label: 'nt',
        fields: [{ name: 'id', jsonType: 'integer', isPrimary: true, nullable: false }],
      });
      const tables = await conn.listTables();
      expect(tables.map((m) => m.name)).toContain('nt');
    } finally {
      await engine.destroy();
    }
  });

  it('无效 token → 抛错', async () => {
    await expect(createLocalConnection(bizPath, sysPath, 'oa_invalid')).rejects.toThrow(/无效|token/i);
  });
});
