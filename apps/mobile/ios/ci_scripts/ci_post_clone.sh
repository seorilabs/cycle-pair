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

echo "▸ JavaScript 의존성 설치"
cd "${REPO}"
pnpm install --frozen-lockfile

echo "▸ 운영 Firebase iOS 설정 확인"
node "${REPO}/scripts/restore-mobile-firebase-config.mjs" --ios --require
echo "  Xcode Cloud secret에서 복원"

echo "▸ CocoaPods 의존성 설치"
cd "${MOBILE}"
bundle config set --local path vendor/bundle
bundle install
cd "${IOS}"
bundle exec pod install

echo "✅ Xcode Cloud post-clone 준비 완료"
