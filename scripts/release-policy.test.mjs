import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
      dependencies: { 'genlayer-js': jsVersion },
      publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
    },
  },
  ...['react', 'vue'].map((adapter) => ({
    path: `packages/${adapter}/package.json`,
    manifest: {
      name: `@genlayer/transaction-kit-${adapter}`,
      version,
      files: ['dist'],
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

test('requires the exact compatible genlayer-js release', () => {
  assert.throws(
    () => validatePackageSet(packageSet('0.1.0-rc.1', '^2.0.0'), '0.1.0-rc.1'),
    /must pin genlayer-js@2\.0\.0-rc\.1/,
  );
  assert.throws(
    () => validatePackageSet(packageSet('0.1.0-rc.1', 'github:genlayerlabs/genlayer-js#v2-dev'), '0.1.0-rc.1'),
    /must pin genlayer-js@2\.0\.0-rc\.1/,
  );
});
