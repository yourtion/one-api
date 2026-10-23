import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectPackage } from './release-preflight.mjs';

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function artifact(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'release-contract-'));
  directories.push(directory);
  mkdirSync(join(directory, 'dist'));
  for (const file of ['LICENSE', 'CHANGELOG.md', 'dist/index.js'])
    writeFileSync(
      join(directory, file),
      file === 'dist/index.js' ? '#!/usr/bin/env node\n' : 'MIT',
    );
  const manifest = {
    name: '@1api/cli',
    version: '0.1.1',
    license: 'MIT',
    files: ['dist', 'LICENSE', 'CHANGELOG.md'],
    main: './dist/index.js',
    bin: { 'one-api-cli': './dist/index.js' },
    engines: { node: '^22.13.0 || >=24' },
    ...overrides,
  };
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
  return directory;
}

test('可发布的 bin 包无需声明不存在的类型入口', () => {
  assert.equal(inspectPackage(artifact(), '0.1.1').name, '@1api/cli');
});
test('拒绝版本不一致或与传递依赖不兼容的运行时范围', () => {
  assert.throws(() => inspectPackage(artifact({ version: '0.1.0' }), '0.1.1'), /version/);
  assert.throws(() => inspectPackage(artifact({ engines: { node: '>=18' } }), '0.1.1'), /runtime/);
});
test('拒绝虚假的声明入口及遗漏的构建产物', () => {
  assert.throws(() => inspectPackage(artifact({ types: './dist/index.d.ts' }), '0.1.1'), /ENOENT/);
  const directory = artifact();
  rmSync(join(directory, 'dist/index.js'));
  assert.throws(() => inspectPackage(directory, '0.1.1'), /ENOENT/);
});
test('拒绝未进入发布白名单的许可证及无效 bin', () => {
  assert.throws(
    () => inspectPackage(artifact({ files: ['dist', 'CHANGELOG.md'] }), '0.1.1'),
    /LICENSE/,
  );
  const directory = artifact();
  writeFileSync(join(directory, 'dist/index.js'), 'console.log("no shebang")');
  assert.throws(() => inspectPackage(directory, '0.1.1'), /shebang/);
});

test('拒绝遗漏命令注册及库的类型声明元数据', () => {
  assert.throws(() => inspectPackage(artifact({ bin: {} }), '0.1.1'), /缺少 bin/);
  assert.throws(() => inspectPackage(artifact({ name: '@1api/engine' }), '0.1.1'), /缺少 types/);
});
