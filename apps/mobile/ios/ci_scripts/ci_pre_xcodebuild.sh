#!/bin/sh

# Archive 직전 marketing version과 build number를 Xcode Cloud 실행값에 맞춘다.

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_FALLBACK="$(CDPATH= cd -- "${SCRIPT_DIR}/../../../.." && pwd)"
REPO="${CI_PRIMARY_REPOSITORY_PATH:-${REPO_FALLBACK}}"
RESOLVER="${REPO}/scripts/resolve-release-version.mjs"

RELEASE_TAG="${CI_TAG:-}"
if [ -z "${RELEASE_TAG}" ]; then
  PACKAGE_VERSION="$(node -p "require('${REPO}/package.json').version")"
  RELEASE_TAG="v${PACKAGE_VERSION}"
  echo "▸ CI_TAG 없음 — package version 사용: ${RELEASE_TAG}"
fi

OUTFILE="$(mktemp)"
trap 'rm -f "${OUTFILE}"' EXIT
GITHUB_OUTPUT="${OUTFILE}" \
  node "${RESOLVER}" --tag "${RELEASE_TAG}" --github-output >/dev/null

MARKETING_VERSION="$(grep '^apple_marketing_version=' "${OUTFILE}" | cut -d= -f2)"
RESOLVED_BUILD_NUMBER="$(grep '^apple_build_number=' "${OUTFILE}" | cut -d= -f2)"
BUILD_NUMBER="${CI_BUILD_NUMBER:-${RESOLVED_BUILD_NUMBER}}"

case "${MARKETING_VERSION}" in
  ''|*[!0-9.]*)
    echo "유효하지 않은 iOS marketing version: ${MARKETING_VERSION:-empty}" >&2
    exit 1
    ;;
esac
case "${BUILD_NUMBER}" in
  ''|*[!0-9]*)
    echo "유효하지 않은 iOS build number: ${BUILD_NUMBER:-empty}" >&2
    exit 1
    ;;
esac

echo "▸ iOS version ${MARKETING_VERSION} (${BUILD_NUMBER}), source=${RELEASE_TAG}"

if [ "${CI_PRE_XCODEBUILD_DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN marketing=${MARKETING_VERSION} build=${BUILD_NUMBER} tag=${RELEASE_TAG}"
  exit 0
fi

cd "${REPO}/apps/mobile/ios"
agvtool new-marketing-version "${MARKETING_VERSION}"
agvtool new-version -all "${BUILD_NUMBER}"

echo "✅ Xcode Cloud version 주입 완료"
