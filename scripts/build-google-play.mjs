#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const androidDirectory = path.join(repositoryRoot, 'apps/mobile/android');

try {
  if (process.argv.slice(2).some(argument => argument !== '--')) {
    throw new Error('버전 인자는 받지 않습니다. 중앙 release authority 환경변수를 사용하세요.');
  }
  const versionName = process.env.SEORI_RELEASE_VERSION_NAME ?? '';
  const versionCode = process.env.SEORI_RELEASE_VERSION_CODE ?? '';
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(versionName)) {
    throw new Error(`SEORI_RELEASE_VERSION_NAME이 올바르지 않습니다: ${versionName || 'empty'}`);
  }
  if (!/^[1-9]\d*$/.test(versionCode)) {
    throw new Error(`SEORI_RELEASE_VERSION_CODE가 올바르지 않습니다: ${versionCode || 'empty'}`);
  }
  console.log(
    `Google Play AAB: versionName=${versionName}, versionCode=${versionCode}`,
  );

  const gradleCommand = path.join(
    androidDirectory,
    process.platform === 'win32' ? 'gradlew.bat' : 'gradlew',
  );
  const buildEnvironment = {
    ...process.env,
    GOOGLE_PLAY_VERSION_NAME: versionName,
    GOOGLE_PLAY_VERSION_CODE: versionCode,
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

  process.exit(runGradle(':app:bundleRelease'));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
