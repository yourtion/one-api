import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeEngine = '^22.13.0 || >=24';
export const publishedDirectories = [
  'packages/shared',
  'packages/engine',
  'packages/sdk',
  'packages/cli',
  'apps/server',
  'apps/web',
  'packages/serve',
];
// npm discards build metadata, so accepted versions must round-trip unchanged.
const number = '(?:0|[1-9][0-9]*)';
const identifier = `(?:${number}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const releaseVersionPattern = new RegExp(
  `^${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?$`,
);
export function isReleaseVersion(version) {
  return (
    typeof version === 'string' &&
    version.length <= 256 &&
    releaseVersionPattern.test(version) &&
    version
      .split('-')[0]
      .split('.')
      .every((part) => BigInt(part) <= BigInt(Number.MAX_SAFE_INTEGER))
  );
}
const runtimePackages = new Set(['@1api/engine', '@1api/cli', '@1api/server', '@1api/serve']);

/** 校验发布包的真实文件契约；无需网络或 npm registry。 */
export function inspectPackage(directory, version) {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.version, version, `${manifest.name}: version 不一致`);
  assert.equal(manifest.private === true, false, `${manifest.name}: 不应为 private`);
  assert.equal(manifest.license, 'MIT', `${manifest.name}: 缺少 license 元数据`);
  assert.ok(manifest.files?.includes('dist'), `${manifest.name}: files 缺少 dist`);
  for (const file of ['LICENSE', 'CHANGELOG.md']) {
    assert.ok(manifest.files.includes(file), `${manifest.name}: files 缺少 ${file}`);
    assert.ok(statSync(resolve(directory, file)).isFile(), `${manifest.name}: 缺少 ${file}`);
  }
  if (runtimePackages.has(manifest.name)) {
    assert.equal(
      manifest.engines?.node,
      runtimeEngine,
      `${manifest.name}: Node runtime 范围不一致`,
    );
  } else if (['@1api/shared', '@1api/sdk'].includes(manifest.name)) {
    assert.equal(manifest.engines?.node, '>=18', `${manifest.name}: isomorphic 兼容范围不一致`);
  }
  if (manifest.name !== '@1api/web') {
    assert.equal(typeof manifest.main, 'string', `${manifest.name}: 缺少 main 入口`);
    if (manifest.name !== '@1api/cli') {
      assert.equal(typeof manifest.types, 'string', `${manifest.name}: 缺少 types 入口`);
    }
  }
  const binName = { '@1api/cli': 'one-api-cli', '@1api/serve': '1api' }[manifest.name];
  if (binName)
    assert.equal(typeof manifest.bin?.[binName], 'string', `${manifest.name}: 缺少 bin ${binName}`);
  const entries = [manifest.main, manifest.types];
  for (const value of Object.values(manifest.exports?.['.'] ?? {})) entries.push(value);
  if (manifest.name === '@1api/web') entries.push('dist/index.html');
  for (const entry of entries.filter(Boolean)) {
    assert.ok(statSync(resolve(directory, entry)).isFile(), `${manifest.name}: 缺少入口 ${entry}`);
  }
  for (const bin of Object.values(manifest.bin ?? {})) {
    assert.ok(
      readFileSync(resolve(directory, bin), 'utf8').startsWith('#!/usr/bin/env node\n'),
      `${manifest.name}: bin 缺少 Node shebang`,
    );
  }
  return manifest;
}

export async function preflight(directory = root) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(
    major >= 24 || (major === 22 && minor >= 13),
    `需要 Node ${runtimeEngine}，当前 ${process.versions.node}`,
  );
  const sharedPath = resolve(directory, 'packages/shared');
  const { version } = JSON.parse(readFileSync(resolve(sharedPath, 'package.json'), 'utf8'));
  assert.ok(isReleaseVersion(version), '发布版本必须为严格 semver（不含 build metadata）');
  const manifests = publishedDirectories.map((path) =>
    inspectPackage(resolve(directory, path), version),
  );
  const load = (path) => import(pathToFileURL(resolve(directory, path)).href);
  const shared = await load('packages/shared/dist/index.js');
  assert.equal(shared.ONE_API_VERSION, version, 'shared dist 版本过期，请重新 build');
  assert.equal(shared.__SHARED_VERSION, version, 'shared 兼容版本导出不一致');
  const { API_INFO } = await load('apps/server/dist/api/groups.js');
  assert.equal(API_INFO.version, version, 'HTTP API 版本不一致');
  const cliVersion = execFileSync(
    process.execPath,
    [resolve(directory, 'packages/cli/dist/index.js'), '--version'],
    { encoding: 'utf8', timeout: 10000 },
  ).trim();
  assert.equal(cliVersion, version, 'CLI --version 不一致');

  // 使用内存 transport 验证 MCP initialize 的实际服务身份，避免监听端口和网络依赖。
  const requireServer = createRequire(resolve(directory, 'apps/server/package.json'));
  const importSdk = (path) => import(pathToFileURL(requireServer.resolve(path)).href);
  const { Client } = await importSdk('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await importSdk('@modelcontextprotocol/sdk/inMemory.js');
  const { buildMcpServer } = await load('apps/server/dist/modules/mcp/server.js');
  const server = buildMcpServer({
    id: 0,
    name: 'preflight',
    permissions: { tables: [], actions: [] },
  });
  const client = new Client({ name: 'release-preflight', version });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.deepEqual(
      client.getServerVersion(),
      { name: 'one-api', version },
      'MCP initialize 版本不一致',
    );
  } finally {
    await client.close();
    await server.close();
  }
  console.log(
    `Release preflight passed: ${manifests.length} packages @ ${version}, Node ${process.versions.node}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await preflight();
}
