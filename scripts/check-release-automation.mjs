#!/usr/bin/env node
import {readFileSync, readdirSync} from 'node:fs';

const files = {
  ci: '.github/workflows/ci.yml',
  all: '.github/workflows/deploy-all.yml',
  google: '.github/workflows/deploy-google-play.yml',
  androidCandidate: '.github/workflows/build-android.yml',
  ait: '.github/workflows/deploy-apps-in-toss.yml',
  aitCandidate: '.github/workflows/build-ait.yml',
  xcodePostClone: 'apps/mobile/ios/ci_scripts/ci_post_clone.sh',
  xcodePreBuild: 'apps/mobile/ios/ci_scripts/ci_pre_xcodebuild.sh',
  tag: '.github/workflows/release-tag.yml',
  cleanup: '.github/workflows/cleanup-actions-storage.yml',
  gradle: 'apps/mobile/android/app/build.gradle',
  xcodeProject: 'apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj',
  readiness: 'release/readiness.json',
  package: 'package.json',
};

// 조직 재사용 워크플로우는 정본을 seorilabs/.github@main 에서 받는다. caller 마다 SHA 를
// 박아 두던 구조는 seorilabs/.github#179 에서 걷어냈다. 중앙을 한 줄 고칠 때마다 저장소
// 25곳에 pin 승격 PR 이 따라붙었고, caller 가 서로 다른 SHA 로 갈라져 어느 저장소가 무슨
// 판본으로 도는지 알 수 없었다. 여기서는 caller 가 정본 ref 를 보고 있는지만 본다.
// 외부 저장소 스크립트를 실행하는 authority 체크아웃은 이 검사 대상이 아니고 SHA 고정을
// 유지한다.
const orgWorkflowNames = [
  'rn-build-ait.yml',
  'rn-deploy-google-play.yml',
  'release-tag.yml',
  'cleanup-actions-storage.yml',
  'resolve-release-version.yml',
];

function read(path) {
  return readFileSync(path, 'utf8');
}

function assertIncludes(text, expected, message) {
  if (!text.includes(expected)) {
    throw new Error(message);
  }
}

function assertNoPushTrigger(path, workflow) {
  if (/^\s*push:/mu.test(workflow)) {
    throw new Error(`${path}는 push 이벤트로 빌드·업로드하면 안 됩니다.`);
  }
}

function assertSafeConcurrency(path, workflow) {
  assertIncludes(
    workflow,
    'cancel-in-progress: false',
    `${path}의 배포 concurrency가 안전하지 않습니다.`,
  );
}

function assertOrgCanonicalRef(path, workflow, workflowFile) {
  if (!orgWorkflowNames.includes(workflowFile)) {
    throw new Error(`${workflowFile}은 조직 재사용 워크플로 목록에 없습니다.`);
  }
  const escapedFile = workflowFile.replace(/\./gu, '\\.');
  const pattern = new RegExp(
    `^\\s*uses:\\s*seorilabs/\\.github/\\.github/workflows/${escapedFile}@main\\s*$`,
    'mu',
  );
  if (!pattern.test(workflow)) {
    throw new Error(
      `${path}의 ${workflowFile} 호출이 중앙 정본 @main을 보고 있지 않습니다.`,
    );
  }
}

try {
  // Google Play: exact stable GitHub tag가 유일한 version authority이고 업로드는 opt-in이다.
  const google = read(files.google);
  const androidCandidate = read(files.androidCandidate);
  assertSafeConcurrency(files.google, google);
  assertOrgCanonicalRef(files.google, google, 'rn-deploy-google-play.yml');
  assertOrgCanonicalRef(files.androidCandidate, androidCandidate, 'rn-deploy-google-play.yml');
  assertIncludes(
    google,
    'tags:\n      - "v*.*.*"',
    'GitHub stable tag push의 build-only 진입점이 없습니다.',
  );
  assertIncludes(
    google,
    "release_tag: ${{ github.ref_type == 'tag' && github.ref_name || inputs.release_tag }}",
    'tag push가 exact event tag를 중앙 workflow에 넘기지 않습니다.',
  );
  assertIncludes(
    google,
    'track: internal',
    'Google Play 자동화는 internal track으로 제한해야 합니다.',
  );
  assertIncludes(
    google,
    'upload: ${{ inputs.upload || false }}',
    'Google Play 업로드가 명시적 opt-in이 아닙니다.',
  );
  assertIncludes(google, 'default: false', 'Google Play upload 기본값은 false여야 합니다.');
  assertIncludes(
    google,
    'package_name: com.seorilabs.cyclepair',
    '검증할 Google Play package identity가 고정되지 않았습니다.',
  );
  for (const legacyAuthority of [
    'snapshot_candidate',
    'validate-release-candidate.mjs',
    'resolve-release-version.mjs',
    'cloudbuild-android.yaml',
    'gcloud builds submit',
    'package.json',
    'upload_script',
    'scripts/upload-google-play-internal.py',
  ]) {
    if (google.includes(legacyAuthority) || androidCandidate.includes(legacyAuthority)) {
      throw new Error(`Google Play caller가 로컬 version authority를 참조합니다: ${legacyAuthority}`);
    }
  }
  if (/\bsecrets:\s*inherit\b/u.test(google) || /\bsecrets:\s*inherit\b/u.test(androidCandidate)) {
    throw new Error('Google Play caller는 named secret mapping만 사용해야 합니다.');
  }
  if (/\bproduction\b/u.test(google)) {
    throw new Error('Google Play 자동화가 production track을 직접 건드리면 안 됩니다.');
  }
  assertIncludes(
    androidCandidate,
    'upload: false',
    'Android candidate가 market upload를 실행하면 안 됩니다.',
  );
  assertIncludes(
    androidCandidate,
    'package_name: com.seorilabs.cyclepair',
    'Android candidate가 Google Play package identity를 중앙 검증에 넘기지 않습니다.',
  );

  // App Store 트리거는 Backoffice 가 ASC ciBuildRuns 로 직접 한다. 이 저장소에는
  // App Store 워크플로를 두지 않는다. macOS archive 로 되돌아가지 않는지는 워크플로
  // 전체를 훑어 본다.
  for (const name of readdirSync('.github/workflows')) {
    if (!name.endsWith('.yml')) continue;
    const text = read(`.github/workflows/${name}`);
    if (/runs-on:\s*macos-/u.test(text) || text.includes('xcodebuild')) {
      throw new Error(`${name}: macOS archive 를 실행하면 안 됩니다.`);
    }
  }

  // AppsInToss: 비공개 업로드까지만 자동화한다.
  const ait = read(files.ait);
  assertNoPushTrigger(files.ait, ait);
  assertSafeConcurrency(files.ait, ait);
  assertIncludes(
    ait,
    'runs-on: ubuntu-latest',
    'AppsInToss Hermes 컴파일러는 x86-64라 ARM64 ARC runner를 쓰면 안 됩니다.',
  );
  assertIncludes(
    ait,
    'APPS_IN_TOSS_API_KEY',
    'AppsInToss 업로드 자격증명 검증이 없습니다.',
  );
  assertIncludes(
    ait,
    'public release: false',
    'AppsInToss 자동화는 비공개 업로드로 제한해야 합니다.',
  );
  assertOrgCanonicalRef(files.ait, ait, 'resolve-release-version.yml');
  assertIncludes(ait, 'verify-release-artifact.mjs', 'AppsInToss artifact provenance 검증이 없습니다.');
  if (/snapshot_candidate|validate-release-candidate\.mjs/u.test(ait)) {
    throw new Error('AppsInToss release 경로에 legacy snapshot authority가 남아 있습니다.');
  }

  const aitCandidate = read(files.aitCandidate);
  assertOrgCanonicalRef(files.aitCandidate, aitCandidate, 'rn-build-ait.yml');
  if (aitCandidate.includes('git tag --list')) {
    throw new Error('AIT candidate의 빈 release_tag를 최신 stable 태그로 바꾸면 안 됩니다.');
  }

  const postClone = read(files.xcodePostClone);
  assertIncludes(
    postClone,
    'restore-mobile-firebase-config.mjs" --ios --require',
    'Xcode Cloud가 운영 Firebase plist를 필수 secret에서 복원하지 않습니다.',
  );
  assertIncludes(
    postClone,
    'pnpm install --frozen-lockfile',
    'Xcode Cloud workspace 의존성 설치가 고정되지 않았습니다.',
  );
  assertIncludes(
    postClone,
    'exec pod install',
    'Xcode Cloud CocoaPods 설치가 없습니다.',
  );

  const preBuild = read(files.xcodePreBuild);
  assertIncludes(preBuild, 'CI_TAG', 'Xcode Cloud tag version 주입이 없습니다.');
  assertIncludes(preBuild, 'AUTHORITY_SHA="6db01149a7700c0557bbeaf2e045aac7df0e78f2"', 'Xcode Cloud 중앙 authority pin이 없습니다.');
  assertIncludes(preBuild, 'xcode-cloud-apply-tag-version.mjs', 'Xcode Cloud 중앙 version applier가 없습니다.');
  // Apple build number 정본은 Xcode Cloud의 CI_BUILD_NUMBER다(중앙 계약 schemaVersion 2의
  // appleBuildNumberExceptions). 값 검증과 중앙 binding 대조가 둘 다 있어야 한다.
  assertIncludes(preBuild, 'CLOUD_BUILD_NUMBER="${CI_BUILD_NUMBER:-}"', 'Xcode Cloud build number 검증이 없습니다.');
  assertIncludes(preBuild, '[ "$build_number" = "$CLOUD_BUILD_NUMBER" ]', '중앙 binding과 Xcode Cloud build number 대조가 없습니다.');

  // Deploy All: 두 마켓 caller를 모두 노출하고 업로드는 opt-in 유지
  const deployAll = read(files.all);
  assertNoPushTrigger(files.all, deployAll);
  assertSafeConcurrency(files.all, deployAll);
  for (const caller of [
    './.github/workflows/deploy-google-play.yml',
    './.github/workflows/deploy-apps-in-toss.yml',
  ]) {
    assertIncludes(
      deployAll,
      `uses: ${caller}`,
      `Deploy All에 ${caller} caller가 없습니다.`,
    );
  }
  for (const uploadInput of [
    'google_play_upload',
    'apps_in_toss',
  ]) {
    assertIncludes(
      deployAll,
      `${uploadInput}:`,
      `Deploy All에 ${uploadInput} opt-in 입력이 없습니다.`,
    );
  }
  assertOrgCanonicalRef(files.all, deployAll, 'resolve-release-version.yml');

  const tag = read(files.tag);
  assertOrgCanonicalRef(files.tag, tag, 'release-tag.yml');
  assertIncludes(tag, 'default: true', 'Release Tag dry-run 기본값은 true여야 합니다.');

  const cleanup = read(files.cleanup);
  assertOrgCanonicalRef(files.cleanup, cleanup, 'cleanup-actions-storage.yml');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

try {
  const ci = read(files.ci);
  assertIncludes(ci, 'uses: actions/setup-node@v7', 'CI setup-node는 stable major v7이어야 합니다.');
  assertIncludes(
    ci,
    'pnpm check:release-automation',
    'CI에서 release automation contract를 검사하지 않습니다.',
  );
  assertIncludes(
    ci,
    'mobile_bundles:',
    'CI에서 프로덕션 JS 번들 검사가 독립 job으로 분리되지 않았습니다.',
  );
  assertIncludes(
    ci,
    'run bundle:ios --max-workers=1 &',
    'CI iOS Metro 번들이 제한된 worker로 병렬 실행되지 않습니다.',
  );
  assertIncludes(
    ci,
    'run bundle:android --max-workers=1 &',
    'CI Android Metro 번들이 제한된 worker로 병렬 실행되지 않습니다.',
  );
  assertIncludes(ci, 'wait "$ios_pid"', 'CI가 iOS Metro 번들 완료를 기다리지 않습니다.');
  assertIncludes(
    ci,
    'wait "$android_pid"',
    'CI가 Android Metro 번들 완료를 기다리지 않습니다.',
  );
  assertIncludes(
    ci,
    'MOBILE_BUNDLES_RESULT: ${{ needs.mobile_bundles.result }}',
    'required job이 프로덕션 JS 번들 검사 결과를 집계하지 않습니다.',
  );
  assertIncludes(
    ci,
    'uses: actions/setup-java@v5',
    '릴리스 서명 회귀 테스트에 필요한 keytool을 CI에서 준비하지 않습니다.',
  );

  const gradle = read(files.gradle);
  for (const expected of [
    'project.findProperty("versionNameOverride")',
    'project.findProperty("versionCodeOverride")',
    'verifyReleasePrerequisites',
  ]) {
    assertIncludes(gradle, expected, `Android release Gradle contract에 ${expected}가 없습니다.`);
  }

  const xcodeProject = read(files.xcodeProject);
  for (const expected of [
    'CODE_SIGN_STYLE = Automatic;',
    'DEVELOPMENT_TEAM = HCDUXX4Z3X;',
    'PRODUCT_BUNDLE_IDENTIFIER = com.seorilabs.cyclepair;',
  ]) {
    assertIncludes(xcodeProject, expected, `iOS Release signing contract에 ${expected}가 없습니다.`);
  }
  if (
    xcodeProject.includes('PROVISIONING_PROFILE_SPECIFIER = "Cycle Pair App Store') ||
    xcodeProject.includes('CODE_SIGN_STYLE = Manual;')
  ) {
    throw new Error('Xcode Cloud 대상은 manual signing profile을 고정하면 안 됩니다.');
  }

  const readiness = JSON.parse(read(files.readiness));
  for (const market of ['googlePlay', 'appStore', 'appsInToss']) {
    if (readiness?.targetMarkets?.[market]?.included !== true) {
      throw new Error(
        `${market} 배포 자동화가 있는데 release readiness의 target market 포함 결정과 다릅니다.`,
      );
    }
  }

  const packageJson = JSON.parse(read(files.package));
  if (packageJson?.scripts?.['check:release-automation'] !==
      'node scripts/check-release-automation.mjs') {
    throw new Error('check:release-automation 명령이 package.json과 일치하지 않습니다.');
  }

  console.log('Release automation contract: PASS');
  console.log('- Google Play: exact stable tag + 중앙 정본 @main workflow, internal upload opt-in');
  console.log('- App Store: Xcode Cloud archive/TestFlight, API trigger opt-in');
  console.log('- AppsInToss: ubuntu 빌드, 비공개 업로드 opt-in');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
