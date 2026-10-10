import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';

import {PINNED_SDK_VERSION, checkPlatformSdkLock} from './check-platform-sdk-lock.mjs';

// npm 공개 레지스트리의 @seorilabs/platform-sdk@0.6.0 dist.integrity 값이다.
const INTEGRITY = 'sha512-/sI+c3JPOWo6CRceFqvpmUGV8fTSOuyKFfezohPDT9Qk1HVlHl4q5IwC89wy+1cB3Relpex/GAwVNQ6D8uVLKw==';

function lockfile({version = '0.6.0', specifier = version, resolution = `{integrity: ${INTEGRITY}}`} = {}) {
  return [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '',
    '  .:',
    '    devDependencies:',
    "      typescript:",
    '        specifier: 6.0.3',
    '        version: 6.0.3',
    '',
    '  apps/mobile:',
    '    dependencies:',
    "      '@seorilabs/platform-sdk':",
    `        specifier: ${specifier}`,
    `        version: ${version}`,
    '',
    'packages:',
    '',
    `  '@seorilabs/platform-sdk@${version}':`,
    `    resolution: ${resolution}`,
    "    engines: {node: '>=20'}",
    '',
  ].join('\n');
}

function write(root, path, content) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), {recursive: true});
  writeFileSync(absolute, content);
}

function fixture({
  rootPackage = {name: 'fixture', packageManager: 'pnpm@11.14.0'},
  mobilePackage = {name: 'mobile', dependencies: {'@seorilabs/platform-sdk': '0.6.0'}},
  lock = lockfile(),
  extraFiles = {},
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'platform-sdk-lock-'));
  write(root, 'package.json', JSON.stringify(rootPackage, null, 2));
  write(root, 'apps/mobile/package.json', JSON.stringify(mobilePackage, null, 2));
  if (lock !== null) write(root, 'pnpm-lock.yaml', lock);
  for (const [path, content] of Object.entries(extraFiles)) write(root, path, content);
  test.after(() => rmSync(root, {recursive: true, force: true}));
  return root;
}

test('exact 선언과 같은 버전으로 해석된 pnpm lockfile은 통과한다', () => {
  const result = checkPlatformSdkLock(fixture());
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.resolved.map((entry) => [entry.directory, entry.version]), [['apps/mobile', '0.6.0']]);
});

test('floating spec 선언을 거부한다', () => {
  const result = checkPlatformSdkLock(fixture({
    mobilePackage: {name: 'mobile', dependencies: {'@seorilabs/platform-sdk': '^0.6.0'}},
  }));
  assert.equal(result.problems.length, 2);
  assert.match(result.problems[0], /exact 버전으로 선언/);
});

test('lock 해석 버전이 선언과 다르면 실패한다', () => {
  const result = checkPlatformSdkLock(fixture({lock: lockfile({version: '0.3.9'})}));
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /0\.6\.0으로 해석되지 않는다/);
});

test('lock에 importer 항목이 없으면 실패한다', () => {
  const result = checkPlatformSdkLock(fixture({
    lock: lockfile().replace('  apps/mobile:', '  apps/legacy:'),
  }));
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /importer "apps\/mobile" 항목이 없다/);
});

test('SDK 선언 package의 조상에 다른 lockfile이 있으면 실패한다', () => {
  const result = checkPlatformSdkLock(fixture({
    extraFiles: {'package-lock.json': '{"lockfileVersion": 3}'},
  }));
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /package-lock\.json: SDK를 선언한 package의 조상 디렉터리에/);
});

test('조상이 아닌 곳의 별도 pnpm lockfile도 판정에 영향을 주지 않는다', () => {
  // 이 저장소의 firebase/ 는 자기 workspace와 lockfile을 갖는다. apps/* 의 조상이
  // 아니므로 discovery 판정에 쓰이지 않는다.
  const result = checkPlatformSdkLock(fixture({
    extraFiles: {'firebase/pnpm-lock.yaml': "lockfileVersion: '9.0'\n"},
  }));
  assert.deepEqual(result.problems, []);
});

test('조상이 아닌 곳의 lockfile은 판정에 영향을 주지 않는다', () => {
  // Backoffice repository-discovery의 packageManagerFor는 후보 디렉터리에서 위로
  // 올라가며 첫 신호에서 멈추고 저장소 전체를 훑지 않는다. 검사기가 그보다 엄격하면
  // 무관한 디렉터리의 lockfile 때문에 멀쩡한 저장소가 막힌다.
  const result = checkPlatformSdkLock(fixture({
    extraFiles: {'firebase/functions/package-lock.json': '{"lockfileVersion": 3}'},
  }));
  assert.deepEqual(result.problems, []);
});

test('Gemfile.lock과 Podfile.lock은 package manager 신호로 보지 않는다', () => {
  const result = checkPlatformSdkLock(fixture({
    extraFiles: {'apps/mobile/Gemfile.lock': 'GEM\n', 'apps/mobile/ios/Podfile.lock': 'PODS:\n'},
  }));
  assert.deepEqual(result.problems, []);
});

test('사설 레지스트리 tarball로 되돌아가면 실패한다', () => {
  const result = checkPlatformSdkLock(fixture({
    lock: lockfile({
      resolution: `{integrity: ${INTEGRITY}, tarball: https://npm.pkg.github.com/download/@seorilabs/platform-sdk/0.6.0/0e2ef6f}`,
    }),
  }));
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /tarball이 npm 공개 레지스트리가 아니다/);
});

test('npm 공개 레지스트리 tarball은 허용한다', () => {
  const result = checkPlatformSdkLock(fixture({
    lock: lockfile({
      resolution: `{integrity: ${INTEGRITY}, tarball: https://registry.npmjs.org/@seorilabs/platform-sdk/-/platform-sdk-0.6.0.tgz}`,
    }),
  }));
  assert.deepEqual(result.problems, []);
});

test('packageManager가 pnpm exact가 아니면 실패한다', () => {
  const result = checkPlatformSdkLock(fixture({
    rootPackage: {name: 'fixture', packageManager: 'npm@11.0.0'},
  }));
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /packageManager는 "pnpm@<x\.y\.z>" exact/);
});

test('SDK 선언이 없으면 실패한다', () => {
  const result = checkPlatformSdkLock(fixture({mobilePackage: {name: 'mobile'}}));
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /선언한 workspace package\.json이 없다/);
});

test('고정 버전은 npm 공개 레지스트리의 0.6.0이다', () => {
  assert.equal(PINNED_SDK_VERSION, '0.6.0');
});

test('exact지만 고정 버전과 다른 버전을 거부한다', () => {
  const result = checkPlatformSdkLock(fixture({
    mobilePackage: {name: 'mobile', dependencies: {'@seorilabs/platform-sdk': '0.5.0'}},
    lock: lockfile({version: '0.5.0'}),
  }));
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /고정 버전 0\.6\.0을 써야 한다/);
});

test('이 저장소의 실제 선언과 lockfile이 고정 버전으로 해석된다', () => {
  const result = checkPlatformSdkLock(new URL('..', import.meta.url).pathname);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(
    result.resolved.map((entry) => `${entry.directory}@${entry.version}`).sort(),
    [`apps/ait@${PINNED_SDK_VERSION}`, `apps/mobile@${PINNED_SDK_VERSION}`],
  );
});
