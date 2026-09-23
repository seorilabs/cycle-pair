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
  SEORI_RELEASE_TAG
  SEORI_RELEASE_VERSION_NAME
  SEORI_RELEASE_VERSION_CODE
  BUILD_CREDENTIAL_DIR
  GOOGLE_PLAY_UPLOAD_KEY_ALIAS
)
for variable_name in "${required_environment[@]}"; do
  [[ -n "${!variable_name:-}" ]] || {
    echo "필수 빌드 환경변수가 없습니다: $variable_name" >&2
    exit 1
  }
done

# 자격증명은 Secret Manager 가 아니라 일회성 GCS 객체로 들어온다. cloudbuild 의
# fetch-ephemeral-credentials 가 BUILD_CREDENTIAL_DIR 에 내려두고 prefix 를 즉시 지운다.
# 이 스크립트는 값을 자식 프로세스에 넘기지 않으므로 export 하지 않는다.
#
# 함수는 exit 가 아니라 return 으로 실패를 알린다. 명령 치환 안의 exit 는 서브셸만
# 끝내고 부모는 계속 돈다. 대입도 `export VAR="$(...)"` 형태를 쓰지 않는다. export 의
# 종료 상태 0 이 덮어써서 set -e 가 치환 실패를 잡지 못하기 때문이다.
read_credential() {
  local path="$BUILD_CREDENTIAL_DIR/$1"
  [ -s "$path" ] || { echo "자격증명 파일이 없거나 비어 있음: $1" >&2; return 1; }
  cat "$path"
}
firebase_config_base64="$(read_credential firebase-android-config.b64)"
upload_keystore_base64="$(read_credential play-keystore.b64)"
upload_keystore_password="$(read_credential play-keystore-password)"
upload_key_password="$(read_credential play-key-password)"

pnpm install --frozen-lockfile

version_name="$SEORI_RELEASE_VERSION_NAME"
[[ "$SEORI_RELEASE_TAG" == "v$version_name" ]] || {
  echo "중앙 release tag와 versionName이 다릅니다." >&2
  exit 1
}
[[ "$version_name" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || {
  echo "SEORI_RELEASE_VERSION_NAME이 올바르지 않습니다." >&2
  exit 1
}
[[ "$SEORI_RELEASE_VERSION_CODE" =~ ^[1-9][0-9]*$ ]] || {
  echo "SEORI_RELEASE_VERSION_CODE가 올바르지 않습니다." >&2
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

node scripts/build-google-play.mjs

source_aab="$repo_root/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab"
[[ -f "$source_aab" ]] || {
  echo "Gradle 결과 AAB를 찾지 못했습니다: $source_aab" >&2
  exit 1
}

output_aab="${SEORI_ANDROID_AAB_OUTPUT:-$repo_root/$AAB_PATH}"
mkdir -p "$(dirname "$output_aab")"
cp "$source_aab" "$output_aab"
jarsigner -verify -strict \
  -keystore "$keystore_file" \
  -storepass "$upload_keystore_password" \
  "$output_aab" "$GOOGLE_PLAY_UPLOAD_KEY_ALIAS" >/dev/null

artifact_bytes="$(wc -c <"$output_aab" | tr -d ' ')"
echo "Android signed AAB 생성 완료: path=$output_aab bytes=$artifact_bytes releaseTag=$SEORI_RELEASE_TAG versionName=$version_name versionCode=$SEORI_RELEASE_VERSION_CODE"
