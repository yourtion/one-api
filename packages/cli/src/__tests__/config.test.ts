import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, resolveConfigPath, resolveConnectOptions } from '../config.js';

let tmpHome: string;
const ORIG_HOME = process.env.HOME;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'cli-home-'));
  process.env.HOME = tmpHome;
});
afterEach(() => {
  process.env.HOME = ORIG_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('resolveConfigPath', () => {
  it('默认 ~/.one-api-cli/config.json', () => {
    expect(resolveConfigPath()).toBe(join(tmpHome, '.one-api-cli', 'config.json'));
  });
});

describe('saveConfig + loadConfig', () => {
  it('远程配置 round-trip', () => {
    saveConfig({ mode: 'remote', host: 'http://x:3000', token: 'oa_abc' });
    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.mode).toBe('remote');
    expect(loaded!.host).toBe('http://x:3000');
    expect(loaded!.token).toBe('oa_abc');
  });

  it('本地配置 round-trip', () => {
    saveConfig({ mode: 'local', dbPath: '/tmp/x.db' });
    const loaded = loadConfig();
    expect(loaded!.mode).toBe('local');
    expect(loaded!.dbPath).toBe('/tmp/x.db');
  });

  it('配置不存在 → loadConfig 返回 null', () => {
    expect(loadConfig()).toBeNull();
  });

  it('saveConfig 创建 ~/.one-api-cli/ 目录（若不存在）', () => {
    saveConfig({ mode: 'remote', host: 'http://x', token: 't' });
    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
  });
});

describe('resolveConnectOptions 合并（flag > file）', () => {
  it('flag.db → 本地模式（覆盖文件远程配置）', () => {
    saveConfig({ mode: 'remote', host: 'http://file', token: 'oa_file' });
    const cfg = resolveConnectOptions({ db: '/tmp/x.db' });
    expect(cfg?.mode).toBe('local');
    expect(cfg?.dbPath).toBe('/tmp/x.db');
  });

  it('flag.db + flag.systemDb → 本地模式含 systemDbPath', () => {
    const cfg = resolveConnectOptions({ db: '/tmp/x.db', systemDb: '/tmp/sys.db' });
    expect(cfg?.mode).toBe('local');
    expect(cfg?.dbPath).toBe('/tmp/x.db');
    expect(cfg?.systemDbPath).toBe('/tmp/sys.db');
  });

  it('flag host+token → 远程模式（覆盖文件）', () => {
    saveConfig({ mode: 'remote', host: 'http://file', token: 'oa_file' });
    const cfg = resolveConnectOptions({ host: 'http://override', token: 'oa_override' });
    expect(cfg?.host).toBe('http://override');
    expect(cfg?.token).toBe('oa_override');
  });

  it('无 flag → 用文件配置', () => {
    saveConfig({ mode: 'remote', host: 'http://file', token: 'oa_file' });
    const cfg = resolveConnectOptions({});
    expect(cfg?.host).toBe('http://file');
  });

  it('无 flag 无文件 → null', () => {
    expect(resolveConnectOptions({})).toBeNull();
  });

  it('部分 flag（只有 host）→ null（缺 token）', () => {
    expect(resolveConnectOptions({ host: 'http://x' })).toBeNull();
  });
});
