import assert from 'node:assert/strict';
import test from 'node:test';
import {
  genlayerJsPeerRange,
  parseReleaseVersion,
  requiredGenlayerJsVersion,
  validatePackageSet,
} from './release-policy.mjs';

const packageSet = (version = '0.1.0-rc.1', jsVersion = requiredGenlayerJsVersion) => [
  {
    path: 'packages/core/package.json',
    manifest: {
      name: '@genlayer/transaction-kit',
      version,
      files: ['dist/'],
      peerDependencies: { 'genlayer-js': genlayerJsPeerRange },
      devDependencies: { 'genlayer-js': jsVersion },
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    },
  },
  ...['react', 'vue'].map((adapter) => ({
    path: `packages/${adapter}/package.json`,
    manifest: {
      name: `@genlayer/transaction-kit-${adapter}`,
      version,
      files: ['dist'],
      peerDependencies: { '@genlayer/transaction-kit': version },
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    },
  })),
];

test('routes release candidates to the dev branch and rc channel', () => {
  assert.deepEqual(parseReleaseVersion('0.1.0-rc.1'), {
    version: '0.1.0-rc.1',
    prerelease: true,
    branch: 'v0.1-dev',
    distTag: 'rc',
    tag: 'v0.1.0-rc.1',
  });
});

test('routes final releases to the stable branch and latest channel', () => {
  assert.deepEqual(parseReleaseVersion('0.1.0'), {
    version: '0.1.0',
    prerelease: false,
    branch: 'v0.1',
    distTag: 'latest',
    tag: 'v0.1.0',
  });
});

test('rejects unsupported prerelease labels and release lines', () => {
  for (const version of ['0.1.0-beta.1', '0.1.0-rc.0', '0.2.0-rc.1', 'v0.1.0-rc.1']) {
    assert.throws(() => parseReleaseVersion(version), /Unsupported release version/);
  }
});

test('requires all packages to share the release version and public registry', () => {
  assert.equal(validatePackageSet(packageSet(), '0.1.0-rc.1').branch, 'v0.1-dev');

  const mismatched = packageSet();
  mismatched[1].manifest.version = '0.1.0-rc.2';
  assert.throws(
    () => validatePackageSet(mismatched, '0.1.0-rc.1'),
    /expected 0\.1\.0-rc\.1/,
  );

  const privatePackage = packageSet();
  privatePackage[2].manifest.private = true;
  assert.throws(() => validatePackageSet(privatePackage, '0.1.0-rc.1'), /marked private/);
});

test('takes genlayer-js as a peer and tests against the exact oldest release', () => {
  assert.equal(genlayerJsPeerRange, '>=2.1.0 <3');

  assert.throws(
    () => validatePackageSet(packageSet('0.1.0-rc.1', '^2.0.0'), '0.1.0-rc.1'),
    /must test against genlayer-js@2\.1\.0/,
  );
  assert.throws(
    () => validatePackageSet(packageSet('0.1.0-rc.1', 'github:genlayerlabs/genlayer-js#v2-dev'), '0.1.0-rc.1'),
    /must test against genlayer-js@2\.1\.0/,
  );

  const bundled = packageSet();
  bundled[0].manifest.dependencies = { 'genlayer-js': requiredGenlayerJsVersion };
  assert.throws(() => validatePackageSet(bundled, '0.1.0-rc.1'), /must not bundle genlayer-js/);

  const exactPeer = packageSet();
  exactPeer[0].manifest.peerDependencies['genlayer-js'] = requiredGenlayerJsVersion;
  assert.throws(
    () => validatePackageSet(exactPeer, '0.1.0-rc.1'),
    /must declare genlayer-js@">=2\.1\.0 <3" as a peer dependency/,
  );
});

test('requires adapters to pin the matching core package as a peer', () => {
  const missing = packageSet();
  delete missing[1].manifest.peerDependencies;
  assert.throws(
    () => validatePackageSet(missing, '0.1.0-rc.1'),
    /must pin @genlayer\/transaction-kit@0\.1\.0-rc\.1 as a peer dependency/,
  );

  const stale = packageSet();
  stale[2].manifest.peerDependencies['@genlayer/transaction-kit'] = '0.1.0';
  assert.throws(
    () => validatePackageSet(stale, '0.1.0-rc.1'),
    /must pin @genlayer\/transaction-kit@0\.1\.0-rc\.1 as a peer dependency/,
  );
});
