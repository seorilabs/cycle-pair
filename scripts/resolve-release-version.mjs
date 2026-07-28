#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
import process from 'node:process';

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_SEGMENT_BASE = 1000;
const GOOGLE_PLAY_MAX_VERSION_CODE = 2_100_000_000;

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

function resolveVersion(tag) {
  const match = TAG_PATTERN.exec(tag);
  if (match === null) {
    throw new Error(`릴리스 태그는 vX.Y.Z 형식이어야 합니다: ${tag || 'empty'}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (minor >= VERSION_SEGMENT_BASE || patch >= VERSION_SEGMENT_BASE) {
    throw new Error('minor와 patch는 각각 999 이하여야 합니다.');
  }
  const versionCode =
    major * VERSION_SEGMENT_BASE * VERSION_SEGMENT_BASE +
    minor * VERSION_SEGMENT_BASE +
    patch;
  if (versionCode <= 0 || versionCode > GOOGLE_PLAY_MAX_VERSION_CODE) {
    throw new Error(`Google Play versionCode 범위를 벗어납니다: ${versionCode}`);
  }
  const versionName = `${major}.${minor}.${patch}`;
  return {
    version_name: versionName,
    android_version_code: String(versionCode),
    apple_marketing_version: versionName,
    apple_build_number: String(versionCode),
    release_name: tag,
  };
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
  const values = resolveVersion(args.tag);
  if (args.githubOutput) {
    writeGithubOutput(values);
  }
  console.log(JSON.stringify(values, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
