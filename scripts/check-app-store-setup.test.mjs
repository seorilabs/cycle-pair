import assert from 'node:assert/strict';
import {accessSync, constants, readdirSync, readFileSync} from 'node:fs';
import test from 'node:test';

const read = file => readFileSync(file, 'utf8');

test('App Store Connect 앱 신원이 고정돼 있다', () => {
  const config = JSON.parse(read('app-store/app-store.config.json'));
  assert.equal(config.appStoreConnectAppId, '6792393652');
});

test('App Store archive 는 중앙 재사용 워크플로로 GitHub Actions 에서 돈다', () => {
  // 이 저장소는 public 이다. 조직 표준상 public 저장소의 Apple 경로는 GitHub
  // Actions 의 GitHub-hosted macOS runner 를 쓴다. Xcode Cloud 는 private
  // 저장소용이다(macOS runner 분당 배수 과금 회피).
  const workflow = read('.github/workflows/deploy-app-store.yml');
  assert.match(
    workflow,
    /uses:\s*seorilabs\/\.github\/\.github\/workflows\/rn-deploy-app-store\.yml@main/,
  );
  assert.match(workflow, /bundle_id:\s*com\.seorilabs\.cyclepair/);
  assert.match(workflow, /xcode_workspace:\s*CyclePair\.xcworkspace/);
  assert.match(workflow, /scheme:\s*CyclePair/);
  assert.match(workflow, /export_options_plist:\s*app-store\/exportOptions\.plist/);
  // 업로드는 opt-in 이다. dispatch 기본값이 false 여야 한다.
  assert.match(workflow, /upload:\n\s+description:[^\n]*\n\s+type: boolean\n\s+default: false/);
});

test('ARC self-hosted runner 로 Apple 경로를 보내지 않는다', () => {
  // public 저장소는 조직 러너 그룹(allows_public_repositories=false)에 접근할 수
  // 없다. 여기로 보내면 job 이 영구 대기한다.
  for (const name of readdirSync('.github/workflows')) {
    if (!name.endsWith('.yml')) continue;
    const workflow = read(`.github/workflows/${name}`);
    assert.doesNotMatch(workflow, /runs-on:\s*seorilabs-/, name);
  }
});

test('exportOptions 는 자동 서명이고 빌드 번호를 Xcode 가 임의로 올리지 않는다', () => {
  const plist = read('app-store/exportOptions.plist');
  assert.match(plist, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  assert.match(plist, /<key>teamID<\/key>\s*<string>HCDUXX4Z3X<\/string>/);
  assert.match(plist, /<key>signingStyle<\/key>\s*<string>automatic<\/string>/);
  // 버전 정본은 릴리즈 태그 하나다. true 면 업로드 값이 archive 검증값과 갈린다.
  assert.match(
    plist,
    /<key>manageAppVersionAndBuildNumber<\/key>\s*<false\/>/,
  );
});

test('iOS CI 훅이 Pods 설치와 Firebase 복원을 유지한다', () => {
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
