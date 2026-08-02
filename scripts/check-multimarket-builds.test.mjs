import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const OFFICIAL_KOREAN_NAME =
  '사이클 페어 : 친구/연인과 함께 컨디션을 공유해요.';

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('Korean market title stays within Google Play limit and matches build targets', async () => {
  const [rootPackage, mobileApp, playConfig, aitConfig, graniteConfig] =
    await Promise.all([
      json('package.json'),
      json('apps/mobile/app.json'),
      json('play-store/google-play.config.json'),
      json('apps-in-toss/apps-in-toss.config.json'),
      readFile('apps/ait/granite.config.ts', 'utf8'),
    ]);

  assert.ok([...OFFICIAL_KOREAN_NAME].length <= 30);
  assert.equal(playConfig.storeListing.appName['ko-KR'], OFFICIAL_KOREAN_NAME);
  assert.equal(mobileApp.displayName, OFFICIAL_KOREAN_NAME);
  assert.equal(aitConfig.workingName['ko-KR'], OFFICIAL_KOREAN_NAME);
  assert.match(graniteConfig, new RegExp(OFFICIAL_KOREAN_NAME.replace('.', '\\.')));
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
  assert.equal(
    mobilePackage.scripts['build:android:play'],
    'node ../../scripts/build-google-play.mjs',
  );
  assert.match(buildWrapper, /resolve-release-version\.mjs/);
  assert.match(buildWrapper, /GOOGLE_PLAY_VERSION_NAME/);
  assert.match(buildWrapper, /GOOGLE_PLAY_VERSION_CODE/);
  assert.match(buildWrapper, /:app:verifyReleasePrerequisites/);
});

test('AppsInToss target uses supported SDK 2.x, RN 0.84, TDS, and ait build', async () => {
  const [aitPackage, workflow] = await Promise.all([
    json('apps/ait/package.json'),
    readFile('.github/workflows/ci.yml', 'utf8'),
  ]);
  assert.match(aitPackage.dependencies['@apps-in-toss/framework'], /^2\./);
  assert.equal(aitPackage.dependencies['react-native'], '0.84.0');
  assert.ok(aitPackage.dependencies['@toss/tds-react-native']);
  assert.equal(aitPackage.scripts.build, 'ait build');
  assert.match(workflow, /ait_build:\n[\s\S]*?runs-on: ubuntu-latest/);
  assert.match(workflow, /ait_build:\n[\s\S]*?run: pnpm build:ait/);
  assert.match(workflow, /needs:\n(?:\s+- [^\n]+\n)*\s+- ait_build/);
});
