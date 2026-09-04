import assert from 'node:assert/strict';
import {accessSync, constants, readFileSync} from 'node:fs';
import test from 'node:test';

const read = file => readFileSync(file, 'utf8');

test('Xcode Cloud workflow contract is pinned to Cycle Pair release', () => {
  const config = JSON.parse(read('app-store/app-store.config.json'));
  assert.equal(config.appStoreConnectAppId, '6792393652');
  assert.equal(
    config.xcodeCloud.productId,
    'D071BF40-979E-4D7D-A7C5-2202072488D5',
  );
  assert.equal(
    config.xcodeCloud.workflowId,
    '6310D1DD-4A04-4E5C-8B17-B86D7A744D09',
  );
  assert.equal(config.xcodeCloud.workflowName, 'Cycle Pair Release');
  assert.equal(config.xcodeCloud.startCondition, 'manual v* tag');
  assert.equal(config.xcodeCloud.distribution, 'APP_STORE_ELIGIBLE');
});

test('GitHub dispatch uses ARC for API only and requires explicit upload opt-in', () => {
  const workflow = read('.github/workflows/deploy-app-store.yml');
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /node-version: 24\.16\.0/);
  assert.match(workflow, /seorilabs-rpi-arm64/);
  assert.match(workflow, /XCODE_CLOUD_WORKFLOW_NAME: Cycle Pair Release/);
  assert.match(workflow, /upload_to_testflight:\n[\s\S]*default: false/);
  assert.doesNotMatch(workflow, /runs-on:\s*macos/);
  assert.doesNotMatch(workflow, /\bxcodebuild\b/);
});

test('Xcode Cloud hooks install Pods, restore Firebase and apply cloud version', () => {
  const gemfile = read('apps/mobile/Gemfile');
  const postClone = read('apps/mobile/ios/ci_scripts/ci_post_clone.sh');
  const preBuild = read('apps/mobile/ios/ci_scripts/ci_pre_xcodebuild.sh');
  assert.match(gemfile, /gem 'json', '2\.7\.6'/);
  assert.match(postClone, /brew install ruby@3\.2/);
  assert.match(postClone, /BUNDLED WITH/);
  assert.match(postClone, /gem install bundler --version "\$\{BUNDLER_VERSION\}"/);
  assert.match(postClone, /RbConfig::CONFIG\.fetch\("host_cpu"\)/);
  assert.match(postClone, /\/usr\/bin\/arch "-\$\{RUBY_RUN_ARCH\}" "\$@"/);
  assert.match(
    postClone,
    /CONFIGURE_ARGS="--with-arch_flag='-arch \$\{RUBY_RUN_ARCH\}'"/,
  );
  assert.match(
    postClone,
    /vendor\/bundle\/\$\{RUBY_HOST_CPU\}-mkmf-arch/,
  );
  assert.match(
    postClone,
    /run_ruby_arch bundle "_\$\{BUNDLER_VERSION\}_" install/,
  );
  assert.match(postClone, /pnpm install --frozen-lockfile/);
  assert.match(postClone, /restore-mobile-firebase-config\.mjs" --ios --require/);
  assert.match(
    postClone,
    /run_ruby_arch bundle "_\$\{BUNDLER_VERSION\}_" exec pod install/,
  );
  assert.match(preBuild, /CI_TAG/);
  // 버전은 앱이 계산하지 않는다. agvtool은 계속 금지다.
  assert.doesNotMatch(preBuild, /agvtool/);
  // Apple build number 정본은 Xcode Cloud의 CI_BUILD_NUMBER다. 값을 검증하고, 중앙 binding이
  // 실제로 그 번호를 돌려줬는지 대조한 뒤에만 archive로 넘어간다.
  assert.match(preBuild, /CLOUD_BUILD_NUMBER="\$\{CI_BUILD_NUMBER:-\}"/);
  assert.match(preBuild, /''\|\*\[!0-9\]\*\|0\*\)/);
  assert.match(preBuild, /\[ "\$build_number" = "\$CLOUD_BUILD_NUMBER" \]/);
  assert.match(preBuild, /AUTHORITY_SHA="6db01149a7700c0557bbeaf2e045aac7df0e78f2"/);
  assert.match(preBuild, /xcode-cloud-apply-tag-version\.mjs/);
  assert.match(preBuild, /1da1dce81a5194a37f7a31475c29d899d95eb6da9ae1460927fe439aa329752c/);
  // 태그 파생 build number를 돌려주던 pin으로 되돌아가면 Xcode Cloud archive가 다시 막힌다.
  assert.doesNotMatch(preBuild, /9afa357f9ba6c8d6a813c7cec7ad3d35c626bdd5/);
  assert.doesNotMatch(preBuild, /b399afde0016e23947e173437e266aa83071079d1345b41ff580ebfe63357d6f/);
  // 심볼릭 링크 경로에서 조용히 exit 0 하던 중앙 pin으로도 되돌아가지 않는다.
  assert.doesNotMatch(preBuild, /7f8545342afd67f033569709da21590d87954411/);
  accessSync('apps/mobile/ios/ci_scripts/ci_post_clone.sh', constants.X_OK);
  accessSync('apps/mobile/ios/ci_scripts/ci_pre_xcodebuild.sh', constants.X_OK);
});

test('Release signing is automatic and Firebase config stays untracked', () => {
  const project = read('apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj');
  const ignore = read('.gitignore');
  assert.match(project, /CODE_SIGN_STYLE = Automatic;/);
  assert.match(project, /DEVELOPMENT_TEAM = HCDUXX4Z3X;/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = com\.seorilabs\.cyclepair;/);
  assert.match(ignore, /^GoogleService-Info\.plist$/m);
});
