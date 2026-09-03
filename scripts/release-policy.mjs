import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const packagePaths = [
  'packages/core/package.json',
  'packages/react/package.json',
  'packages/vue/package.json',
];

export const packageNames = [
  '@genlayer/transaction-kit',
  '@genlayer/transaction-kit-react',
  '@genlayer/transaction-kit-vue',
];

export const requiredGenlayerJsVersion = '2.0.0-rc.1';

export function parseReleaseVersion(version) {
  const match = /^(0)\.(1)\.(\d+)(?:-rc\.([1-9]\d*))?$/.exec(version);
  if (!match) {
    throw new Error(
      `Unsupported release version ${version}; expected 0.1.x or 0.1.x-rc.N`,
    );
  }

  return {
    version,
    prerelease: match[4] !== undefined,
    branch: match[4] === undefined ? 'v0.1' : 'v0.1-dev',
    distTag: match[4] === undefined ? 'latest' : 'rc',
    tag: `v${version}`,
  };
}

export function readPackageSet(root) {
  return packagePaths.map((path) => ({
    path,
    manifest: JSON.parse(readFileSync(resolve(root, path), 'utf8')),
  }));
}

export function validatePackageSet(packageSet, requestedVersion) {
  const release = parseReleaseVersion(requestedVersion);

  if (packageSet.length !== packageNames.length) {
    throw new Error(`Expected ${packageNames.length} public packages`);
  }

  packageSet.forEach(({ path, manifest }, index) => {
    if (manifest.name !== packageNames[index]) {
      throw new Error(`${path} has unexpected package name ${manifest.name}`);
    }
    if (manifest.version !== requestedVersion) {
      throw new Error(
        `${manifest.name} is ${manifest.version}; expected ${requestedVersion}`,
      );
    }
    if (manifest.private === true) {
      throw new Error(`${manifest.name} is marked private`);
    }
    if (manifest.publishConfig?.access !== 'public') {
      throw new Error(`${manifest.name} must publish with public access`);
    }
    if (manifest.publishConfig?.registry !== 'https://registry.npmjs.org/') {
      throw new Error(`${manifest.name} must publish to the public npm registry`);
    }
    if (!Array.isArray(manifest.files) || !manifest.files.includes(index === 0 ? 'dist/' : 'dist')) {
      throw new Error(`${manifest.name} must publish only its built dist directory`);
    }
  });

  const core = packageSet[0].manifest;
  if (core.dependencies?.['genlayer-js'] !== requiredGenlayerJsVersion) {
    throw new Error(
      `@genlayer/transaction-kit must pin genlayer-js@${requiredGenlayerJsVersion}`,
    );
  }

  for (const { manifest } of packageSet.slice(1)) {
    if (manifest.peerDependencies?.['@genlayer/transaction-kit'] !== requestedVersion) {
      throw new Error(
        `${manifest.name} must pin @genlayer/transaction-kit@${requestedVersion} as a peer dependency`,
      );
    }
  }

  return release;
}
