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

test('Google Play build stays API 36, versioned, signed, and pnpm-safe for Hermes', async () => {
  const [
    androidRoot,
    androidApp,
    mobilePackage,
    buildWrapper,
    platformGuestClient,
    settingsScreen,
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
  assert.equal(
    mobilePackage.scripts['build:android:play'],
    'node ../../scripts/build-google-play.mjs'
  );
  assert.match(buildWrapper, /resolve-release-version\.mjs/);
  assert.match(buildWrapper, /GOOGLE_PLAY_VERSION_NAME/);
  assert.match(buildWrapper, /GOOGLE_PLAY_VERSION_CODE/);
  assert.match(buildWrapper, /:app:verifyReleasePrerequisites/);
  assert.match(
    buildWrapper,
    /runGradle\(':app:verifyReleasePrerequisites'\)[\s\S]*runGradle\(':app:bundleRelease'\)/
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
  assert.equal(currentVersion.version_name, '1.0.1');
  assert.equal(currentVersion.android_version_code, '1000001');
  assert.equal(currentVersion.apple_build_number, '1000001');
  assert.match(
    platformGuestClient,
    new RegExp(`X-Seori-Sdk': 'cycle-pair/${mobilePackage.version}`)
  );
  assert.match(
    settingsScreen,
    new RegExp(`>${mobilePackage.version} · 의료 도구 아님<`)
  );
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
  assert.match(
    buildWorkflow,
    /rn-build-ait\.yml@73972d2b34e92145e61e3409c91085c40da10c54/,
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
    /rn-build-android\.yml@bf14204ee13dba657e31dcf1a71a64c0dc526ae3/,
  );
  assert.match(workflow, /release_tag: \$\{\{ inputs\.release_tag \}\}/);
  assert.match(workflow, /android_dir: apps\/mobile\/android/);
  assert.match(workflow, /signing_properties_file: keystore\.properties/);
  assert.match(workflow, /java_version: "21"/);
  assert.doesNotMatch(
    workflow,
    /rn-deploy-google-play|upload:|track:|release_status:|id-token:|environment:/,
  );
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

test('Google Play deployment workflow uploads only to the internal track', async () => {
  const workflow = await readFile(
    '.github/workflows/deploy-google-play.yml',
    'utf8'
  );

  assert.match(workflow, /^name: Deploy Google Play$/m);
  assert.match(workflow, /workflow_dispatch:[\s\S]*?upload:/);
  assert.match(workflow, /workflow_call:[\s\S]*?upload:/);
  assert.match(
    workflow,
    /rn-build-android\.yml@bf14204ee13dba657e31dcf1a71a64c0dc526ae3/
  );
  assert.match(workflow, /java_version: "21"/);
  assert.match(workflow, /signing_properties_file: keystore\.properties/);
  assert.match(workflow, /timeout_minutes: 50/);
  assert.match(workflow, /google-github-actions\/auth@v3/);
  assert.match(workflow, /actions\/download-artifact@v8/);
  assert.match(workflow, /actions\/setup-python@v7/);
  assert.match(workflow, /--track internal/);
  assert.match(workflow, /scripts\/upload-google-play-internal\.py/);
  assert.doesNotMatch(workflow, /--track production|to_track:\s*production/);
  assert.match(workflow, /production promotion: false/);
});

test('Google Play uploader converges when the requested version is already internal', async () => {
  const uploader = await readFile(
    'scripts/upload-google-play-internal.py',
    'utf8'
  );
  assert.match(uploader, /def expected_version_code/);
  assert.match(uploader, /find_release_by_version_code/);
  assert.match(uploader, /def release_convergence/);
  assert.match(uploader, /"alreadyPresent": True/);
  assert.match(uploader, /Existing Google Play release conflicts/);

  const {stdout} = await execFileAsync('python3', [
    '-c',
    [
      'import importlib.util',
      'import sys',
      'sys.dont_write_bytecode=True',
      'spec=importlib.util.spec_from_file_location("uploader", "scripts/upload-google-play-internal.py")',
      'module=importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(module)',
      'version_code=module.expected_version_code("v0.1.8")',
      'result={"versionCode":version_code,"missing":module.release_convergence(None,"v0.1.8","completed",version_code),"matching":module.release_convergence({"name":"v0.1.8","status":"completed"},"v0.1.8","completed",version_code)}',
      'exec(\'try:\\n module.release_convergence({"name":"other","status":"completed"},"v0.1.8","completed",version_code)\\nexcept RuntimeError:\\n result["drift"]="error"\')',
      'print(module.json.dumps(result))',
    ].join(';'),
  ]);
  assert.deepEqual(JSON.parse(stdout), {
    versionCode: 1008,
    missing: 'upload',
    matching: 'already_present',
    drift: 'error',
  });
});
