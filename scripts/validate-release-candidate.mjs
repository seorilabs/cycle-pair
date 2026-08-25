#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import process from 'node:process';

import {
  assertReleasePackageVersions,
  assertReleaseTagMode,
  resolveReleaseVersion,
} from './release-version-lib.mjs';

function parseBoolean(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`snapshot_candidate는 true 또는 false여야 합니다: ${value}`);
}

function parseArgs(argv) {
  const parsed = {tag: '', snapshotCandidate: null};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--tag') {
      parsed.tag = argv[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('--tag=')) {
      parsed.tag = argument.slice('--tag='.length);
    } else if (argument === '--snapshot-candidate') {
      parsed.snapshotCandidate = parseBoolean(argv[index + 1] ?? '');
      index += 1;
    } else if (argument.startsWith('--snapshot-candidate=')) {
      parsed.snapshotCandidate = parseBoolean(
        argument.slice('--snapshot-candidate='.length),
      );
    } else {
      throw new Error(`지원하지 않는 인자입니다: ${argument}`);
    }
  }
  if (parsed.snapshotCandidate === null) {
    throw new Error('--snapshot-candidate true|false가 필요합니다.');
  }
  return parsed;
}

function packageVersion(path) {
  return JSON.parse(readFileSync(path, 'utf8')).version;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const resolvedVersion = resolveReleaseVersion(args.tag);
  assertReleaseTagMode(resolvedVersion, args.snapshotCandidate);
  assertReleasePackageVersions(resolvedVersion, {
    root: packageVersion('package.json'),
    mobile: packageVersion('apps/mobile/package.json'),
    ait: packageVersion('apps/ait/package.json'),
  });
  console.log(JSON.stringify(resolvedVersion, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
