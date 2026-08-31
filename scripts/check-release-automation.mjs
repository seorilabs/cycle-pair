#!/usr/bin/env node
import {readFileSync} from 'node:fs';

const files = {
  ci: '.github/workflows/ci.yml',
  all: '.github/workflows/deploy-all.yml',
  google: '.github/workflows/deploy-google-play.yml',
  androidCandidate: '.github/workflows/build-android.yml',
  apple: '.github/workflows/deploy-app-store.yml',
  ait: '.github/workflows/deploy-apps-in-toss.yml',
  aitCandidate: '.github/workflows/build-ait.yml',
  xcodePostClone: 'apps/mobile/ios/ci_scripts/ci_post_clone.sh',
  xcodePreBuild: 'apps/mobile/ios/ci_scripts/ci_pre_xcodebuild.sh',
  xcodeTrigger: 'scripts/trigger-xcode-cloud-build.mjs',
  tag: '.github/workflows/release-tag.yml',
  cleanup: '.github/workflows/cleanup-actions-storage.yml',
  gradle: 'apps/mobile/android/app/build.gradle',
  xcodeProject: 'apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj',
  readiness: 'release/readiness.json',
  package: 'package.json',
};

// 조직 재사용 워크플로우는 workflow별로 개별 pin한다. 값은 저장소의 실제 pin과 일치해야 한다.
const orgWorkflowPins = {
  'rn-build-ait.yml': '73972d2b34e92145e61e3409c91085c40da10c54',
  'rn-deploy-google-play.yml': '8a11a145fed35479a4a89ebc7ca97edd0a0f05fd',
  'release-tag.yml': '8a11a145fed35479a4a89ebc7ca97edd0a0f05fd',
  'cleanup-actions-storage.yml': '143458719a525a0a5da34cded4c1d7b8445b9f8b',
};

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

function assertOrgPin(path, workflow, workflowFile) {
  const sha = orgWorkflowPins[workflowFile];
  assertIncludes(
    workflow,
    `seorilabs/.github/.github/workflows/${workflowFile}@${sha}`,
    `${path}의 ${workflowFile} SHA pin이 없거나 기대값과 다릅니다.`,
  );
}

try {
  // Google Play: exact stable GitHub tag가 유일한 version authority이고 업로드는 opt-in이다.
  const google = read(files.google);
  const androidCandidate = read(files.androidCandidate);
  assertSafeConcurrency(files.google, google);
  assertOrgPin(files.google, google, 'rn-deploy-google-play.yml');
  assertOrgPin(files.androidCandidate, androidCandidate, 'rn-deploy-google-play.yml');
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

  // App Store: GitHub runner는 dispatch만, archive는 Xcode Cloud
  const apple = read(files.apple);
  assertNoPushTrigger(files.apple, apple);
  assertSafeConcurrency(files.apple, apple);
  assertIncludes(
    apple,
    "'seorilabs-rpi-arm64'",
    'App Store dispatch는 private ARC에서 실행해야 합니다.',
  );
  if (/runs-on:\s*macos-/u.test(apple) || apple.includes('xcodebuild')) {
    throw new Error('App Store GitHub workflow에서 macOS archive를 실행하면 안 됩니다.');
  }
  assertIncludes(
    apple,
    'uses: actions/checkout@v7',
    'App Store checkout은 stable major v7이어야 합니다.',
  );
  assertIncludes(
    apple,
    'uses: actions/setup-node@v7',
    'App Store setup-node는 stable major v7이어야 합니다.',
  );
  assertIncludes(
    apple,
    'node scripts/trigger-xcode-cloud-build.mjs',
    'App Store workflow가 Xcode Cloud API trigger를 사용하지 않습니다.',
  );
  assertIncludes(
    apple,
    'upload_to_testflight:',
    'App Store Xcode Cloud 실행 입력이 없습니다.',
  );
  assertIncludes(apple, 'default: false', 'Xcode Cloud 실행 기본값은 false여야 합니다.');

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
  assertIncludes(
    ait,
    'snapshot_candidate:',
    'AppsInToss caller에 snapshot 후보 mode 입력이 없습니다.',
  );
  assertIncludes(
    ait,
    'validate-release-candidate.mjs',
    'AppsInToss caller가 stable/snapshot mode와 package base를 검증하지 않습니다.',
  );

  const aitCandidate = read(files.aitCandidate);
  assertIncludes(
    aitCandidate,
    'validate-release-candidate.mjs',
    'AIT candidate caller가 snapshot mode를 검증하지 않습니다.',
  );
  assertIncludes(
    aitCandidate,
    'echo "tag=" >> "$GITHUB_OUTPUT"',
    'AIT candidate caller가 빈 release_tag의 기존 호출 ref 동작을 보존하지 않습니다.',
  );
  assertIncludes(
    aitCandidate,
    'CALLER_REF_TYPE: ${{ github.ref_type }}',
    'AIT candidate caller가 빈 입력의 tag ref 유형을 검증하지 않습니다.',
  );
  assertIncludes(
    aitCandidate,
    'snapshot tag ref는 snapshot_candidate=true와 명시 release_tag가 필요합니다',
    'AIT candidate caller가 snapshot tag ref의 mode 우회를 차단하지 않습니다.',
  );
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
  assertIncludes(
    preBuild,
    'CI_BUILD_NUMBER',
    'Xcode Cloud 고유 build number를 사용하지 않습니다.',
  );

  const trigger = read(files.xcodeTrigger);
  assertIncludes(
    trigger,
    "'/v1/ciBuildRuns'",
    'App Store Connect ciBuildRuns API 호출이 없습니다.',
  );

  // Deploy All: 세 마켓 caller를 모두 노출하고 업로드는 opt-in 유지
  const deployAll = read(files.all);
  assertNoPushTrigger(files.all, deployAll);
  assertSafeConcurrency(files.all, deployAll);
  assertIncludes(
    deployAll,
    'uses: actions/checkout@v7',
    'Deploy All checkout은 global action major v7을 사용해야 합니다.',
  );
  for (const caller of [
    './.github/workflows/deploy-google-play.yml',
    './.github/workflows/deploy-app-store.yml',
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
    'app_store_upload',
    'apps_in_toss',
  ]) {
    assertIncludes(
      deployAll,
      `${uploadInput}:`,
      `Deploy All에 ${uploadInput} opt-in 입력이 없습니다.`,
    );
  }
  assertIncludes(
    deployAll,
    'snapshot_candidate: false',
    '정식 Deploy All caller가 stable mode를 명시하지 않습니다.',
  );

  const tag = read(files.tag);
  assertOrgPin(files.tag, tag, 'release-tag.yml');
  assertIncludes(tag, 'default: true', 'Release Tag dry-run 기본값은 true여야 합니다.');

  const cleanup = read(files.cleanup);
  assertOrgPin(files.cleanup, cleanup, 'cleanup-actions-storage.yml');
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
  console.log('- Google Play: exact stable tag + 중앙 pinned workflow, internal upload opt-in');
  console.log('- App Store: Xcode Cloud archive/TestFlight, API trigger opt-in');
  console.log('- AppsInToss: ubuntu 빌드, 비공개 업로드 opt-in');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
