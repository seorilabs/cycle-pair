#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const androidDirectory = path.join(repositoryRoot, 'apps/mobile/android');

function readJson(relativePath) {
  return JSON.parse(
    readFileSync(path.join(repositoryRoot, relativePath), 'utf8'),
  );
}

function readRequestedTag(arguments_) {
  let tag = process.env.RELEASE_TAG ?? null;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--') continue;
    if (argument === '--tag') {
      tag = arguments_[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument.startsWith('--tag=')) {
      tag = argument.slice('--tag='.length);
      continue;
    }
    throw new Error(`지원하지 않는 인자입니다: ${argument}`);
  }
  return tag;
}

try {
  const rootPackage = readJson('package.json');
  const mobilePackage = readJson('apps/mobile/package.json');
  if (rootPackage.version !== mobilePackage.version) {
    throw new Error(
      `root/mobile package version이 다릅니다: ${rootPackage.version} / ${mobilePackage.version}`,
    );
  }

  const expectedTag = `v${rootPackage.version}`;
  const requestedTag = readRequestedTag(process.argv.slice(2)) ?? expectedTag;
  if (requestedTag !== expectedTag) {
    throw new Error(
      `릴리스 태그와 package version이 다릅니다: ${requestedTag} / ${expectedTag}`,
    );
  }

  const resolvedVersion = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(scriptDirectory, 'resolve-release-version.mjs'),
        '--tag',
        requestedTag,
      ],
      { encoding: 'utf8' },
    ),
  );
  console.log(
    `Google Play AAB: versionName=${resolvedVersion.version_name}, versionCode=${resolvedVersion.android_version_code}`,
  );

  const gradleCommand = path.join(
    androidDirectory,
    process.platform === 'win32' ? 'gradlew.bat' : 'gradlew',
  );
  const buildEnvironment = {
    ...process.env,
    GOOGLE_PLAY_VERSION_NAME: resolvedVersion.version_name,
    GOOGLE_PLAY_VERSION_CODE: resolvedVersion.android_version_code,
  };
  const runGradle = task => {
    const gradleArguments = [];
    const gradleMaxWorkers = process.env.CYCLEPAIR_ANDROID_GRADLE_MAX_WORKERS;
    if (gradleMaxWorkers) {
      if (!/^[1-9][0-9]*$/.test(gradleMaxWorkers)) {
        throw new Error(
          `CYCLEPAIR_ANDROID_GRADLE_MAX_WORKERS가 올바르지 않습니다: ${gradleMaxWorkers}`,
        );
      }
      gradleArguments.push(`--max-workers=${gradleMaxWorkers}`);
    }
    gradleArguments.push(task);
    const result = spawnSync(gradleCommand, gradleArguments, {
      cwd: androidDirectory,
      stdio: 'inherit',
      env: buildEnvironment,
    });
    if (result.error) throw result.error;
    if (result.signal) {
      throw new Error(`Gradle build가 signal ${result.signal}로 종료됐습니다.`);
    }
    return result.status ?? 1;
  };

  const preflightStatus = runGradle(':app:verifyReleasePrerequisites');
  if (preflightStatus !== 0) process.exit(preflightStatus);
  process.exit(runGradle(':app:bundleRelease'));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
