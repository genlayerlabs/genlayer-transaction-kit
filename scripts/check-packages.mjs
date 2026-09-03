#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packagePaths, readPackageSet, validatePackageSet } from './release-policy.mjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const packageSet = readPackageSet(root);
const version = packageSet[0].manifest.version;
validatePackageSet(packageSet, version);

for (const { path, manifest } of packageSet) {
  const workspace = path.slice(0, -'/package.json'.length);
  for (const field of ['main', 'module', 'types']) {
    const output = resolve(root, workspace, manifest[field]);
    if (!existsSync(output)) {
      throw new Error(`${manifest.name} ${field} is missing from ${output}`);
    }
  }

  const esm = await import(pathToFileURL(resolve(root, workspace, manifest.module)));
  const cjs = require(resolve(root, workspace, manifest.main));
  if (Object.keys(esm).length === 0 || Object.keys(cjs).length === 0) {
    throw new Error(`${manifest.name} does not expose runtime exports in both module formats`);
  }
  if (manifest.exports?.['./styles.css']) {
    const stylesheet = resolve(root, workspace, manifest.exports['./styles.css']);
    if (!existsSync(stylesheet)) {
      throw new Error(`${manifest.name} stylesheet is missing from ${stylesheet}`);
    }
  }

  const pack = JSON.parse(execFileSync(
    'npm',
    ['pack', '--dry-run', '--json', '--workspace', workspace],
    { cwd: root, encoding: 'utf8' },
  ));
  const files = pack[0]?.files?.map(({ path: file }) => file) ?? [];
  if (!files.some((file) => file.startsWith('dist/'))) {
    throw new Error(`${manifest.name} tarball contains no dist files`);
  }
  if (files.some((file) => file.startsWith('src/') || file.startsWith('test'))) {
    throw new Error(`${manifest.name} tarball leaks source or tests`);
  }

  const packedManifest = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  if (packedManifest.version !== version) {
    throw new Error(`${manifest.name} changed during package inspection`);
  }
}

console.log(`Validated ${packagePaths.length} package tarballs for ${version}`);
