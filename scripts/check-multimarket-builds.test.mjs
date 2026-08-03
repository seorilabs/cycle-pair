import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OFFICIAL_KOREAN_NAME =
  '사이클 페어 : 친구/연인과 함께 컨디션을 공유해요.';

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('Korean market title stays within Google Play limit and matches every display target', async () => {
  const [
    rootPackage,
    mobileApp,
    playConfig,
    appStoreConfig,
    aitConfig,
    graniteConfig,
    androidStrings,
    iosInfoPlist,
  ] =
    await Promise.all([
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
  assert.equal(appStoreConfig.storeListing.appName['ko-KR'], OFFICIAL_KOREAN_NAME);
  assert.equal(mobileApp.displayName, OFFICIAL_KOREAN_NAME);
  assert.equal(aitConfig.workingName['ko-KR'], OFFICIAL_KOREAN_NAME);
  assert.match(graniteConfig, new RegExp(OFFICIAL_KOREAN_NAME.replace('.', '\\.')));
  assert.ok(
    androidStrings.includes(
      `<string name="app_name">${OFFICIAL_KOREAN_NAME}</string>`,
    ),
  );
  assert.ok(iosInfoPlist.includes(`<string>${OFFICIAL_KOREAN_NAME}</string>`));
  assert.equal(rootPackage.scripts['build:google-play'],
    'node scripts/build-google-play.mjs');
  assert.equal(
    playConfig.release.aabPath,
    'apps/mobile/android/app/build/outputs/bundle/release/app-release.aab',
  );
  assert.equal(rootPackage.scripts['build:ait'],
    'pnpm --filter @cyclepair/ait build');
});

test('Google Play build stays API 36, versioned, signed, and pnpm-safe for Hermes', async () => {
  const [androidRoot, androidApp, mobilePackage, buildWrapper] = await Promise.all([
    readFile('apps/mobile/android/build.gradle', 'utf8'),
    readFile('apps/mobile/android/app/build.gradle', 'utf8'),
    json('apps/mobile/package.json'),
    readFile('scripts/build-google-play.mjs', 'utf8'),
  ]);

  assert.match(androidRoot, /targetSdkVersion\s*=\s*36/);
  assert.match(androidApp, /hermes-compiler\/package\.json/);
  assert.match(androidApp, /hermesCommand\s*=/);
  assert.match(androidApp, /GOOGLE_PLAY_VERSION_NAME/);
  assert.match(androidApp, /GOOGLE_PLAY_VERSION_CODE/);
  assert.match(androidApp, /verifyReleasePrerequisites/);
  assert.match(androidApp, /firebaseConfigProblems\("release", "production"\)/);
  assert.match(androidApp, /releaseSigningProblems\.each/);
  assert.match(androidApp, /task\.dependsOn\(verifyReleasePrerequisites\)/);
  assert.equal(
    mobilePackage.scripts['build:android:play'],
    'node ../../scripts/build-google-play.mjs',
  );
  assert.match(buildWrapper, /resolve-release-version\.mjs/);
  assert.match(buildWrapper, /GOOGLE_PLAY_VERSION_NAME/);
  assert.match(buildWrapper, /GOOGLE_PLAY_VERSION_CODE/);
  assert.match(buildWrapper, /:app:verifyReleasePrerequisites/);
  assert.match(
    buildWrapper,
    /runGradle\(':app:verifyReleasePrerequisites'\)[\s\S]*runGradle\(':app:bundleRelease'\)/,
  );

  const { stdout } = await execFileAsync(
    process.execPath,
    ['scripts/resolve-release-version.mjs', '--tag', 'v0.1.0'],
  );
  const resolvedVersion = JSON.parse(stdout);
  assert.equal(resolvedVersion.version_name, '0.1.0');
  assert.equal(resolvedVersion.android_version_code, '1000');
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
    /rn-deploy-google-play\.yml@73972d2b34e92145e61e3409c91085c40da10c54/,
  );
  assert.match(workflow, /release_tag: \$\{\{ inputs\.release_tag \}\}/);
  assert.match(workflow, /upload: false/);
  assert.match(workflow, /android_dir: apps\/mobile\/android/);
  assert.match(workflow, /java_version: "21"/);
  assert.doesNotMatch(workflow, /track:|release_status:/);
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
