import { access, readFile } from "node:fs/promises";
import path from "node:path";

const LEGACY_CONFIG_PATHS = Object.freeze([
  "apps/mobile/android/app/google-services.json",
  "apps/mobile/android/app/src/debug/google-services.json",
  "apps/mobile/android/app/src/release/google-services.json",
  "apps/mobile/ios/CyclePair/GoogleService-Info.plist",
  "apps/mobile/ios/Firebase/Debug/GoogleService-Info.plist",
  "apps/mobile/ios/Firebase/Release/GoogleService-Info.plist",
]);

async function exists(root, relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

function assertContains(text, value, message) {
  if (!text.includes(value)) throw new Error(message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertPbxBuildSetting(text, key, value) {
  const serializedValue = value === "" ? '""' : `"?${escapeRegExp(value)}"?`;
  const pattern = new RegExp(
    `${escapeRegExp(key)}\\s*=\\s*${serializedValue}\\s*;`
  );
  if (!pattern.test(text)) {
    throw new Error(
      `iOS Firebase build-configuration selection에 ${key} = ${value};가 없습니다.`
    );
  }
}

export async function assertNativeFirebaseSelectionStructure(root, manifest) {
  const [androidBuildFile, iosProjectFile, iosSelectorScript] =
    await Promise.all([
      readFile(path.join(root, "apps/mobile/android/app/build.gradle"), "utf8"),
      readFile(
        path.join(root, "apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj"),
        "utf8"
      ),
      readFile(
        path.join(root, "apps/mobile/scripts/select-ios-firebase-config.sh"),
        "utf8"
      ),
    ]);

  for (const relativePath of LEGACY_CONFIG_PATHS) {
    if (await exists(root, relativePath)) {
      throw new Error(
        `legacy Firebase config 경로를 사용할 수 없습니다: ${relativePath}`
      );
    }
  }
  for (const key of ["androidConfig", "iosConfig"]) {
    if (!(await exists(root, `apps/mobile/${manifest[key]}.example`))) {
      throw new Error(`${key} example marker가 없습니다.`);
    }
  }

  for (const value of [
    'namespace "com.seorilabs.cyclepair"',
    'applicationId "com.seorilabs.cyclepair"',
    "verifyDebugFirebaseConfig",
    "verifyReleaseFirebaseConfig",
    "processDebugGoogleServices",
    "processReleaseGoogleServices",
    "firebaseEnvironments.androidConfig",
  ]) {
    assertContains(
      androidBuildFile,
      value,
      `Android Firebase variant guard에 ${value}가 없습니다.`
    );
  }

  const configPath = manifest.iosConfig.replace(/^ios\//, "");
  for (const value of [
    "[Firebase] Validate Environment Config",
    "[Firebase] Embed Environment Config",
  ]) {
    assertContains(
      iosProjectFile,
      value,
      `iOS Firebase build-configuration selection에 ${value}가 없습니다.`
    );
  }
  for (const [key, value] of [
    ["FIREBASE_CONFIG_PATH", configPath],
    ["FIREBASE_EXPECTED_PROJECT_ID", manifest.projectId],
  ]) {
    assertPbxBuildSetting(iosProjectFile, key, value);
  }
  if (
    iosProjectFile.includes("GoogleService-Info.plist in Resources") ||
    iosProjectFile.includes("CyclePair/GoogleService-Info.plist")
  ) {
    throw new Error(
      "iOS target에 legacy Firebase plist resource가 남아 있습니다."
    );
  }

  const targetPhaseStart = iosProjectFile.indexOf("buildPhases = (");
  const validatePhase = iosProjectFile.indexOf(
    "[Firebase] Validate Environment Config",
    targetPhaseStart
  );
  const sourcesPhase = iosProjectFile.indexOf(
    "/* Sources */",
    targetPhaseStart
  );
  const copyPodsPhase = iosProjectFile.indexOf(
    "/* [CP] Copy Pods Resources */",
    targetPhaseStart
  );
  const embedPhase = iosProjectFile.indexOf(
    "[Firebase] Embed Environment Config",
    targetPhaseStart
  );
  const rnfbPhase = iosProjectFile.indexOf(
    "/* [CP-User] [RNFB] Core Configuration */",
    targetPhaseStart
  );
  if (
    !(
      targetPhaseStart >= 0 &&
      validatePhase < sourcesPhase &&
      copyPodsPhase < embedPhase &&
      embedPhase < rnfbPhase
    )
  ) {
    throw new Error(
      "iOS Firebase validate/embed build phase 순서가 안전하지 않습니다."
    );
  }
  for (const value of [
    "FIREBASE_CONFIG_PATH",
    "FIREBASE_EXPECTED_PROJECT_ID",
    "single tracked project",
    "GoogleService-Info.plist",
  ]) {
    assertContains(
      iosSelectorScript,
      value,
      `iOS Firebase selector에 ${value} 검증이 없습니다.`
    );
  }
}
