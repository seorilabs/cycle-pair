#!/bin/sh

# exact stable tag를 중앙 release authority로 해석해 archive Info.plist에 주입한다.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_FALLBACK="$(CDPATH= cd -- "${SCRIPT_DIR}/../../../.." && pwd)"
REPO="${CI_PRIMARY_REPOSITORY_PATH:-${REPO_FALLBACK}}"
RELEASE_TAG="${CI_TAG:-}"
AUTHORITY_SHA="9afa357f9ba6c8d6a813c7cec7ad3d35c626bdd5"
APPLIER_SHA256="b399afde0016e23947e173437e266aa83071079d1345b41ff580ebfe63357d6f"
AUTHORITY_SHA256="ca9ef5b4fe326323840b171f9e6ed069cb182d2aee8e88b72e352c57514d466b"

case "$RELEASE_TAG" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "exact stable SemVer CI_TAG가 필요합니다: ${RELEASE_TAG:-empty}" >&2; exit 1 ;;
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

git -C "$REPO" fetch --force --tags origin >/dev/null 2>&1
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
echo "DRY_RUN marketing=${marketing_version} build=${build_number} tag=${RELEASE_TAG}"
[ "${CI_PRE_XCODEBUILD_DRY_RUN:-0}" = "1" ] || echo "✅ Xcode Cloud version 주입 완료"
