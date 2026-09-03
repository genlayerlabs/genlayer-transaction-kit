#!/usr/bin/env node
import { resolve } from 'node:path';
import {
  parseReleaseVersion,
  readPackageSet,
  validatePackageSet,
} from './release-policy.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};

const root = resolve(import.meta.dirname, '..');
const packageSet = readPackageSet(root);
const version = valueAfter('--version') ?? packageSet[0].manifest.version;
const branch = valueAfter('--branch');
const tag = valueAfter('--tag');
const release = validatePackageSet(packageSet, version);

if (branch && branch !== release.branch) {
  throw new Error(
    `${release.tag} belongs to ${release.branch}, not ${branch}`,
  );
}
if (tag && tag !== release.tag) {
  throw new Error(`Expected tag ${release.tag}, received ${tag}`);
}

console.log(JSON.stringify(release));
