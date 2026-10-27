import { afterEach, describe, expect, it } from 'vitest';
import { parseArgs, mergeConfig } from '../args.js';

const ENV_KEYS = ['PORT', 'ONE_API_DATA_DIR', 'ONE_API_SYSTEM_DB', 'ONE_API_BUSINESS_DB', 'ONE_API_DEFAULT_ADMIN_NAME', 'ONE_API_DEFAULT_ADMIN_PASSWORD'] as const;

describe('parseArgs', () => {
  it('解析 --port value', () => {
    expect(parseArgs(['--port', '8080'])).toEqual({ port: 8080 });
  });

  it('解析 --no-web', () => {
    expect(parseArgs(['--no-web'])).toEqual({ noWeb: true });
  });

  it('解析 --data-dir value', () => {
    expect(parseArgs(['--data-dir', '/tmp/x'])).toEqual({ dataDir: '/tmp/x' });
  });

  it('解析 --system-db / --business-db', () => {
    expect(parseArgs(['--system-db', '/a.db', '--business-db', '/b.db'])).toEqual({ systemDb: '/a.db', businessDb: '/b.db' });
  });

  it('解析 --admin-name / --admin-password', () => {
    expect(parseArgs(['--admin-name', 'root', '--admin-password', 'pw'])).toEqual({ adminName: 'root', adminPassword: 'pw' });
  });

  it('混合多 flag', () => {
    expect(parseArgs(['--port', '9', '--no-web', '--data-dir', '/d'])).toEqual({ port: 9, noWeb: true, dataDir: '/d' });
  });

  it('未知 flag 抛错', () => {
    expect(() => parseArgs(['--unknown', 'x'])).toThrow(/未知参数/);
  });

  it('--port 非数字抛错', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow(/端口/);
  });

  it('空 argv 返回空对象', () => {
    expect(parseArgs([])).toEqual({});
  });
});

describe('mergeConfig', () => {
  afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });

  it('flag port 覆盖 env port 覆盖默认', () => {
    process.env['PORT'] = '9000';
    const cfg = mergeConfig({ port: 8080 });
    expect(cfg.port).toBe(8080);
  });

  it('env port 覆盖默认（无 flag）', () => {
    process.env['PORT'] = '9000';
    const cfg = mergeConfig({});
    expect(cfg.port).toBe(9000);
  });

  it('flag dataDir 派生 systemDb/businessDb', () => {
    const cfg = mergeConfig({ dataDir: '/tmp/1api' });
    expect(cfg.systemDbPath).toBe('/tmp/1api/system.db');
    expect(cfg.businessDbPath).toBe('/tmp/1api/business.db');
  });

  it('flag systemDb 覆盖 dataDir 派生值', () => {
    const cfg = mergeConfig({ dataDir: '/tmp/1api', systemDb: '/custom.db' });
    expect(cfg.systemDbPath).toBe('/custom.db');
    expect(cfg.businessDbPath).toBe('/tmp/1api/business.db');
  });

  it('无任何输入返回空对象（走 server 默认）', () => {
    expect(mergeConfig({})).toEqual({});
  });

  it('adminName/adminPassword 透传', () => {
    const cfg = mergeConfig({ adminName: 'root', adminPassword: 'pw' });
    expect(cfg.defaultAdmin).toEqual({ name: 'root', password: 'pw' });
  });

  it('defaultAdmin 条件挂载（仅一个时只含该字段）', () => {
    const cfg = mergeConfig({ adminName: 'root' });
    expect(cfg.defaultAdmin).toEqual({ name: 'root', password: '123456' });
    // 密码无 flag 时用 server 默认 123456（mergeConfig 需补全以保证 defaultAdmin 完整）
  });
});

describe('拒绝无效输入', () => {
  afterEach(() => { delete process.env['PORT']; });
  it.each(['--port', '--data-dir', '--system-db', '--business-db', '--admin-name', '--admin-password'])('%s 拒绝缺值、空值和后续 flag', (flag) => {
    for (const rest of [[], [''], ['--no-web']]) expect(() => parseArgs([flag, ...rest])).toThrow(/缺少值/);
  });
  it.each(['1.5', '-1', '65536', 'Infinity'])('拒绝非法端口 %s', (port) => {
    expect(() => parseArgs(['--port', port])).toThrow(/端口/);
  });
  it.each(['0', '65535'])('接受边界端口 %s', (port) => {
    expect(parseArgs(['--port', port]).port).toBe(Number(port));
  });
  it('非法 PORT 报错且可被有效 flag 覆盖', () => {
    process.env['PORT'] = 'bad';
    expect(() => mergeConfig({})).toThrow(/端口|PORT/);
    expect(mergeConfig({ port: 0 }).port).toBe(0);
  });
});
