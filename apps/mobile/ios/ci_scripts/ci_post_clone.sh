#!/bin/sh

# Xcode Cloud가 저장소를 복제한 직후 React Native/CocoaPods/Firebase 의존성을
# 준비한다. 코드 서명은 Xcode Cloud automatic signing이 담당한다.

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_FALLBACK="$(CDPATH= cd -- "${SCRIPT_DIR}/../../../.." && pwd)"
REPO="${CI_PRIMARY_REPOSITORY_PATH:-${REPO_FALLBACK}}"
MOBILE="${REPO}/apps/mobile"
IOS="${MOBILE}/ios"

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

echo "▸ Node 24 설치"
if ! brew list node@24 >/dev/null 2>&1; then
  brew install node@24
fi
export PATH="$(brew --prefix node@24)/bin:${PATH}"
node --version

echo "▸ pnpm 11.3.0 설치"
npm install --global pnpm@11.3.0
pnpm --version

echo "▸ Ruby 3.2 이상과 lockfile Bundler 준비"
if ! ruby -rrubygems -e 'exit Gem::Version.new(RUBY_VERSION) >= Gem::Version.new("3.2.0") ? 0 : 1'; then
  if ! brew list ruby@3.2 >/dev/null 2>&1; then
    brew install ruby@3.2
  fi
  export PATH="$(brew --prefix ruby@3.2)/bin:${PATH}"
fi
ruby --version

BUNDLER_VERSION="$(
  awk '
    /^BUNDLED WITH$/ {
      getline
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      print
      exit
    }
  ' "${MOBILE}/Gemfile.lock"
)"
if [ -z "${BUNDLER_VERSION}" ]; then
  echo "Gemfile.lock의 BUNDLED WITH 버전을 찾지 못했습니다." >&2
  exit 1
fi
if ! gem list --installed bundler --version "${BUNDLER_VERSION}" >/dev/null 2>&1; then
  gem install bundler --version "${BUNDLER_VERSION}" --no-document
fi
bundle "_${BUNDLER_VERSION}_" --version

echo "▸ JavaScript 의존성 설치"
cd "${REPO}"
pnpm install --frozen-lockfile

echo "▸ 운영 Firebase iOS 설정 확인"
node "${REPO}/scripts/restore-mobile-firebase-config.mjs" --ios --require
echo "  Xcode Cloud secret에서 복원"

echo "▸ CocoaPods 의존성 설치"
cd "${MOBILE}"
bundle "_${BUNDLER_VERSION}_" config set --local path vendor/bundle
bundle "_${BUNDLER_VERSION}_" install
cd "${IOS}"
bundle "_${BUNDLER_VERSION}_" exec pod install

echo "✅ Xcode Cloud post-clone 준비 완료"
