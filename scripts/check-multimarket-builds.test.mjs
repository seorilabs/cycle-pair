import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

const OFFICIAL_KOREAN_NAME =
  '사이클 페어 : 내 기분, 주기, 컨디션을 알려요';

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function releaseArchitectures(buildEnvironment) {
  const match = buildEnvironment.match(
    /^REACT_NATIVE_ARCHITECTURES\s*=\s*([^#\r\n]+?)(?:\s+#.*)?$/m,
  );
  assert.ok(match, 'build.env에 React Native release ABI 목록이 필요합니다.');
  return normalizedArchitectures(match[1]);
}

function localArchitectures(gradleProperties) {
  const match = gradleProperties.match(
    /^reactNativeArchitectures\s*=\s*([^#\r\n]+?)(?:\s+#.*)?$/m,
  );
  assert.ok(match, '로컬 React Native ABI 기본값이 필요합니다.');
  return normalizedArchitectures(match[1]);
}

function normalizedArchitectures(value) {
  return value
    .split(',')
    .map(architecture => architecture.trim())
    .filter(Boolean);
}

test('release ABI parser tolerates shell whitespace and inline comments', () => {
  assert.deepEqual(
    releaseArchitectures(
      'REACT_NATIVE_ARCHITECTURES = armeabi-v7a, arm64-v8a # release only',
    ),
    ['armeabi-v7a', 'arm64-v8a'],
  );
});

test('Korean market title and AppsInToss short brand stay within each market contract', async () => {
  const [
    rootPackage,
    mobileApp,
    playConfig,
    appStoreConfig,
    aitConfig,
    graniteConfig,
    androidStrings,
    iosInfoPlist,
  ] = await Promise.all([
    json('package.json'),
    json('apps/mobile/app.json'),
    json('play-store/google-play.config.json'),
    json('app-store/app-store.config.json'),
    json('apps-in-toss/apps-in-toss.config.json'),
    readFile('apps/ait/granite.config.ts', 'utf8'),
    readFile('apps/mobile/android/app/src/main/res/values/strings.xml', 'utf8'),
    readFile('apps/mobile/ios/CyclePair/Info.plist', 'utf8'),
  ]);

  assert.ok([...OFFICIAL_KOREAN_NAME].length <= 30);
  assert.equal(playConfig.storeListing.appName['ko-KR'], OFFICIAL_KOREAN_NAME);
  assert.equal(
    appStoreConfig.storeListing.appName['ko-KR'],
    OFFICIAL_KOREAN_NAME
  );
  assert.equal(mobileApp.displayName, OFFICIAL_KOREAN_NAME);
  assert.equal(aitConfig.workingName['ko-KR'], '사이클 페어');
  assert.match(
    graniteConfig,
    /displayName:\s*'사이클 페어'/
  );
  assert.ok(
    androidStrings.includes(
      `<string name="app_name">${OFFICIAL_KOREAN_NAME}</string>`
    )
  );
  assert.ok(iosInfoPlist.includes(`<string>${OFFICIAL_KOREAN_NAME}</string>`));
  assert.equal(
    rootPackage.scripts['build:google-play'],
    'node scripts/build-google-play.mjs'
  );
  assert.equal(
    playConfig.release.aabPath,
    'apps/mobile/android/app/build/outputs/bundle/release/app-release.aab'
  );
  assert.equal(
    rootPackage.scripts['build:ait'],
    'pnpm --filter @cyclepair/ait build'
  );
});

test('iOS declares Korean localization for native date controls', async () => {
  const [iosInfoPlist, iosProject] = await Promise.all([
    readFile('apps/mobile/ios/CyclePair/Info.plist', 'utf8'),
    readFile('apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj', 'utf8'),
  ]);

  assert.match(
    iosInfoPlist,
    /<key>CFBundleDevelopmentRegion<\/key>\s*<string>ko<\/string>/,
  );
  assert.match(iosProject, /developmentRegion = ko;/);
  assert.match(iosProject, /knownRegions = \(\s*ko,\s*Base,\s*\);/);
});

test('Google Play build stays API 36, versioned, signed, and pnpm-safe for Hermes', async () => {
  const [
    androidRoot,
    androidApp,
    mobilePackage,
    buildWrapper,
    platformGuestClient,
    settingsScreen,
    gradleProperties,
  ] = await Promise.all([
    readFile('apps/mobile/android/build.gradle', 'utf8'),
    readFile('apps/mobile/android/app/build.gradle', 'utf8'),
    json('apps/mobile/package.json'),
    readFile('scripts/build-google-play.mjs', 'utf8'),
    readFile(
      'apps/mobile/src/platform/account/PlatformFirebaseGuestClient.ts',
      'utf8'
    ),
    readFile('apps/mobile/src/screens/SettingsScreen.tsx', 'utf8'),
    readFile('apps/mobile/android/gradle.properties', 'utf8'),
  ]);

  assert.match(androidRoot, /targetSdkVersion\s*=\s*36/);
  assert.match(androidApp, /hermes-compiler\/package\.json/);
  assert.match(androidApp, /hermesCommand\s*=/);
  assert.match(androidApp, /GOOGLE_PLAY_VERSION_NAME/);
  assert.match(androidApp, /GOOGLE_PLAY_VERSION_CODE/);
  assert.match(androidApp, /verifyReleasePrerequisites/);
  assert.match(androidApp, /firebaseConfigProblems\("release"\)/);
  assert.match(androidApp, /releaseSigningProblems\.each/);
  assert.match(androidApp, /task\.dependsOn\(verifyReleasePrerequisites\)/);
  assert.deepEqual(
    localArchitectures(gradleProperties),
    ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'],
  );
  assert.equal(
    mobilePackage.scripts['build:android:play'],
    'node ../../scripts/build-google-play.mjs'
  );
  assert.doesNotMatch(buildWrapper, /release-version-lib\.mjs|package\.json/);
  assert.match(buildWrapper, /SEORI_RELEASE_VERSION_NAME/);
  assert.match(buildWrapper, /SEORI_RELEASE_VERSION_CODE/);
  assert.match(buildWrapper, /GOOGLE_PLAY_VERSION_NAME/);
  assert.match(buildWrapper, /GOOGLE_PLAY_VERSION_CODE/);
  assert.match(buildWrapper, /--max-workers=\$\{gradleMaxWorkers\}/);
  assert.match(gradleProperties, /org\.gradle\.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m/);
  assert.doesNotMatch(buildWrapper, /runGradle\(':app:verifyReleasePrerequisites'\)/);
  assert.match(
    buildWrapper,
    /process\.exit\(runGradle\(':app:bundleRelease'\)\)/
  );

  assert.match(
    platformGuestClient,
    new RegExp(`X-Seori-Sdk': 'cycle-pair/${mobilePackage.version}`)
  );
  assert.match(
    settingsScreen,
    new RegExp(`>버전 ${mobilePackage.version}<`)
  );
  assert.match(settingsScreen, /사이클 페어는 의료기기가 아닙니다/);
  assert.match(settingsScreen, /질환을 진단·치료·치유·예방하기 위한 것이 아니며/);
  assert.match(settingsScreen, /피임 또는 임신/);
});

test('AppsInToss target uses supported SDK and a build-only candidate workflow', async () => {
  const [aitPackage, ciWorkflow, buildWorkflow] = await Promise.all([
    json('apps/ait/package.json'),
    readFile('.github/workflows/ci.yml', 'utf8'),
    readFile('.github/workflows/build-ait.yml', 'utf8'),
  ]);
  assert.match(aitPackage.dependencies['@apps-in-toss/framework'], /^2\./);
  assert.equal(aitPackage.dependencies['react-native'], '0.84.0');
  assert.ok(aitPackage.dependencies['@toss/tds-react-native']);
  assert.equal(aitPackage.scripts.build, 'ait build');
  assert.doesNotMatch(ciWorkflow, /\n  ait_build:/);
  assert.match(buildWorkflow, /^name: Build Mini-app Candidate$/m);
  assert.match(buildWorkflow, /workflow_dispatch:[\s\S]*?inputs:[\s\S]*?release_tag:/);
  assert.doesNotMatch(buildWorkflow, /snapshot_candidate|validate-release-candidate\.mjs/);
  assert.doesNotMatch(buildWorkflow, /git tag --list/);
  assert.match(
    buildWorkflow,
    /rn-build-ait\.yml@9afa357f9ba6c8d6a813c7cec7ad3d35c626bdd5/,
  );
  assert.match(buildWorkflow, /release_tag: \$\{\{ inputs\.release_tag \}\}/);
  assert.match(buildWorkflow, /build_command: "pnpm build:ait"/);
  assert.match(buildWorkflow, /artifact_path: "apps\/ait\/cycle-pair\.ait"/);
  assert.match(buildWorkflow, /runs_on: ubuntu-latest/);
  assert.doesNotMatch(buildWorkflow, /APPS_IN_TOSS_API_KEY|ait deploy|run deploy/i);
});

test('Android candidate workflow creates a signed AAB without Play upload', async () => {
  const workflow = await readFile('.github/workflows/build-android.yml', 'utf8');

  assert.match(workflow, /^name: Build Android Candidate$/m);
  assert.match(workflow, /workflow_dispatch:[\s\S]*?inputs:[\s\S]*?release_tag:/);
  assert.match(
    workflow,
    /rn-deploy-google-play\.yml@9afa357f9ba6c8d6a813c7cec7ad3d35c626bdd5/,
  );
  assert.match(workflow, /release_tag: \$\{\{ inputs\.release_tag \}\}/);
  assert.match(workflow, /upload: false/);
  assert.match(workflow, /track: internal/);
  assert.match(workflow, /package_name: com\.seorilabs\.cyclepair/);
  assert.match(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /secrets: inherit/);
  assert.doesNotMatch(
    workflow,
    /snapshot_candidate|validate-release-candidate|resolve-release-version|package\.json/,
  );
  assert.doesNotMatch(workflow, /upload: true/);
});

test('candidate workflow names are not classified as market deployment workflows', async () => {
  const workflows = await Promise.all([
    readFile('.github/workflows/build-ait.yml', 'utf8'),
    readFile('.github/workflows/build-android.yml', 'utf8'),
  ]);
  const marketWorkflowName = /^(?:name:\s*).*(?:AIT|AppsInToss|Toss|Google|Play|App Store|iOS)/im;

  for (const workflow of workflows) {
    assert.doesNotMatch(workflow, marketWorkflowName);
  }
});

test('AppsInToss deployment workflow performs an x64 private upload only', async () => {
  const workflow = await readFile(
    '.github/workflows/deploy-apps-in-toss.yml',
    'utf8'
  );

  assert.match(workflow, /^name: Deploy AppsInToss$/m);
  assert.match(workflow, /workflow_dispatch:[\s\S]*?release_tag:/);
  assert.match(workflow, /workflow_call:[\s\S]*?release_tag:/);
  assert.doesNotMatch(workflow, /snapshot_candidate|validate-release-candidate\.mjs/);
  assert.match(workflow, /resolve-release-version\.yml@9afa357f9ba6c8d6a813c7cec7ad3d35c626bdd5/);
  assert.match(workflow, /verify-release-artifact\.mjs/);
  assert.match(workflow, /RELEASE_BINDING_BASE64/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(workflow, /seorilabs-rpi-arm64/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /pnpm build:ait/);
  assert.match(workflow, /pnpm --dir apps\/ait run deploy/);
  assert.match(workflow, /APPS_IN_TOSS_API_KEY/);
  assert.match(workflow, /public release: false/);
});

test('Google Play deployment binds the exact stable tag to the central workflow', async () => {
  const workflow = await readFile(
    '.github/workflows/deploy-google-play.yml',
    'utf8',
  );

  assert.match(workflow, /^name: Deploy Google Play$/m);
  assert.match(workflow, /push:\n\s+tags:\n\s+- "v\*\.\*\.\*"/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*?upload:/);
  assert.match(workflow, /workflow_call:[\s\S]*?upload:/);
  assert.match(
    workflow,
    /rn-deploy-google-play\.yml@9afa357f9ba6c8d6a813c7cec7ad3d35c626bdd5/,
  );
  assert.match(
    workflow,
    /release_tag: \$\{\{ github\.ref_type == 'tag' && github\.ref_name \|\| inputs\.release_tag \}\}/,
  );
  assert.match(workflow, /track: internal/);
  assert.match(workflow, /upload: \$\{\{ inputs\.upload \|\| false \}\}/);
  assert.match(workflow, /default: false/);
  assert.match(workflow, /package_name: com\.seorilabs\.cyclepair/);
  assert.match(workflow, /GOOGLE_PLAY_UPLOAD_KEYSTORE_BASE64:/);
  assert.doesNotMatch(workflow, /secrets: inherit/);
  assert.doesNotMatch(
    workflow,
    /snapshot_candidate|validate-release-candidate|resolve-release-version|cloudbuild-android|gcloud builds submit|package\.json|upload_script|scripts\/upload-google-play-internal\.py/,
  );
  assert.doesNotMatch(workflow, /\bproduction\b/);
});
