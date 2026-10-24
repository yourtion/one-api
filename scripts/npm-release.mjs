import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { publishedDirectories, isReleaseVersion } from './release-preflight.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = 'https://registry.npmjs.org/';
const dependencyFields = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
];
const lifecycle = [
  'prepare',
  'prepublish',
  'prepublishOnly',
  'prepack',
  'postpack',
  'publish',
  'postpublish',
];
const repositoryUrl = 'git+https://github.com/yourtion/one-api.git';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

function execute(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
    env: { ...process.env, ...options.env, NPM_CONFIG_REGISTRY: registry },
  });
}

function output(result) {
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || 'Release command failed');
  return result.stdout;
}

function publicManifest(manifest) {
  assert.ok(
    !manifest.private && /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(manifest.name ?? ''),
    'Expected a named, public npm package',
  );
  for (const hook of lifecycle)
    assert.ok(
      !manifest.scripts?.[hook],
      `${manifest.name}: publishing lifecycle ${hook} requires explicit support`,
    );
  assert.deepEqual(
    manifest.publishConfig,
    { access: 'public' },
    `${manifest.name}: unsupported publishConfig`,
  );
}

export function releaseInfo(tag, packages) {
  const version = typeof tag === 'string' && tag.startsWith('v') ? tag.slice(1) : '';
  assert.ok(
    isReleaseVersion(version),
    `Tag ${tag} must be strict v<SemVer>, without build metadata`,
  );
  assert.ok(packages.length > 0, 'Release has no packages');
  const names = new Set();
  for (const { manifest } of packages) {
    publicManifest(manifest);
    assert.equal(manifest.version, version, `${manifest.name}: version must match ${tag}`);
    assert.ok(!names.has(manifest.name), `Duplicate package ${manifest.name}`);
    names.add(manifest.name);
  }
  return {
    tag,
    version,
    prerelease: version.includes('-'),
    distTag: version.includes('-') ? 'next' : 'latest',
  };
}

// Deliberately bounded range support: never guess whether an arbitrary range
// includes prereleases. Add support and tests before adopting another convention.
function packedRange(range, version) {
  if (range === 'workspace:*') return version;
  if (range === 'workspace:^') return `^${version}`;
  if (range === 'workspace:~') return `~${version}`;
  const value = range?.replace(/^workspace:/, '');
  if ([version, `^${version}`, `~${version}`].includes(value)) return value;
  throw new Error(
    `Unsupported or incompatible internal range ${range}; expected this release's exact version, ^version, ~version or workspace:*/^/~`,
  );
}

export function publicationOrder(packages, workspaceNames = packages.map((p) => p.manifest.name)) {
  const byName = new Map(packages.map((p) => [p.manifest.name, p]));
  assert.equal(byName.size, packages.length, 'Duplicate publication package');
  const allNames = new Set(workspaceNames);
  for (const { manifest } of packages) {
    for (const field of dependencyFields) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        const internal =
          allNames.has(name) || name.startsWith('@1api/') || range.startsWith('workspace:');
        if (!internal) continue;
        assert.ok(byName.has(name), `${manifest.name}: omitted workspace package ${name}`);
        packedRange(range, byName.get(name).manifest.version);
      }
    }
  }
  const visiting = new Set();
  const done = new Set();
  const ordered = [];
  function visit(item) {
    const { manifest } = item;
    if (done.has(manifest.name)) return;
    assert.ok(!visiting.has(manifest.name), `Internal dependency cycle at ${manifest.name}`);
    visiting.add(manifest.name);
    for (const name of new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]))
      if (byName.has(name)) visit(byName.get(name));
    visiting.delete(manifest.name);
    done.add(manifest.name);
    ordered.push(item);
  }
  packages.forEach(visit);
  return ordered;
}

export function readPackages(directory = root) {
  const packages = publishedDirectories.map((path) => ({
    directory: path,
    manifest: json(resolve(directory, path, 'package.json')),
  }));
  // The repository's pnpm-workspace.yaml uses packages/* and apps/*.
  // Include private workspaces in omission checks, never in the publication set.
  const names = [];
  for (const parent of ['packages', 'apps']) {
    for (const entry of readdirSync(resolve(directory, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const files = readdirSync(resolve(directory, parent, entry.name));
        if (files.includes('package.json'))
          names.push(json(resolve(directory, parent, entry.name, 'package.json')).name);
      }
    }
  }
  publicationOrder(packages, names);
  return packages;
}

export function checkGit(tag, directory = root, run = execute) {
  const commit = output(
    run('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { cwd: directory }),
  ).trim();
  const head = output(run('git', ['rev-parse', 'HEAD'], { cwd: directory })).trim();
  assert.ok(commit && commit === head, 'Release tag must point to checked out HEAD');
  output(run('git', ['merge-base', '--is-ancestor', commit, 'origin/main'], { cwd: directory }));
}

export function checkNpmVersion(run = execute) {
  const version = output(run('npm', ['--version'])).trim();
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const parts = match?.slice(1).map(Number);
  assert.ok(
    parts &&
      (parts[0] > 11 || (parts[0] === 11 && (parts[1] > 5 || (parts[1] === 5 && parts[2] >= 1)))),
    `npm >=11.5.1 required for Trusted Publishing; found ${version}`,
  );
  console.log(`Trusted Publishing npm runtime: ${version}`);
}

function safePath(path) {
  assert.ok(
    path &&
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.split('/').some((part) => part === '..' || part === '.'),
    `Unsafe tar path ${path}`,
  );
  return path;
}

// Parse regular files in memory; never extract untrusted paths or links onto disk.
// Support ustar and PAX paths emitted by pnpm, rejecting unsupported entry types.
function tarFiles(bytes) {
  const tar = gunzipSync(bytes);
  const files = new Map();
  let nextPath;
  let ended = false;
  for (let position = 0; position + 512 <= tar.length;) {
    const header = tar.subarray(position, position + 512);
    if (header.every((byte) => byte === 0)) {
      ended = true;
      break;
    }
    const text = (start, length) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .split('\0', 1)[0];
    const octal = (start, length) => {
      const value = text(start, length).trim();
      assert.match(value, /^[0-7]+$/, 'Invalid tar numeric header');
      return parseInt(value, 8);
    };
    const sum = [...header].reduce(
      (value, byte, i) => value + (i >= 148 && i < 156 ? 32 : byte),
      0,
    );
    assert.equal(sum, octal(148, 8), 'Invalid tar header checksum');
    const size = octal(124, 12);
    const body = tar.subarray(position + 512, position + 512 + size);
    assert.equal(body.length, size, 'Truncated tar entry');
    const type = text(156, 1);
    let path = text(0, 100);
    const prefix = text(345, 155);
    if (prefix) path = `${prefix}/${path}`;
    position += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      assert.equal(nextPath, undefined, 'Consecutive PAX entries are unsupported');
      for (let offset = 0; offset < body.length;) {
        const space = body.indexOf(32, offset);
        assert.ok(space > offset, 'Invalid PAX record');
        const length = Number(body.subarray(offset, space).toString());
        assert.ok(
          Number.isSafeInteger(length) &&
            length > space - offset + 1 &&
            offset + length <= body.length,
          'Invalid PAX length',
        );
        const value = body.subarray(space + 1, offset + length - 1).toString();
        const equal = value.indexOf('=');
        assert.ok(equal > 0, 'Invalid PAX value');
        const key = value.slice(0, equal);
        assert.ok(
          ['path', 'mtime', 'atime', 'ctime', 'uid', 'gid', 'uname', 'gname'].includes(key),
          `Unsupported PAX key ${key}`,
        );
        if (key === 'path') nextPath = value.slice(equal + 1);
        offset += length;
      }
      continue;
    }
    path = nextPath ?? path;
    nextPath = undefined;
    safePath(path.replace(/\/$/, ''));
    assert.ok(path.startsWith('package/'), `Unsafe tar path ${path}`);
    assert.ok(['0', '', '5'].includes(type), `Unsupported tar entry type ${type}`);
    if (type === '5') continue;
    const relative = path.slice('package/'.length);
    assert.ok(relative && !files.has(relative), `Duplicate or empty tar entry ${relative}`);
    files.set(relative, { body, mode: octal(100, 8) });
  }
  assert.ok(ended && !nextPath, 'Truncated tar archive');
  return files;
}

function targets(value, entries = []) {
  if (typeof value === 'string') entries.push(value);
  else if (value && typeof value === 'object')
    Object.values(value).forEach((nested) => targets(nested, entries));
  return entries;
}

export function validateTarball(bytes, source, packages) {
  const files = tarFiles(bytes);
  assert.ok(files.has('package.json'), 'Tarball missing package.json');
  const packed = JSON.parse(files.get('package.json').body.toString('utf8'));
  publicManifest(packed);
  assert.equal(packed.name, source.name, 'Tarball name mismatch');
  assert.equal(packed.version, source.version, 'Tarball version mismatch');
  assert.equal(packed.license, 'MIT', 'Tarball license mismatch');
  assert.deepEqual(packed.repository, source.repository, 'Tarball repository metadata mismatch');
  assert.equal(packed.repository?.url, repositoryUrl, 'Expected canonical repository URL');
  assert.equal(packed.repository?.type, 'git', 'Expected git repository');
  for (const field of ['exports', 'main', 'types', 'bin'])
    assert.deepEqual(packed[field], source[field], `Tarball ${field} changed during pack`);
  const entries = targets([packed.main, packed.types, packed.exports, packed.bin]);
  entries.push('LICENSE', 'CHANGELOG.md');
  if (packed.name === '@1api/web') entries.push('dist/index.html');
  for (const entry of entries) {
    assert.ok(!entry.includes('*'), `Unsupported wildcard entry ${entry}`);
    const path = safePath(entry.replace(/^\.\//, ''));
    assert.ok(files.has(path), `Tarball missing entry ${entry}`);
  }
  for (const entry of targets(packed.bin)) {
    const file = files.get(entry.replace(/^\.\//, ''));
    assert.ok(
      file.body.toString().startsWith('#!/usr/bin/env node\n'),
      `Bin ${entry} missing Node shebang`,
    );
    assert.ok(file.mode & 0o111, `Bin ${entry} is not executable`);
  }
  const byName = new Map(packages.map((p) => [p.manifest.name, p.manifest]));
  for (const field of dependencyFields) {
    const expected = {};
    for (const [name, range] of Object.entries(source[field] ?? {}))
      expected[name] = byName.has(name) ? packedRange(range, byName.get(name).version) : range;
    assert.deepEqual(packed[field] ?? {}, expected, `Tarball ${field} range conversion mismatch`);
    for (const range of Object.values(packed[field] ?? {}))
      assert.ok(!range.startsWith('workspace:'), 'Unresolved workspace range in tarball');
  }
  return packed;
}

function filename(manifest) {
  return `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`;
}

function checksumText(record, manifestBytes) {
  return (
    [
      ...record.packages.map((p) => `${p.sha256}  ${p.filename}`),
      `${sha256(manifestBytes)}  release-manifest.json`,
    ].join('\n') + '\n'
  );
}

export function packRelease(packages, info, destination, run = execute, directory = root) {
  destination = resolve(destination);
  mkdirSync(destination, { recursive: true });
  const records = [];
  for (const item of publicationOrder(packages)) {
    const { manifest } = item;
    publicManifest(manifest);
    output(
      run('pnpm', ['pack', '--pack-destination', destination], {
        cwd: resolve(directory, item.directory),
        env: { npm_config_ignore_scripts: 'true', NPM_CONFIG_IGNORE_SCRIPTS: 'true' },
      }),
    );
    const path = filename(manifest);
    const bytes = readFileSync(resolve(destination, path));
    validateTarball(bytes, manifest, packages);
    records.push({
      directory: item.directory,
      name: manifest.name,
      version: manifest.version,
      filename: path,
      sha256: sha256(bytes),
    });
  }
  const record = { schema: 1, ...info, packages: records };
  const manifestBytes = JSON.stringify(record, null, 2) + '\n';
  writeFileSync(resolve(destination, 'release-manifest.json'), manifestBytes);
  writeFileSync(resolve(destination, 'SHA256SUMS'), checksumText(record, manifestBytes));
  console.log(`Validated ${records.length} tarballs in ${destination}`);
  return record;
}

function verifiedAssets(packages, info, destination) {
  const manifestBytes = readFileSync(resolve(destination, 'release-manifest.json'));
  const record = JSON.parse(manifestBytes);
  const expected = {
    schema: 1,
    ...info,
    packages: publicationOrder(packages).map(({ directory, manifest }) => ({
      directory,
      name: manifest.name,
      version: manifest.version,
      filename: filename(manifest),
    })),
  };
  assert.deepEqual(
    {
      ...record,
      packages: record.packages.map(({ sha256: hash, ...item }) => {
        assert.match(hash, /^[a-f0-9]{64}$/);
        return item;
      }),
    },
    expected,
    'Release manifest mismatch',
  );
  const assets = [];
  for (const [index, item] of record.packages.entries()) {
    const path = resolve(destination, item.filename);
    const bytes = readFileSync(path);
    assert.equal(sha256(bytes), item.sha256, `SHA256 mismatch for ${item.name}`);
    validateTarball(bytes, publicationOrder(packages)[index].manifest, packages);
    assets.push(path);
  }
  assert.equal(
    readFileSync(resolve(destination, 'SHA256SUMS'), 'utf8'),
    checksumText(record, manifestBytes),
    'SHA256SUMS mismatch',
  );
  const paths = [
    ...assets,
    resolve(destination, 'release-manifest.json'),
    resolve(destination, 'SHA256SUMS'),
  ];
  return { paths, hashes: paths.map((path) => sha256(readFileSync(path))) };
}

export function isPublished(info, run = execute) {
  const result = run('npm', [
    'view',
    `${info.name}@${info.version}`,
    'version',
    '--json',
    `--registry=${registry}`,
  ]);
  if (result.error) throw result.error;
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new Error(result.stderr || 'Invalid npm registry JSON response');
  }
  if (result.status !== 0 && data?.error?.code === 'E404') return false;
  output(result);
  assert.equal(data, info.version, 'Unexpected npm registry version');
  return true;
}

function apiPages(repository, endpoint, run) {
  const pages = JSON.parse(
    output(run('gh', ['api', '--paginate', '--slurp', `repos/${repository}/${endpoint}`])),
  );
  assert.ok(
    Array.isArray(pages) && pages.every(Array.isArray),
    'Unexpected GitHub paginated JSON response',
  );
  return pages.flat();
}

export function completeRelease(info, repository, assets, run = execute) {
  assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/, 'GITHUB_REPOSITORY must be owner/repo');
  const releases = apiPages(repository, 'releases', run);
  assert.ok(
    releases.every((item) => Number.isSafeInteger(item.id) && typeof item.tag_name === 'string'),
    'Invalid GitHub release JSON',
  );
  let release = releases.find((item) => item.tag_name === info.tag);
  if (!release) {
    release = JSON.parse(
      output(
        run('gh', [
          'api',
          '--method',
          'POST',
          `repos/${repository}/releases`,
          '-f',
          `tag_name=${info.tag}`,
          '-f',
          `name=${info.tag}`,
          '-F',
          'draft=true',
          '-F',
          `prerelease=${info.prerelease}`,
          '-F',
          'generate_release_notes=true',
        ]),
      ),
    );
  }
  assert.ok(Number.isSafeInteger(release.id), 'Invalid GitHub release id');
  const existing = apiPages(repository, `releases/${release.id}/assets`, run);
  assert.ok(
    existing.every((item) => typeof item.name === 'string' && Number.isSafeInteger(item.size)),
    'Invalid GitHub asset JSON',
  );
  const missing = [];
  for (const path of assets) {
    const asset = existing.find((item) => item.name === basename(path));
    if (!asset) {
      missing.push(path);
      continue;
    }
    const bytes = readFileSync(path);
    assert.ok(
      asset.size === bytes.length,
      `Different existing asset ${asset.name}; refusing overwrite`,
    );
    assert.match(
      asset.digest ?? '',
      /^sha256:[a-f0-9]{64}$/,
      `Existing asset ${asset.name} has no usable digest; cannot verify bytes`,
    );
    assert.equal(
      asset.digest,
      `sha256:${sha256(bytes)}`,
      `Different existing asset ${asset.name}; refusing overwrite`,
    );
  }
  if (missing.length)
    output(run('gh', ['release', 'upload', info.tag, ...missing, '--repo', repository]));
  output(
    run('gh', [
      'release',
      'edit',
      info.tag,
      '--repo',
      repository,
      '--draft=false',
      `--prerelease=${info.prerelease}`,
    ]),
  );
}

export function publishAndRelease(packages, info, destination, repository, run = execute) {
  // Validate every archive and checksum before any registry request.
  const { paths: assets, hashes } = verifiedAssets(packages, info, destination);
  checkNpmVersion(run);
  const order = publicationOrder(packages);
  for (const [index, { manifest }] of order.entries()) {
    if (isPublished(manifest, run)) {
      console.log(`${manifest.name}@${manifest.version} already published; skipping`);
      continue;
    }
    // Recheck immediately before publication so the network call uses the exact
    // bytes validated above, including after other packages were published.
    assert.equal(
      sha256(readFileSync(assets[index])),
      hashes[index],
      `SHA256 changed before publishing ${manifest.name}`,
    );
    console.log(
      output(
        run('npm', [
          'publish',
          assets[index],
          '--access',
          'public',
          '--tag',
          info.distTag,
          '--ignore-scripts',
          `--registry=${registry}`,
        ]),
      ),
    );
  }
  for (const [index, path] of assets.entries())
    assert.equal(
      sha256(readFileSync(path)),
      hashes[index],
      `SHA256 changed before GitHub upload: ${basename(path)}`,
    );
  completeRelease(info, repository, assets, run);
}

function main() {
  const [command, tag, destination] = process.argv.slice(2);
  if (command === 'npm-version') {
    checkNpmVersion();
    return;
  }
  const packages = readPackages();
  const info = releaseInfo(tag, packages);
  if (command === 'check') {
    checkGit(tag);
    console.log(JSON.stringify(info));
  } else if (command === 'pack') {
    assert.ok(destination, 'pack requires a destination directory');
    packRelease(packages, info, destination);
  } else if (command === 'publish') {
    assert.ok(destination, 'publish requires the validated artifacts directory');
    assert.equal(
      process.env.GITHUB_ACTIONS,
      'true',
      'Real publishing requires GitHub Actions OIDC',
    );
    assert.equal(
      process.env.GITHUB_REPOSITORY,
      'yourtion/one-api',
      'Unexpected publishing repository',
    );
    assert.equal(process.env.GITHUB_REF_TYPE, 'tag', 'Publishing requires a tag event');
    assert.equal(
      process.env.GITHUB_REF_NAME,
      tag,
      'Publishing tag does not match the Actions event',
    );
    checkGit(tag);
    publishAndRelease(packages, info, resolve(destination), process.env.GITHUB_REPOSITORY);
  } else
    throw new Error(
      'Usage: npm-release.mjs check|pack|publish v<version> [artifact-directory], or npm-version',
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
