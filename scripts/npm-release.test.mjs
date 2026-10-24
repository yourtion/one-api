import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  releaseInfo,
  publicationOrder,
  validateTarball,
  isPublished,
  checkGit,
  checkNpmVersion,
  publishAndRelease,
  completeRelease,
  packRelease,
  readPackages,
} from './npm-release.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
const temporary = () => {
  const directory = mkdtempSync(join(tmpdir(), 'npm-release-'));
  roots.push(directory);
  return directory;
};
const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
const error = (code) => ({ status: 1, stdout: JSON.stringify({ error: { code } }), stderr: code });
const version = '0.1.1';
const manifest = (name = '@1api/shared', extra = {}) => ({
  name,
  version,
  license: 'MIT',
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
  repository: {
    type: 'git',
    url: 'git+https://github.com/yourtion/one-api.git',
    directory: `${['web', 'server'].includes(name.split('/')[1]) ? 'apps' : 'packages'}/${name.split('/')[1]}`,
  },
  publishConfig: { access: 'public' },
  ...extra,
});
const pkg = (name, extra = {}) => ({
  directory: manifest(name, extra).repository.directory,
  manifest: manifest(name, extra),
});
const info = releaseInfo('v0.1.1', [pkg('@1api/shared')]);

// Real gzip/tar bytes: tests inspect the archive rather than a mocked file list.
function archive(files) {
  const chunks = [];
  for (const [path, entry] of Object.entries(files)) {
    const body = Buffer.from(typeof entry === 'string' ? entry : entry.body);
    const header = Buffer.alloc(512);
    header.write(path);
    header.write(
      (typeof entry === 'string' ? 0o644 : (entry.mode ?? 0o644)).toString(8).padStart(7, '0'),
      100,
    );
    header.write(body.length.toString(8).padStart(11, '0'), 124);
    header.fill(32, 148, 156);
    header.write(typeof entry === 'string' ? '0' : (entry.type ?? '0'), 156);
    header.write('ustar\0', 257);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    chunks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
function tarball(source, packed = source, extraFiles = {}) {
  return archive({
    'package/package.json': JSON.stringify(packed),
    'package/LICENSE': 'MIT',
    'package/CHANGELOG.md': '# Changelog',
    'package/dist/index.js': { body: '#!/usr/bin/env node\nexport {};\n', mode: 0o755 },
    'package/dist/index.d.ts': 'export {};',
    ...extraFiles,
  });
}

test('strict stable/prerelease SemVer and every public manifest match', () => {
  assert.equal(info.distTag, 'latest');
  for (const pre of ['0.1.1-rc.1', '0.1.1-0', '0.1.1-1alpha']) {
    assert.deepEqual(releaseInfo(`v${pre}`, [pkg('@1api/shared', { version: pre })]), {
      tag: `v${pre}`,
      version: pre,
      prerelease: true,
      distTag: 'next',
    });
  }
  for (const tag of [undefined, '0.1.1', 'v01.1.1', 'v0.1', 'v0.1.1-01', 'v0.1.1+build', 'v0.1.2'])
    assert.throws(() => releaseInfo(tag, [pkg('@1api/shared')]));
  assert.throws(
    () => releaseInfo(info.tag, [pkg('@1api/shared'), pkg('@1api/web', { version: '0.1.0' })]),
    /version/,
  );
  assert.throws(() => releaseInfo(info.tag, [pkg('@1api/shared', { private: true })]), /public/);
  assert.throws(() => releaseInfo(info.tag, [pkg('--bad')]), /public/);
  for (const badVersion of ['9007199254740992.0.0', `0.1.1-${'a'.repeat(251)}`])
    assert.throws(() =>
      releaseInfo(`v${badVersion}`, [pkg('@1api/shared', { version: badVersion })]),
    );
  for (const hook of [
    'prepare',
    'prepack',
    'postpack',
    'prepublishOnly',
    'prepublish',
    'publish',
    'postpublish',
  ])
    assert.throws(
      () => releaseInfo(info.tag, [pkg('@1api/shared', { scripts: { [hook]: 'echo hook' } })]),
      /lifecycle/,
    );
});

test('dependency and optional dependency topology rejects cycles, omitted packages and unsupported ranges', () => {
  const shared = pkg('@1api/shared');
  const web = pkg('@1api/web', { dependencies: { '@1api/shared': 'workspace:*' } });
  const serve = pkg('@1api/serve', { optionalDependencies: { '@1api/web': 'workspace:*' } });
  assert.deepEqual(
    publicationOrder([serve, web, shared]).map((p) => p.manifest.name),
    ['@1api/shared', '@1api/web', '@1api/serve'],
  );
  assert.throws(() => publicationOrder([serve, shared]), /omitted/);
  assert.throws(
    () =>
      publicationOrder([pkg('@1api/shared', { dependencies: { '@1api/shared': 'workspace:*' } })]),
    /cycle/,
  );
  for (const range of ['workspace:^9.0.0', '^9.0.0', 'workspace:../shared', 'file:../shared', '*'])
    assert.throws(
      () =>
        publicationOrder([pkg('@1api/web', { dependencies: { '@1api/shared': range } }), shared]),
      /range/,
    );
});

test('the authoritative release set contains only seven public packages and checks every version', () => {
  const packages = readPackages();
  assert.equal(packages.length, 7);
  assert.ok(
    packages.every((item) => !item.manifest.private && item.manifest.name !== '@1api/docs'),
  );
  for (let index = 0; index < packages.length; index++) {
    const changed = structuredClone(packages);
    changed[index].manifest.version = '0.0.0';
    assert.throws(() => releaseInfo(info.tag, changed), /version/);
    changed[index].manifest.version = version;
    changed[index].manifest.private = true;
    assert.throws(() => releaseInfo(info.tag, changed), /public/);
  }
});

test('tag must resolve to HEAD and belong to origin/main before installation', () => {
  const calls = [];
  checkGit(info.tag, '/repo', (cmd, args) => {
    calls.push([cmd, args]);
    return ok(args[0] === 'rev-parse' ? 'abc\n' : '');
  });
  assert.ok(calls[0][1].includes(`refs/tags/${info.tag}^{commit}`));
  assert.deepEqual(calls[2][1], ['merge-base', '--is-ancestor', 'abc', 'origin/main']);
  let count = 0;
  assert.throws(
    () => checkGit(info.tag, '/repo', () => ok(++count === 1 ? 'tag' : 'head')),
    /HEAD/,
  );
  assert.throws(
    () =>
      checkGit(info.tag, '/repo', (_, args) =>
        args[0] === 'merge-base' ? error('not-main') : ok('abc'),
      ),
    /not-main/,
  );
});

test('runtime npm must support OIDC; local packing does not require it', () => {
  for (const npm of ['11.5.1', '11.6.0', '12.0.0']) checkNpmVersion(() => ok(`${npm}\n`));
  for (const npm of ['11.4.2', '11.5.0', '10.9.0', 'garbage'])
    assert.throws(() => checkNpmVersion(() => ok(npm)), /11.5.1/);
});

test('validate archive entries, recursive exports, bin mode and transformed workspace dependencies', () => {
  const source = manifest('@1api/shared', {
    bin: { example: './dist/index.js' },
    dependencies: { '@1api/engine': 'workspace:*' },
    optionalDependencies: { '@1api/web': 'workspace:^' },
    devDependencies: { '@1api/sdk': 'workspace:~' },
    exports: {
      '.': { import: { default: './dist/index.js' } },
      './package.json': './package.json',
    },
  });
  const packed = {
    ...source,
    dependencies: { '@1api/engine': version },
    optionalDependencies: { '@1api/web': `^${version}` },
    devDependencies: { '@1api/sdk': `~${version}` },
  };
  const packages = [
    pkg('@1api/engine'),
    pkg('@1api/web'),
    pkg('@1api/sdk'),
    { directory: 'packages/shared', manifest: source },
  ];
  validateTarball(tarball(source, packed), source, packages);
  assert.throws(() => validateTarball(tarball(source), source, packages), /workspace|range/);
  assert.throws(
    () =>
      validateTarball(
        tarball(source, { ...packed, dependencies: { '@1api/engine': '^0.1.1' } }),
        source,
        packages,
      ),
    /range/,
  );
  for (const [field, missing] of [
    ['main', './missing.js'],
    ['types', './missing.d.ts'],
    ['exports', { './extra': './missing.css' }],
    ['bin', { example: './missing.js' }],
  ])
    assert.throws(
      () =>
        validateTarball(
          tarball(manifest('@1api/shared', { [field]: missing })),
          manifest('@1api/shared', { [field]: missing }),
          [],
        ),
      /missing/,
    );
  assert.throws(
    () =>
      validateTarball(
        tarball(source, packed, {
          'package/dist/index.js': { body: '#!/usr/bin/env node\n', mode: 0o644 },
        }),
        source,
        packages,
      ),
    /executable/,
  );
  assert.throws(
    () =>
      validateTarball(
        tarball(source, packed, { 'package/dist/index.js': { body: 'export {};', mode: 0o755 } }),
        source,
        packages,
      ),
    /shebang/,
  );
  assert.throws(
    () => validateTarball(tarball(manifest('@1api/web')), manifest('@1api/web'), []),
    /index.html/,
  );
  assert.throws(
    () => validateTarball(tarball(source, { ...packed, version: '9.0.0' }), source, packages),
    /version/,
  );
  assert.throws(
    () => validateTarball(tarball(source, { ...packed, private: true }), source, packages),
    /public/,
  );
  for (const file of ['LICENSE', 'CHANGELOG.md']) {
    const files = {
      'package/package.json': JSON.stringify(manifest()),
      'package/dist/index.js': '',
      'package/dist/index.d.ts': '',
      'package/LICENSE': '',
      'package/CHANGELOG.md': '',
    };
    delete files[`package/${file}`];
    assert.throws(() => validateTarball(archive(files), manifest(), []), new RegExp(file));
  }
  for (const path of ['package/../../escape', '/absolute', 'other/file', 'package/foo\\bar'])
    assert.throws(
      () => validateTarball(tarball(manifest(), manifest(), { [path]: '' }), manifest(), []),
      /Unsafe/,
    );
  assert.throws(
    () =>
      validateTarball(
        tarball(manifest(), manifest(), { 'package/link': { body: '', type: '2' } }),
        manifest(),
        [],
      ),
    /type/,
  );
  assert.throws(
    () =>
      validateTarball(
        tarball(manifest('@1api/shared', { exports: './dist/*.js' })),
        manifest('@1api/shared', { exports: './dist/*.js' }),
        [],
      ),
    /wildcard/,
  );
});

test('only exact registry version or structured E404 determines published state', () => {
  assert.equal(
    isPublished({ name: '@1api/shared', version }, () => ok(JSON.stringify(version))),
    true,
  );
  assert.equal(
    isPublished({ name: '@1api/shared', version }, () => error('E404')),
    false,
  );
  for (const result of [
    error('E401'),
    error('E403'),
    error('E429'),
    error('ENOTFOUND'),
    error('ECONNRESET'),
    ok('invalid'),
    ok('"0.1.0"'),
    { status: 1, stdout: 'E404', stderr: 'E404' },
    { error: new Error('spawn failed') },
  ])
    assert.throws(() => isPublished({ name: '@1api/shared', version }, () => result));
});

// Uses actual local tarballs and checksum files while all subprocess/network calls are injected.
function artifacts(releaseVersion = version) {
  const directory = temporary();
  const packages = [
    pkg('@1api/shared', { version: releaseVersion }),
    pkg('@1api/engine', {
      version: releaseVersion,
      repository: { ...manifest().repository, directory: 'packages/engine' },
      dependencies: { '@1api/shared': 'workspace:*' },
    }),
  ];
  const release = releaseInfo(`v${releaseVersion}`, packages);
  const record = packRelease(
    packages,
    release,
    directory,
    (_, args, options) => {
      assert.equal(args[0], 'pack');
      assert.ok(args.includes('--pack-destination'));
      assert.equal(options.env.npm_config_ignore_scripts, 'true');
      const item = packages.find((p) => options.cwd.endsWith(p.directory));
      const packed = structuredClone(item.manifest);
      if (packed.dependencies) packed.dependencies['@1api/shared'] = releaseVersion;
      writeFileSync(
        join(directory, `${packed.name.slice(1).replace('/', '-')}-${releaseVersion}.tgz`),
        tarball(item.manifest, packed),
      );
      return ok('packed');
    },
    '/repo',
  );
  return { directory, packages, release, record };
}

function mockRegistry({
  failPackage,
  failGithub = false,
  existingRelease = false,
  assets = [],
} = {}) {
  const published = new Set();
  const calls = [];
  const runner = (command, args) => {
    calls.push([command, args]);
    if (command === 'npm' && args[0] === '--version') return ok('11.5.1');
    if (command === 'npm' && args[0] === 'view')
      return published.has(args[1]) ? ok(JSON.stringify(args[1].split('@').at(-1))) : error('E404');
    if (command === 'npm' && args[0] === 'publish') {
      const engine = args[1].includes('engine');
      if (failPackage === (engine ? '@1api/engine' : '@1api/shared')) {
        failPackage = undefined;
        return error('E403');
      }
      const match = args[1].match(/1api-(shared|engine)-(.+)\.tgz$/);
      published.add(`@1api/${match[1]}@${match[2]}`);
      return ok('published');
    }
    if (failGithub && command === 'gh') {
      failGithub = false;
      return error('github unavailable');
    }
    if (command === 'gh' && args.includes('--slurp')) {
      return ok(
        JSON.stringify(
          args.some((arg) => arg.endsWith('/assets'))
            ? [assets]
            : [existingRelease ? [{ id: 7, tag_name: 'v0.1.1' }] : []],
        ),
      );
    }
    if (command === 'gh' && args.includes('POST')) return ok('{"id":7}');
    return ok('done');
  };
  return { runner, calls, published };
}

test('pack saves hashes; publish uses exactly validated tgz and explicit stable/prerelease channel', () => {
  for (const releaseVersion of [version, '0.1.1-rc.1']) {
    const fixture = artifacts(releaseVersion);
    const mock = mockRegistry();
    publishAndRelease(
      fixture.packages,
      fixture.release,
      fixture.directory,
      'yourtion/one-api',
      mock.runner,
    );
    const publishes = mock.calls.filter(([cmd, args]) => cmd === 'npm' && args[0] === 'publish');
    assert.equal(publishes.length, 2);
    assert.ok(
      publishes.every(
        ([, args]) =>
          args.includes('--ignore-scripts') &&
          args.includes(fixture.release.distTag) &&
          args.includes('--registry=https://registry.npmjs.org/'),
      ),
    );
    const firstGh = mock.calls.findIndex(([cmd]) => cmd === 'gh');
    assert.ok(
      firstGh > mock.calls.findLastIndex(([cmd, args]) => cmd === 'npm' && args[0] === 'publish'),
    );
    const checksums = readFileSync(join(fixture.directory, 'SHA256SUMS'), 'utf8');
    assert.ok(checksums.includes('release-manifest.json'));
    const record = JSON.parse(
      readFileSync(join(fixture.directory, 'release-manifest.json'), 'utf8'),
    );
    assert.equal(
      record.packages[0].sha256,
      createHash('sha256')
        .update(readFileSync(join(fixture.directory, record.packages[0].filename)))
        .digest('hex'),
    );
  }
});

test('hash changes abort before npm network access', () => {
  const fixture = artifacts();
  writeFileSync(join(fixture.directory, fixture.record.packages[0].filename), 'tampered');
  const mock = mockRegistry();
  assert.throws(
    () =>
      publishAndRelease(
        fixture.packages,
        fixture.release,
        fixture.directory,
        'yourtion/one-api',
        mock.runner,
      ),
    /SHA256/,
  );
  assert.equal(mock.calls.length, 0);
});

test('mutating tarball and manifest during lookup cannot replace accepted bytes', () => {
  const fixture = artifacts();
  const mock = mockRegistry();
  assert.throws(
    () =>
      publishAndRelease(
        fixture.packages,
        fixture.release,
        fixture.directory,
        'yourtion/one-api',
        (cmd, args) => {
          if (cmd === 'npm' && args[0] === 'view') {
            const recordPath = join(fixture.directory, 'release-manifest.json');
            const record = JSON.parse(readFileSync(recordPath, 'utf8'));
            const replacement = Buffer.from('changed');
            writeFileSync(join(fixture.directory, record.packages[0].filename), replacement);
            record.packages[0].sha256 = createHash('sha256').update(replacement).digest('hex');
            writeFileSync(recordPath, JSON.stringify(record));
          }
          return mock.runner(cmd, args);
        },
      ),
    /SHA256/,
  );
  assert.ok(!mock.calls.some(([cmd, args]) => cmd === 'npm' && args[0] === 'publish'));
});

test('partial monorepo failure stops before GitHub; rerun skips successful packages', () => {
  const fixture = artifacts();
  const mock = mockRegistry({ failPackage: '@1api/engine' });
  assert.throws(
    () =>
      publishAndRelease(
        fixture.packages,
        fixture.release,
        fixture.directory,
        'yourtion/one-api',
        mock.runner,
      ),
    /E403/,
  );
  assert.equal(mock.published.size, 1);
  assert.ok(mock.calls.every(([command]) => command !== 'gh'));
  mock.calls.length = 0;
  publishAndRelease(
    fixture.packages,
    fixture.release,
    fixture.directory,
    'yourtion/one-api',
    mock.runner,
  );
  assert.equal(
    mock.calls.filter(([cmd, args]) => cmd === 'npm' && args[0] === 'publish').length,
    1,
  );
});

test('npm success then GitHub failure rerun skips all npm packages', () => {
  const fixture = artifacts();
  const mock = mockRegistry({ failGithub: true });
  assert.throws(
    () =>
      publishAndRelease(
        fixture.packages,
        fixture.release,
        fixture.directory,
        'yourtion/one-api',
        mock.runner,
      ),
    /github unavailable/,
  );
  assert.equal(mock.published.size, 2);
  mock.calls.length = 0;
  publishAndRelease(
    fixture.packages,
    fixture.release,
    fixture.directory,
    'yourtion/one-api',
    mock.runner,
  );
  assert.equal(
    mock.calls.filter(([cmd, args]) => cmd === 'npm' && args[0] === 'publish').length,
    0,
  );
});

test('GitHub creates draft, uploads missing assets, then publishes with correct prerelease flag', () => {
  for (const releaseVersion of [version, '0.1.1-rc.1']) {
    const fixture = artifacts(releaseVersion);
    const mock = mockRegistry();
    completeRelease(
      fixture.release,
      'yourtion/one-api',
      [join(fixture.directory, 'SHA256SUMS')],
      mock.runner,
    );
    assert.ok(mock.calls[0][1].includes('--paginate'));
    const create = mock.calls.find(([, args]) => args.includes('POST'));
    assert.ok(create[1].includes('draft=true'));
    assert.ok(create[1].includes(`prerelease=${fixture.release.prerelease}`));
    assert.equal(mock.calls.at(-1)[1][1], 'edit');
    assert.ok(mock.calls.at(-1)[1].includes('--draft=false'));
    assert.ok(mock.calls.at(-1)[1].includes(`--prerelease=${fixture.release.prerelease}`));
  }
});

test('existing GitHub release uploads missing assets only and does not silently overwrite', () => {
  const file = join(temporary(), 'one.tgz');
  const other = join(temporary(), 'two.tgz');
  writeFileSync(file, 'one');
  writeFileSync(other, 'two');
  const mock = mockRegistry({
    existingRelease: true,
    assets: [
      {
        name: 'one.tgz',
        size: 3,
        digest: `sha256:${createHash('sha256').update('one').digest('hex')}`,
      },
    ],
  });
  completeRelease(info, 'yourtion/one-api', [file, other], mock.runner);
  assert.ok(!mock.calls.some(([, args]) => args.includes('POST')));
  const upload = mock.calls.find(([, args]) => args[0] === 'release' && args[1] === 'upload');
  assert.ok(upload[1].includes(other));
  assert.ok(!upload[1].includes(file));
  assert.ok(!upload[1].includes('--clobber'));
  const mismatch = mockRegistry({ existingRelease: true, assets: [{ name: 'one.tgz', size: 4 }] });
  assert.throws(
    () => completeRelease(info, 'yourtion/one-api', [file], mismatch.runner),
    /existing asset/,
  );
  const missingDigest = mockRegistry({
    existingRelease: true,
    assets: [{ name: 'one.tgz', size: 3 }],
  });
  assert.throws(
    () => completeRelease(info, 'yourtion/one-api', [file], missingDigest.runner),
    /digest/,
  );
});

test('GitHub malformed/list/create/assets/upload/edit failures propagate and never finalize after failure', () => {
  for (const failAt of [0, 1, 2, 3, 4]) {
    const file = join(temporary(), 'one.tgz');
    writeFileSync(file, 'one');
    const base = mockRegistry();
    let count = 0;
    assert.throws(
      () =>
        completeRelease(info, 'yourtion/one-api', [file], (cmd, args) => {
          if (count++ === failAt) return error('API failed');
          return base.runner(cmd, args);
        }),
      /API failed/,
    );
    assert.equal(count, failAt + 1);
  }
  assert.throws(() => completeRelease(info, 'yourtion/one-api', [], () => ok('not JSON')), /JSON/);
  assert.throws(() => completeRelease(info, undefined, []), /GITHUB_REPOSITORY/);
});
