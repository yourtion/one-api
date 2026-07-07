import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { ensureSystemDb, resolveLocalToken, hashToken } from '../local-auth.js';

let dir: string;
let systemDbPath: string;
let raw: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cli-local-auth-'));
  systemDbPath = join(dir, 'system.db');
  raw = new Database(systemDbPath);
});
afterAll(() => {
  raw.close();
  rmSync(dir, { recursive: true, force: true });
});

function insertTokenRow(
  plain: string,
  perms: object,
  opts: { active?: number; expires?: number | null } = {},
) {
  raw
    .prepare(
      `INSERT INTO api_token (name, token_hash, token_prefix, permissions, is_active, expires_at, last_used_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      'test',
      hashToken(plain),
      plain.slice(0, 8) + '****',
      JSON.stringify(perms),
      opts.active ?? 1,
      opts.expires ?? null,
      Date.now(),
      Date.now(),
    );
}

describe('hashToken', () => {
  it('sha256 hex（与 server hashToken 一致）', () => {
    expect(hashToken('oa_abc')).toBe(createHash('sha256').update('oa_abc').digest('hex'));
  });
});

describe('ensureSystemDb', () => {
  it('建 table_meta + api_token + admin 表（IF NOT EXISTS）', () => {
    ensureSystemDb(systemDbPath);
    const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
      name: string;
    }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('table_meta');
    expect(names).toContain('api_token');
    expect(names).toContain('admin');
  });

  it('重复调用幂等', () => {
    ensureSystemDb(systemDbPath);
    ensureSystemDb(systemDbPath);
    const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as {
      name: string;
    }[];
    expect(tables.filter((t) => t.name === 'api_token')).toHaveLength(1);
  });
});

describe('resolveLocalToken', () => {
  beforeEach(() => ensureSystemDb(systemDbPath));

  it('有效 token → 返回 permissions', async () => {
    insertTokenRow('oa_xyz', { tables: ['*'], actions: ['read', 'write'] });
    const t = await resolveLocalToken(systemDbPath, 'oa_xyz');
    expect(t).not.toBeNull();
    expect(t!.permissions.tables).toEqual(['*']);
    expect(t!.permissions.actions).toEqual(['read', 'write']);
  });

  it('token 不存在 → null', async () => {
    expect(await resolveLocalToken(systemDbPath, 'oa_nope')).toBeNull();
  });

  it('is_active=0 → null', async () => {
    insertTokenRow('oa_off', { tables: ['*'], actions: ['read'] }, { active: 0 });
    expect(await resolveLocalToken(systemDbPath, 'oa_off')).toBeNull();
  });

  it('过期 → null', async () => {
    insertTokenRow('oa_old', { tables: ['*'], actions: ['read'] }, { expires: Date.now() - 1000 });
    expect(await resolveLocalToken(systemDbPath, 'oa_old')).toBeNull();
  });
});
