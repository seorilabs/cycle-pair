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
  assert.match(buildWrapper, /release-version-lib\.mjs/);
  assert.match(buildWrapper, /GOOGLE_PLAY_VERSION_NAME/);
  assert.match(buildWrapper, /GOOGLE_PLAY_VERSION_CODE/);
  assert.match(buildWrapper, /--max-workers=\$\{gradleMaxWorkers\}/);
  assert.match(gradleProperties, /org\.gradle\.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m/);
  assert.doesNotMatch(buildWrapper, /runGradle\(':app:verifyReleasePrerequisites'\)/);
  assert.match(
    buildWrapper,
    /process\.exit\(runGradle\(':app:bundleRelease'\)\)/
  );

  const {stdout} = await execFileAsync(process.execPath, [
    'scripts/resolve-release-version.mjs',
    '--tag',
    'v0.1.0',
  ]);
  const resolvedVersion = JSON.parse(stdout);
  assert.equal(resolvedVersion.version_name, '0.1.0');
  assert.equal(resolvedVersion.android_version_code, '1000');

  const { stdout: currentStdout } = await execFileAsync(process.execPath, [
    'scripts/resolve-release-version.mjs',
    '--tag',
    `v${mobilePackage.version}`,
  ]);
  const currentVersion = JSON.parse(currentStdout);
  assert.equal(currentVersion.version_name, '1.0.4');
  assert.equal(currentVersion.android_version_code, '1000103');
  assert.equal(currentVersion.apple_build_number, '1000103');
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
  assert.match(buildWorkflow, /snapshot_candidate:/);
  assert.match(buildWorkflow, /validate-release-candidate\.mjs/);
  assert.match(
    buildWorkflow,
    /if \[ -z "\$tag" \]; then[\s\S]*?echo "tag=" >> "\$GITHUB_OUTPUT"[\s\S]*?exit 0/,
  );
  assert.match(buildWorkflow, /CALLER_REF_TYPE: \$\{\{ github\.ref_type \}\}/);
  assert.match(buildWorkflow, /CALLER_REF_NAME: \$\{\{ github\.ref_name \}\}/);
  assert.match(
    buildWorkflow,
    /CALLER_REF_TYPE" = "tag"[\s\S]*?-snapshot\\\.\(\[1-9\]\[0-9\]\*\)[\s\S]*?snapshot tag ref는 snapshot_candidate=true와 명시 release_tag가 필요합니다/,
  );
  assert.doesNotMatch(buildWorkflow, /git tag --list/);
  assert.match(
    buildWorkflow,
    /rn-build-ait\.yml@73972d2b34e92145e61e3409c91085c40da10c54/,
  );
  assert.match(buildWorkflow, /release_tag: \$\{\{ needs\.validate\.outputs\.tag \}\}/);
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
    /rn-deploy-google-play\.yml@c8db7834f6b72198a898f699b6f91e3a185fc7f5/,
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
  assert.match(workflow, /workflow_dispatch:[\s\S]*?snapshot_candidate:/);
  assert.match(workflow, /workflow_call:[\s\S]*?snapshot_candidate:/);
  assert.match(workflow, /validate-release-candidate\.mjs/);
  assert.match(workflow, /--snapshot-candidate "\$SNAPSHOT_CANDIDATE"/);
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
  assert.match(workflow, /push:\n\s+tags:\n\s+- "v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*?upload:/);
  assert.match(workflow, /workflow_call:[\s\S]*?upload:/);
  assert.match(
    workflow,
    /rn-deploy-google-play\.yml@c8db7834f6b72198a898f699b6f91e3a185fc7f5/,
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

test('Google Play uploader converges when the requested version is already internal', async () => {
  const uploader = await readFile(
    'scripts/upload-google-play-internal.py',
    'utf8'
  );
  assert.match(uploader, /def expected_upload_contract/);
  assert.match(uploader, /SEORI_EXPECTED_AAB_SHA256/);
  assert.match(uploader, /SEORI_EXPECTED_ANDROID_VERSION_CODE/);
  assert.match(uploader, /def sha256_file/);
  assert.doesNotMatch(uploader, /def expected_version_code/);
  assert.match(uploader, /find_release_by_version_code/);
  assert.match(uploader, /def release_convergence/);
  assert.match(uploader, /def verified_uploaded_version_code/);
  assert.match(
    uploader,
    /version_code = verified_uploaded_version_code\([\s\S]*?release = \{/,
  );
  assert.match(
    uploader,
    /except Exception:[\s\S]*?publisher\.edits\(\)[\s\S]*?\.delete\(/,
  );
  assert.match(uploader, /"alreadyPresent": True/);
  assert.match(uploader, /Existing Google Play release conflicts/);

  const {stdout} = await execFileAsync('python3', [
    '-c',
    [
      'import importlib.util',
      'import hashlib',
      'import os',
      'import pathlib',
      'import sys',
      'import tempfile',
      'sys.dont_write_bytecode=True',
      'spec=importlib.util.spec_from_file_location("uploader", "scripts/upload-google-play-internal.py")',
      'module=importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(module)',
      'handle,path=tempfile.mkstemp(suffix=".aab")',
      'os.close(handle)',
      'pathlib.Path(path).write_bytes(b"verified-aab")',
      'os.environ["SEORI_EXPECTED_AAB_SHA256"]=hashlib.sha256(b"verified-aab").hexdigest()',
      'os.environ["SEORI_EXPECTED_ANDROID_VERSION_CODE"]="1001000005"',
      'version_code=module.expected_upload_contract(pathlib.Path(path),"v1.0.5")',
      'uploaded_code=module.verified_uploaded_version_code({"versionCode":str(version_code)},version_code)',
      'result={"versionCode":version_code,"uploadedCode":uploaded_code,"missing":module.release_convergence(None,"v1.0.5","completed",version_code),"matching":module.release_convergence({"name":"v1.0.5","status":"completed"},"v1.0.5","completed",version_code)}',
      'exec(\'try:\\n module.release_convergence({"name":"other","status":"completed"},"v1.0.5","completed",version_code)\\nexcept RuntimeError:\\n result["drift"]="error"\')',
      'exec(\'try:\\n module.verified_uploaded_version_code({"versionCode":str(version_code+1)},version_code)\\nexcept RuntimeError:\\n result["uploadedDrift"]="error"\')',
      'exec(\'try:\\n module.expected_upload_contract(pathlib.Path(path),"v1.0.5-snapshot.1")\\nexcept RuntimeError:\\n result["prerelease"]="error"\')',
      'os.environ["SEORI_EXPECTED_AAB_SHA256"]="0"*64',
      'exec(\'try:\\n module.expected_upload_contract(pathlib.Path(path),"v1.0.5")\\nexcept RuntimeError:\\n result["digestDrift"]="error"\')',
      'pathlib.Path(path).unlink()',
      'print(module.json.dumps(result))',
    ].join(';'),
  ]);
  assert.deepEqual(JSON.parse(stdout), {
    versionCode: 1001000005,
    uploadedCode: 1001000005,
    missing: 'upload',
    matching: 'already_present',
    drift: 'error',
    uploadedDrift: 'error',
    prerelease: 'error',
    digestDrift: 'error',
  });
});
