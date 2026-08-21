#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# shellcheck disable=SC1091
source "$repo_root/build.env"

required_commands=(node pnpm java keytool jarsigner)
for command_name in "${required_commands[@]}"; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "필수 빌드 도구가 없습니다: $command_name" >&2
    exit 1
  }
done

actual_node="$(node --version)"
actual_pnpm="$(pnpm --version)"
actual_java="$(java -version 2>&1 | head -n 1)"
[[ "$actual_node" == "v$NODE_VERSION" ]] || {
  echo "Node 버전 불일치: expected=v$NODE_VERSION actual=$actual_node" >&2
  exit 1
}
[[ "$actual_pnpm" == "$PNPM_VERSION" ]] || {
  echo "pnpm 버전 불일치: expected=$PNPM_VERSION actual=$actual_pnpm" >&2
  exit 1
}
[[ "$actual_java" == *\"$JDK_VERSION.* ]] || {
  echo "JDK 버전 불일치: expected=$JDK_VERSION actual=$actual_java" >&2
  exit 1
}

[[ "$GRADLE_MAX_WORKERS" =~ ^[1-9][0-9]*$ ]] || {
  echo "Gradle worker 수가 올바르지 않습니다: $GRADLE_MAX_WORKERS" >&2
  exit 1
}
[[ "$CMAKE_BUILD_PARALLEL_LEVEL" =~ ^[1-9][0-9]*$ ]] || {
  echo "CMake 병렬도 값이 올바르지 않습니다: $CMAKE_BUILD_PARALLEL_LEVEL" >&2
  exit 1
}
export CYCLEPAIR_ANDROID_GRADLE_MAX_WORKERS="$GRADLE_MAX_WORKERS"
export CMAKE_BUILD_PARALLEL_LEVEL

required_environment=(
  ANDROID_VERSION_NAME
  ANDROID_VERSION_CODE
  FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64
  GOOGLE_PLAY_UPLOAD_KEYSTORE_BASE64
  GOOGLE_PLAY_UPLOAD_KEYSTORE_PASSWORD
  GOOGLE_PLAY_UPLOAD_KEY_PASSWORD
  GOOGLE_PLAY_UPLOAD_KEY_ALIAS
)
for variable_name in "${required_environment[@]}"; do
  [[ -n "${!variable_name:-}" ]] || {
    echo "필수 빌드 환경변수가 없습니다: $variable_name" >&2
    exit 1
  }
done

firebase_config_base64="$FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64"
upload_keystore_base64="$GOOGLE_PLAY_UPLOAD_KEYSTORE_BASE64"
upload_keystore_password="$GOOGLE_PLAY_UPLOAD_KEYSTORE_PASSWORD"
upload_key_password="$GOOGLE_PLAY_UPLOAD_KEY_PASSWORD"
unset FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64
unset GOOGLE_PLAY_UPLOAD_KEYSTORE_BASE64
unset GOOGLE_PLAY_UPLOAD_KEYSTORE_PASSWORD
unset GOOGLE_PLAY_UPLOAD_KEY_PASSWORD

pnpm install --frozen-lockfile

version_name="${ANDROID_VERSION_NAME#v}"
version_json="$(node scripts/resolve-release-version.mjs --tag "v$version_name")"
resolved_version_name="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).version_name)' "$version_json")"
resolved_version_code="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).android_version_code)' "$version_json")"
[[ "$resolved_version_name" == "$version_name" ]] || {
  echo "Android versionName 해석에 실패했습니다." >&2
  exit 1
}
[[ "$ANDROID_VERSION_CODE" == "$resolved_version_code" ]] || {
  echo "Android versionCode가 릴리스 태그 파생값과 다릅니다." >&2
  exit 1
}

secret_dir="$(mktemp -d)"
firebase_config="$repo_root/apps/mobile/android/app/google-services.json"
keystore_file="$secret_dir/cycle-pair-upload.jks"
[[ ! -e "$firebase_config" ]] || {
  echo "기존 로컬 자격증명 파일을 덮어쓰지 않습니다: $firebase_config" >&2
  rm -rf "$secret_dir"
  exit 1
}
cleanup() {
  rm -f "$firebase_config"
  rm -rf "$secret_dir"
}
trap cleanup EXIT INT TERM

FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64="$firebase_config_base64" \
  node scripts/restore-mobile-firebase-config.mjs --android --require
printf '%s' "$upload_keystore_base64" | base64 --decode >"$keystore_file"
chmod 600 "$firebase_config" "$keystore_file"

expected_fingerprint="DF0194ACA157C73C66ACBF0954D785B460412B6B632B5270A53BF10BF87CA860"
keystore_details="$(
  keytool -list -v \
    -J-Duser.language=en -J-Duser.country=US \
    -keystore "$keystore_file" \
    -storepass "$upload_keystore_password" \
    -alias "$GOOGLE_PLAY_UPLOAD_KEY_ALIAS"
)"
actual_fingerprint="$(
  printf '%s\n' "$keystore_details" \
    | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' \
    | head -n 1 \
    | tr -d ':' \
    | tr '[:lower:]' '[:upper:]'
)"
[[ "$actual_fingerprint" == "$expected_fingerprint" ]] || {
  echo "Cycle Pair Google Play 업로드 인증서 fingerprint가 일치하지 않습니다." >&2
  exit 1
}

export CYCLEPAIR_ANDROID_UPLOAD_STORE_FILE="$keystore_file"
export CYCLEPAIR_ANDROID_UPLOAD_STORE_PASSWORD="$upload_keystore_password"
export CYCLEPAIR_ANDROID_UPLOAD_KEY_ALIAS="$GOOGLE_PLAY_UPLOAD_KEY_ALIAS"
export CYCLEPAIR_ANDROID_UPLOAD_KEY_PASSWORD="$upload_key_password"
export ORG_GRADLE_PROJECT_reactNativeArchitectures="$REACT_NATIVE_ARCHITECTURES"

node scripts/build-google-play.mjs --tag "v$version_name"

source_aab="$repo_root/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab"
[[ -f "$source_aab" ]] || {
  echo "Gradle 결과 AAB를 찾지 못했습니다: $source_aab" >&2
  exit 1
}

output_aab="$repo_root/$AAB_PATH"
mkdir -p "$(dirname "$output_aab")"
cp "$source_aab" "$output_aab"
jarsigner -verify -strict \
  -keystore "$keystore_file" \
  -storepass "$upload_keystore_password" \
  "$output_aab" "$GOOGLE_PLAY_UPLOAD_KEY_ALIAS" >/dev/null

artifact_bytes="$(wc -c <"$output_aab" | tr -d ' ')"
echo "Android signed AAB 생성 완료: path=$AAB_PATH bytes=$artifact_bytes versionName=$version_name versionCode=$ANDROID_VERSION_CODE"
