const TAG_PATTERN =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-snapshot\.([1-9]\d*))?$/;

const VERSION_SEGMENT_BASE = 1000;
const GOOGLE_PLAY_MAX_VERSION_CODE = 2_100_000_000;
const SNAPSHOT_SEQUENCE_MAX = 99;
const FUTURE_RELEASE_BLOCK_SIZE = 100;
const LEGACY_STABLE_ANCHOR = Object.freeze({
  major: 1,
  minor: 0,
  patch: 3,
  versionCode: 1_000_003,
});

function legacyVersionCode(major, minor, patch) {
  if (minor >= VERSION_SEGMENT_BASE || patch >= VERSION_SEGMENT_BASE) {
    throw new Error('minor와 patch는 각각 999 이하여야 합니다.');
  }
  return (
    major * VERSION_SEGMENT_BASE * VERSION_SEGMENT_BASE +
    minor * VERSION_SEGMENT_BASE +
    patch
  );
}

const LEGACY_STABLE_ANCHOR_CODE = legacyVersionCode(
  LEGACY_STABLE_ANCHOR.major,
  LEGACY_STABLE_ANCHOR.minor,
  LEGACY_STABLE_ANCHOR.patch,
);

function assertVersionCode(versionCode) {
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode <= 0 ||
    versionCode > GOOGLE_PLAY_MAX_VERSION_CODE
  ) {
    throw new Error(`Google Play versionCode 범위를 벗어납니다: ${versionCode}`);
  }
}

export function resolveReleaseVersion(tag) {
  const match = TAG_PATTERN.exec(tag);
  if (match === null) {
    throw new Error(
      `릴리스 태그는 vX.Y.Z 또는 vX.Y.Z-snapshot.N 형식이어야 합니다: ${tag || 'empty'}`,
    );
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const snapshotSequence = match[4] === undefined ? null : Number(match[4]);
  const baseVersionCode = legacyVersionCode(major, minor, patch);
  const isSnapshot = snapshotSequence !== null;

  if (isSnapshot && snapshotSequence > SNAPSHOT_SEQUENCE_MAX) {
    throw new Error(
      `snapshot 순번은 1-${SNAPSHOT_SEQUENCE_MAX} 범위여야 합니다: ${snapshotSequence}`,
    );
  }
  if (isSnapshot && baseVersionCode <= LEGACY_STABLE_ANCHOR_CODE) {
    throw new Error(
      `v1.0.3 이하 legacy 버전에는 snapshot 후보를 만들 수 없습니다: ${tag}`,
    );
  }

  let versionCode;
  if (baseVersionCode <= LEGACY_STABLE_ANCHOR_CODE) {
    versionCode = baseVersionCode;
  } else if (isSnapshot) {
    versionCode =
      LEGACY_STABLE_ANCHOR.versionCode +
      (baseVersionCode - LEGACY_STABLE_ANCHOR_CODE - 1) *
        FUTURE_RELEASE_BLOCK_SIZE +
      snapshotSequence;
  } else {
    versionCode =
      LEGACY_STABLE_ANCHOR.versionCode +
      (baseVersionCode - LEGACY_STABLE_ANCHOR_CODE) *
        FUTURE_RELEASE_BLOCK_SIZE;
  }
  assertVersionCode(versionCode);

  const versionName = `${major}.${minor}.${patch}`;
  return {
    version_name: versionName,
    android_version_code: String(versionCode),
    apple_marketing_version: versionName,
    apple_build_number: String(versionCode),
    release_name: tag,
    release_tag: tag,
    snapshot_candidate: isSnapshot,
  };
}

export function assertReleaseTagMode(resolvedVersion, snapshotCandidate) {
  if (resolvedVersion.snapshot_candidate !== snapshotCandidate) {
    const expected = snapshotCandidate
      ? 'vX.Y.Z-snapshot.N 후보 태그'
      : 'stable SemVer vX.Y.Z 태그';
    throw new Error(
      `snapshot_candidate=${snapshotCandidate}에는 ${expected}만 허용됩니다: ${resolvedVersion.release_tag}`,
    );
  }
}

export function assertReleasePackageVersions(
  resolvedVersion,
  packageVersions,
) {
  const mismatches = Object.entries(packageVersions).filter(
    ([, version]) => version !== resolvedVersion.version_name,
  );
  if (mismatches.length === 0) return;

  throw new Error(
    `릴리스 base version과 package version이 다릅니다: tag=${resolvedVersion.release_tag} base=${resolvedVersion.version_name} ${mismatches
      .map(([name, version]) => `${name}=${version}`)
      .join(' ')}`,
  );
}
