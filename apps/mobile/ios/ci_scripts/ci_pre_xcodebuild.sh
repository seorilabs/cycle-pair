#!/bin/sh

# exact stable tag를 중앙 release authority로 해석해 archive Info.plist에 주입한다.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_FALLBACK="$(CDPATH= cd -- "${SCRIPT_DIR}/../../../.." && pwd)"
REPO="${CI_PRIMARY_REPOSITORY_PATH:-${REPO_FALLBACK}}"
RELEASE_TAG="${CI_TAG:-}"
CLOUD_BUILD_NUMBER="${CI_BUILD_NUMBER:-}"
# Apple build number 정본을 Xcode Cloud의 CI_BUILD_NUMBER로 옮긴 중앙 commit이다.
# seorilabs/.github contracts/release-version-authority.yaml schemaVersion 2의
# appleBuildNumberExceptions가 계약이다. 이전 pin은 태그 파생 encodedVersion을 돌려주므로
# 아래 CI_BUILD_NUMBER 대조에서 막힌다.
AUTHORITY_SHA="6db01149a7700c0557bbeaf2e045aac7df0e78f2"
APPLIER_SHA256="1da1dce81a5194a37f7a31475c29d899d95eb6da9ae1460927fe439aa329752c"
AUTHORITY_SHA256="ca9ef5b4fe326323840b171f9e6ed069cb182d2aee8e88b72e352c57514d466b"

case "$RELEASE_TAG" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "exact stable SemVer CI_TAG가 필요합니다: ${RELEASE_TAG:-empty}" >&2; exit 1 ;;
esac

# Apple build number의 정본은 Xcode Cloud가 발급한 CI_BUILD_NUMBER다. 빈 값, 0, leading zero,
# 비정수는 archive를 시작하기 전에 끊는다.
case "$CLOUD_BUILD_NUMBER" in
  ''|*[!0-9]*|0*)
    echo "Xcode Cloud CI_BUILD_NUMBER는 1 이상의 정수여야 합니다: ${CLOUD_BUILD_NUMBER:-missing}" >&2
    exit 1
    ;;
esac

authority_dir="$(mktemp -d)"
trap 'rm -rf -- "$authority_dir"' EXIT INT TERM
base_url="https://raw.githubusercontent.com/seorilabs/.github/${AUTHORITY_SHA}/scripts/release"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "${base_url}/xcode-cloud-apply-tag-version.mjs" \
  --output "${authority_dir}/xcode-cloud-apply-tag-version.mjs"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "${base_url}/tag-version-authority.mjs" \
  --output "${authority_dir}/tag-version-authority.mjs"
(
  cd "$authority_dir"
  printf '%s  %s\n' "$APPLIER_SHA256" xcode-cloud-apply-tag-version.mjs | shasum -a 256 -c
  printf '%s  %s\n' "$AUTHORITY_SHA256" tag-version-authority.mjs | shasum -a 256 -c
)

git -C "$REPO" fetch --force --tags origin >/dev/null
args=""
if [ "${CI_PRE_XCODEBUILD_DRY_RUN:-0}" = "1" ]; then
  args="--dry-run"
fi
result="$(node "${authority_dir}/xcode-cloud-apply-tag-version.mjs" \
  --tag "$RELEASE_TAG" \
  --repository "$REPO" \
  --info-plist "$REPO/apps/mobile/ios/CyclePair/Info.plist" \
  $args)"

marketing_version="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).appleMarketingVersion ?? ""))' "$result")"
build_number="$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).appleBuildNumber ?? ""))' "$result")"
[ -n "$marketing_version" ] && [ -n "$build_number" ] || {
  echo "중앙 release binding 결과가 불완전합니다." >&2
  exit 1
}
[ "$build_number" = "$CLOUD_BUILD_NUMBER" ] || {
  echo "중앙 release binding이 Xcode Cloud build number를 반영하지 않았습니다: binding=${build_number:-empty} CI_BUILD_NUMBER=${CLOUD_BUILD_NUMBER}. pin된 authority SHA와 checksum을 갱신하세요." >&2
  exit 1
}
if [ "${CI_PRE_XCODEBUILD_DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN marketing=${marketing_version} build=${build_number} tag=${RELEASE_TAG}"
else
  echo "✅ Xcode Cloud version 주입 완료: marketing=${marketing_version} build=${build_number}"
fi
