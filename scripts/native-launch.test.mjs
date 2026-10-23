import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';

test('native release has no AppsInToss install or deployment target', async () => {
  const root = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(root.devDependencies?.['@apps-in-toss/ait-format'], undefined);
  assert.equal(root.scripts['build:ait'], undefined);
  await assert.rejects(access('apps/ait/package.json'));
  const deploy = await readFile('.github/workflows/deploy-all.yml', 'utf8');
  assert.doesNotMatch(deploy, /apps_in_toss|deploy-apps-in-toss/);
});

test('shipping entry point never starts the excluded purchase SDK', async () => {
  const entry = await readFile('apps/mobile/index.js', 'utf8');
  assert.doesNotMatch(entry, /ReactNativeIapClient|purchaseClient|platform\/purchases/);
});

test('release bundles reject an emulator selection and resolve only the service runtime', async () => {
  const {default: selection} = await import('../apps/mobile/runtime-selection.cjs');
  assert.throws(() => selection.selectNativeRuntime({development: false, backend: 'emulator'}), /Release bundles/);
  assert.throws(() => selection.selectNativeRuntime({development: true, backend: 'unknown'}), /Unknown/);
  assert.match(selection.selectNativeRuntime({development: false}), /productionRuntime\.ts$/);
  assert.match(selection.selectNativeRuntime({development: true, backend: 'emulator'}), /emulatorRuntime\.ts$/);
});

test("the local network purpose is included only in generated Debug app metadata", async () => {
  const project = await readFile(
    "apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj",
    "utf8"
  );
  const configuration = (name) =>
    project.match(
      new RegExp(
        `13B07F9[45]1A680F5B00A75B9A /\\* ${name} \\*/ = \\{[\\s\\S]*?buildSettings = \\{([\\s\\S]*?)\\n\\t\\t\\t\\};`
      )
    )?.[1] ?? "";
  assert.match(configuration("Debug"), /GENERATE_INFOPLIST_FILE = YES;/);
  assert.match(
    configuration("Debug"),
    /INFOPLIST_KEY_NSLocalNetworkUsageDescription/
  );
  assert.doesNotMatch(
    configuration("Release"),
    /INFOPLIST_KEY_NSLocalNetworkUsageDescription|GENERATE_INFOPLIST_FILE/
  );
  const plist = await readFile("apps/mobile/ios/CyclePair/Info.plist", "utf8");
  assert.doesNotMatch(plist, /NSLocalNetworkUsageDescription/);
});


for (const name of ['Debug', 'Release']) {
  test(`first iOS launch targets iPhone in ${name}`, async () => {
    const project = await readFile('apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj', 'utf8');
    const identifier = name === 'Debug' ? '13B07F941A680F5B00A75B9A' : '13B07F951A680F5B00A75B9A';
    const settings = project.match(new RegExp(`${identifier} /\\* ${name} \\*/ = \\{[\\s\\S]*?buildSettings = \\{([\\s\\S]*?)\\n\\t\\t\\t\\};`))?.[1] ?? '';
    assert.match(settings, /TARGETED_DEVICE_FAMILY = "?1"?;/);
  });
}

test('iPhone-only listing has no active iPad screenshots or requirements', async () => {
  const listing = JSON.parse(await readFile('app-store/app-store.config.json', 'utf8'));
  assert.deepEqual(listing.assets.ipadScreenshots13, []);
  const assets = JSON.parse(await readFile('release/registration-assets.json', 'utf8'));
  assert.equal(assets.items.some(item => item.kind === 'ipad-13'), false);
  assert.equal(assets.rules.some(rule => rule.kind === 'ipad-13'), false);
  const plist = await readFile('apps/mobile/ios/CyclePair/Info.plist', 'utf8');
  assert.doesNotMatch(plist, /UISupportedInterfaceOrientations~ipad/);
});
