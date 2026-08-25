import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertReleasePackageVersions,
  assertReleaseTagMode,
  resolveReleaseVersion,
} from './release-version-lib.mjs';

test('v1.0.3까지 stable 태그는 legacy versionCode를 보존한다', () => {
  assert.equal(resolveReleaseVersion('v0.1.8').android_version_code, '1008');
  assert.equal(
    resolveReleaseVersion('v1.0.3').android_version_code,
    '1000003',
  );
});

test('다음 패치 snapshot 99개와 stable에 100칸 단조 증가 블록을 배정한다', () => {
  const first = resolveReleaseVersion('v1.0.4-snapshot.1');
  const last = resolveReleaseVersion('v1.0.4-snapshot.99');
  const stable = resolveReleaseVersion('v1.0.4');

  assert.deepEqual(first, {
    version_name: '1.0.4',
    android_version_code: '1000004',
    apple_marketing_version: '1.0.4',
    apple_build_number: '1000004',
    release_name: 'v1.0.4-snapshot.1',
    release_tag: 'v1.0.4-snapshot.1',
    snapshot_candidate: true,
  });
  assert.equal(last.android_version_code, '1000102');
  assert.equal(stable.android_version_code, '1000103');
  assert.equal(stable.snapshot_candidate, false);
  assert.ok(
    Number(first.android_version_code) < Number(last.android_version_code),
  );
  assert.ok(
    Number(last.android_version_code) < Number(stable.android_version_code),
  );
});

test('후속 SemVer에도 블록 순서를 유지한다', () => {
  const stable104 = resolveReleaseVersion('v1.0.4');
  const snapshot105 = resolveReleaseVersion('v1.0.5-snapshot.1');
  const stable105 = resolveReleaseVersion('v1.0.5');
  const snapshot110 = resolveReleaseVersion('v1.1.0-snapshot.1');

  assert.equal(snapshot105.android_version_code, '1000104');
  assert.equal(stable105.android_version_code, '1000203');
  assert.ok(
    Number(stable104.android_version_code) <
      Number(snapshot105.android_version_code),
  );
  assert.ok(
    Number(stable105.android_version_code) <
      Number(snapshot110.android_version_code),
  );
});

test('legacy snapshot과 100 이상 순번, 다른 prerelease를 거부한다', () => {
  assert.throws(
    () => resolveReleaseVersion('v1.0.3-snapshot.1'),
    /legacy 버전에는 snapshot 후보를 만들 수 없습니다/,
  );
  assert.throws(
    () => resolveReleaseVersion('v1.0.4-snapshot.100'),
    /snapshot 순번은 1-99 범위/,
  );
  assert.throws(
    () => resolveReleaseVersion('v1.0.4-snapshot.0'),
    /vX\.Y\.Z 또는 vX\.Y\.Z-snapshot\.N/,
  );
  assert.throws(
    () => resolveReleaseVersion('v1.0.4-rc.1'),
    /vX\.Y\.Z 또는 vX\.Y\.Z-snapshot\.N/,
  );
});

test('workflow mode는 stable과 snapshot 후보를 서로 교차 허용하지 않는다', () => {
  assert.doesNotThrow(() =>
    assertReleaseTagMode(resolveReleaseVersion('v1.0.4'), false),
  );
  assert.doesNotThrow(() =>
    assertReleaseTagMode(resolveReleaseVersion('v1.0.4-snapshot.1'), true),
  );
  assert.throws(
    () => assertReleaseTagMode(resolveReleaseVersion('v1.0.4'), true),
    /snapshot_candidate=true/,
  );
  assert.throws(
    () =>
      assertReleaseTagMode(resolveReleaseVersion('v1.0.4-snapshot.1'), false),
    /snapshot_candidate=false/,
  );
});

test('package 일치는 snapshot suffix가 아닌 numeric base core와 비교한다', () => {
  const candidate = resolveReleaseVersion('v1.0.4-snapshot.1');
  assert.doesNotThrow(() =>
    assertReleasePackageVersions(candidate, {
      root: '1.0.4',
      mobile: '1.0.4',
      ait: '1.0.4',
    }),
  );
  assert.throws(
    () =>
      assertReleasePackageVersions(candidate, {
        root: '1.0.4',
        mobile: '1.0.3',
        ait: '1.0.4',
      }),
    /base=1\.0\.4 mobile=1\.0\.3/,
  );
});
