#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
import process from 'node:process';

import {resolveReleaseVersion} from './release-version-lib.mjs';

function parseArgs(argv) {
  const parsed = {tag: '', githubOutput: false};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--tag') {
      parsed.tag = argv[index + 1] ?? '';
      index += 1;
    } else if (argument.startsWith('--tag=')) {
      parsed.tag = argument.slice('--tag='.length);
    } else if (argument === '--github-output') {
      parsed.githubOutput = true;
    } else {
      throw new Error(`지원하지 않는 인자입니다: ${argument}`);
    }
  }
  return parsed;
}

function writeGithubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('--github-output 사용 시 GITHUB_OUTPUT이 필요합니다.');
  }
  appendFileSync(
    outputPath,
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
  );
}

try {
  const args = parseArgs(process.argv.slice(2));
  const values = resolveReleaseVersion(args.tag);
  if (args.githubOutput) {
    writeGithubOutput(values);
  }
  console.log(JSON.stringify(values, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
