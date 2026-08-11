import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";

import { AITWriter, PlatformType } from "@apps-in-toss/ait-format";

import {
  computeFirebaseSourceFingerprints,
  evaluateReleaseReadiness,
  subscriptionContractBlockers,
} from "./release-readiness-lib.mjs";

test("store subscription products match the mobile and Firebase catalogs", () => {
  const mobileCatalogSource = `
    provider: 'google-play', productId: 'cyclepair_plus', basePlanId: 'monthly', billingPeriod: 'P1M',
    provider: 'google-play', productId: 'cyclepair_plus', basePlanId: 'yearly', billingPeriod: 'P1Y',
    provider: 'app-store', productId: 'com.seorilabs.cyclepair.plus.monthly', basePlanId: 'monthly', billingPeriod: 'P1M',
    provider: 'app-store', productId: 'com.seorilabs.cyclepair.plus.yearly', basePlanId: 'yearly', billingPeriod: 'P1Y',
  `;
  const firebaseCatalogSource = `
    provider: "google-play" as const, productId: "cyclepair_plus", basePlanId: "monthly" as const,
    provider: "google-play" as const, productId: "cyclepair_plus", basePlanId: "yearly" as const,
    provider: "app-store" as const, productId: "com.seorilabs.cyclepair.plus.monthly", basePlanId: "monthly" as const,
    provider: "app-store" as const, productId: "com.seorilabs.cyclepair.plus.yearly", basePlanId: "yearly" as const,
  `;
  const blockers = subscriptionContractBlockers({
    playConfig: {
      monetization: {
        model: "premium-subscription",
        subscriptionProducts: [
          {
            productId: "cyclepair_plus",
            basePlanId: "monthly",
            billingPeriod: "P1M",
          },
          {
            productId: "cyclepair_plus",
            basePlanId: "yearly",
            billingPeriod: "P1Y",
          },
        ],
      },
    },
    appStoreConfig: {
      monetization: {
        model: "premium-subscription",
        subscriptionProducts: [
          {
            productId: "com.seorilabs.cyclepair.plus.monthly",
            basePlanId: "monthly",
            billingPeriod: "P1M",
          },
          {
            productId: "com.seorilabs.cyclepair.plus.yearly",
            basePlanId: "yearly",
            billingPeriod: "P1Y",
          },
        ],
      },
    },
    mobileCatalogSource,
    firebaseCatalogSource,
  });

  assert.deepEqual(blockers, { firebase: [], googlePlay: [], appStore: [] });

  const drift = subscriptionContractBlockers({
    playConfig: {
      monetization: {
        model: "premium-subscription",
        subscriptionProducts: [
          {
            productId: "com.seorilabs.cyclepair.premium.monthly",
            basePlanId: "monthly",
            billingPeriod: "P1M",
          },
        ],
      },
    },
    appStoreConfig: {
      monetization: {
        model: "premium-subscription",
        subscriptionProducts: [],
      },
    },
    mobileCatalogSource,
    firebaseCatalogSource: firebaseCatalogSource.replace(
      "cyclepair_plus",
      "cyclepair_premium"
    ),
  });
  assert.deepEqual(drift, {
    firebase: ["모바일과 Firebase 구독 product/base plan 계약 불일치"],
    googlePlay: ["Play 구독 product/base plan과 모바일 catalog 불일치"],
    appStore: ["App Store 구독 product와 모바일 catalog 불일치"],
  });
});

const execFileAsync = promisify(execFile);

async function write(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    Buffer.isBuffer(content)
      ? content
      : typeof content === "string"
      ? content
      : `${JSON.stringify(content, null, 2)}\n`
  );
}

function crc32(content) {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [name, rawContent] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const content = Buffer.isBuffer(rawContent)
      ? rawContent
      : Buffer.from(rawContent);
    const checksum = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    const localPart = Buffer.concat([localHeader, nameBytes, content]);
    localParts.push(localPart);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(Buffer.concat([centralHeader, nameBytes]));
    localOffset += localPart.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(centralParts.length, 8);
  endOfCentralDirectory.writeUInt16LE(centralParts.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(localOffset, 16);

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    endOfCentralDirectory,
  ]);
}

function encodeProtoVarint(value) {
  let remaining = BigInt(value);
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return Buffer.from(bytes);
}

function encodeProtoBytes(fieldNumber, value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([
    encodeProtoVarint((fieldNumber << 3) | 2),
    encodeProtoVarint(content.length),
    content,
  ]);
}

function createAabManifest({ packageName, versionName, versionCode }) {
  const attribute = (name, value) =>
    Buffer.concat([
      encodeProtoBytes(2, name),
      encodeProtoBytes(3, String(value)),
    ]);
  const element = Buffer.concat([
    encodeProtoBytes(2, "manifest"),
    encodeProtoBytes(4, attribute("package", packageName)),
    encodeProtoBytes(4, attribute("versionName", versionName)),
    encodeProtoBytes(4, attribute("versionCode", versionCode)),
  ]);
  return encodeProtoBytes(1, element);
}

function unsignedAabEntries(overrides = {}) {
  return {
    "BundleConfig.pb": Buffer.from([0x08, 0x01]),
    "base/manifest/AndroidManifest.xml": createAabManifest({
      packageName: "com.seorilabs.cyclepair",
      versionName: "0.1.0",
      versionCode: 1,
    }),
    "base/dex/classes.dex": Buffer.concat([
      Buffer.from("dex\n039\0", "latin1"),
      Buffer.alloc(32),
    ]),
    ...overrides,
  };
}

function androidArtifactEvidence(sha256) {
  return {
    ...verified(),
    path: "artifacts/cyclepair.aab",
    sha256,
    format: "android-app-bundle",
    packageName: "com.seorilabs.cyclepair",
    versionName: "0.1.0",
    versionCode: 1,
    signing: { certificateSha256: "a".repeat(64) },
  };
}

function appStoreArtifactEvidence(sha256) {
  return {
    ...verified(),
    path: "artifacts/cyclepair.xcarchive.zip",
    sha256,
    format: "xcarchive-zip",
    bundleId: "com.seorilabs.cyclepair",
    marketingVersion: "0.1.0",
    buildNumber: 1,
    signing: { teamId: "FIXTURETEAM" },
  };
}

async function createAppsInTossArtifact({
  appName = "cycle-pair",
  platform = PlatformType.REACT_NATIVE,
  tdsVersion = "2.0.4",
} = {}) {
  const runtimeVersion = "0.84.0";
  const sdkVersion = "2.10.8";
  const bundleFiles = ["bundle.ios.0_84_0.js", "bundle.android.0_84_0.js"];
  const writer = new AITWriter({
    appName,
    deploymentId: "019fc07c-10ad-7d8a-8563-f549d8d2573d",
  });
  writer.setMetadata({
    isGame: false,
    platform,
    runtimeVersion,
    sdkVersion,
    bundleFiles,
    packageJson: {
      dependencies: {
        "@apps-in-toss/framework": sdkVersion,
        ...(tdsVersion === null
          ? {}
          : { "@toss/tds-react-native": tdsVersion }),
        "react-native": runtimeVersion,
      },
    },
  });
  for (const file of bundleFiles) {
    writer.addFile(file, new TextEncoder().encode(`fixture ${file}`));
  }
  return Buffer.from(await writer.toBuffer());
}

async function configureAppsInTossReadyFixture(
  root,
  artifact,
  {
    appNameStatus = "confirmed-console-match",
    icon = "https://example.com/icon.png",
    tdsVersion = "2.0.4",
  } = {}
) {
  const artifactPath = "artifacts/cyclepair.ait";
  await write(root, artifactPath, artifact);
  await write(root, "apps/ait/package.json", {
    dependencies: {
      "@apps-in-toss/framework": "2.10.8",
      ...(tdsVersion === null ? {} : { "@toss/tds-react-native": tdsVersion }),
      "react-native": "0.84.0",
    },
  });
  await write(
    root,
    "apps/ait/granite.config.ts",
    `export default {
  appName: "cycle-pair",
  icon: "${icon}",
};\n`
  );
  await write(root, "apps-in-toss/apps-in-toss.config.json", {
    appName: "cycle-pair",
    appNameStatus,
    buildTarget: { artifact: artifactPath },
  });

  const releaseEvidence = await readJsonFixture(root, "release/readiness.json");
  releaseEvidence.targetMarkets.appsInToss = {
    included: true,
    ...verified("AppsInToss fixture target"),
  };
  releaseEvidence.artifacts.appsInTossPackage = {
    ...verified(),
    path: artifactPath,
    sha256: createHash("sha256").update(artifact).digest("hex"),
  };
  releaseEvidence.console.appsInTossApp = {
    ...verified(),
    appName: "cycle-pair",
  };
  releaseEvidence.policy.appsInTossCompatibility = verified();
  releaseEvidence.manualTests.appsInTossSandboxTwoPerson = verified();
  await write(root, "release/readiness.json", releaseEvidence);
}

function xcarchiveEntries(bundleId = "com.seorilabs.cyclepair") {
  return {
    "CyclePair.xcarchive/Info.plist": `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>ApplicationProperties</key><dict>
<key>Team</key><string>FIXTURETEAM</string>
</dict></dict></plist>`,
    "CyclePair.xcarchive/Products/Applications/CyclePair.app/Info.plist": `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleExecutable</key><string>CyclePair</string>
</dict></plist>`,
    "CyclePair.xcarchive/Products/Applications/CyclePair.app/CyclePair":
      "unsigned executable",
    "CyclePair.xcarchive/Products/Applications/CyclePair.app/_CodeSignature/CodeResources":
      "self-declared signature marker",
  };
}

async function signFixtureAab(root) {
  const artifactPath = path.join(root, "artifacts/cyclepair.aab");
  const keystorePath = path.join(root, "artifacts/fixture-upload.p12");
  const password = "fixture-password";
  await execFileAsync("keytool", [
    "-genkeypair",
    "-alias",
    "fixture",
    "-keyalg",
    "RSA",
    "-keysize",
    "2048",
    "-validity",
    "2",
    "-dname",
    "CN=Cycle Pair Fixture, O=Seorilabs, C=KR",
    "-storetype",
    "PKCS12",
    "-keystore",
    keystorePath,
    "-storepass",
    password,
    "-keypass",
    password,
    "-noprompt",
  ]);
  await execFileAsync("jarsigner", [
    "-keystore",
    keystorePath,
    "-storetype",
    "PKCS12",
    "-storepass",
    password,
    "-keypass",
    password,
    artifactPath,
    "fixture",
  ]);
  const { stdout, stderr } = await execFileAsync(
    "keytool",
    [
      "-list",
      "-v",
      "-alias",
      "fixture",
      "-keystore",
      keystorePath,
      "-storepass",
      password,
    ],
    {
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    }
  );
  const fingerprint = `${stdout}\n${stderr}`
    .match(/SHA256:\s*([0-9A-F:]{64,})/i)?.[1]
    ?.replaceAll(":", "")
    .toLowerCase();
  assert.match(fingerprint ?? "", /^[a-f0-9]{64}$/);
  return fingerprint;
}

async function commitFixtureSource(root) {
  await execFileAsync("git", ["-C", root, "init", "-q", "-b", "main"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Fixture"]);
  await execFileAsync("git", [
    "-C",
    root,
    "config",
    "user.email",
    "fixture@example.invalid",
  ]);
  await execFileAsync("git", ["-C", root, "add", "."]);
  await execFileAsync("git", ["-C", root, "commit", "-qm", "fixture source"]);
  const { stdout } = await execFileAsync("git", [
    "-C",
    root,
    "rev-parse",
    "HEAD",
  ]);
  return stdout.trim();
}

async function hash(root, relativePath) {
  return createHash("sha256")
    .update(await readFile(path.join(root, relativePath)))
    .digest("hex");
}

async function readJsonFixture(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

function verified(evidence = "deterministic fixture") {
  return {
    status: "verified",
    reference: "fixture:deterministic-evidence",
    verifiedAt: "2026-07-14T00:00:00Z",
    evidence,
  };
}

function missing() {
  return {
    status: "missing",
    verifiedAt: null,
    evidence: null,
  };
}

async function createReadyFixture(root) {
  await write(root, "package.json", { version: "0.1.0" });
  await write(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  await write(root, "pnpm-workspace.yaml", "packages:\n  - apps/*\n");
  await write(root, "apps/mobile/package.json", {
    version: "0.1.0",
    dependencies: {
      "@react-native-firebase/app": "25.1.0",
      "@react-native-firebase/app-check": "25.1.0",
    },
  });
  await write(
    root,
    "apps/mobile/android/build.gradle",
    "ext { targetSdkVersion = 36 }\n"
  );
  await write(
    root,
    "apps/mobile/android/app/build.gradle",
    `def firebaseEnvironments = [androidConfig: "android/app/google-services.json"]
def selectedFirebaseConfig = firebaseEnvironments.androidConfig
def verifyDebugFirebaseConfig = tasks.register("verifyDebugFirebaseConfig")
def verifyReleaseFirebaseConfig = tasks.register("verifyReleaseFirebaseConfig")
def verifyReleaseSigning = tasks.register("verifyReleaseSigning")
def verifyReleasePrerequisites = tasks.register("verifyReleasePrerequisites")
android {
  namespace "com.seorilabs.cyclepair"
  defaultConfig {
    applicationId "com.seorilabs.cyclepair"
    versionName "0.1.0"
  }
  signingConfigs { release { keyAlias "upload" } }
  buildTypes {
    debug { signingConfig signingConfigs.debug }
    release { signingConfig signingConfigs.release }
  }
}
tasks.named("processDebugGoogleServices") { dependsOn(verifyDebugFirebaseConfig) }
tasks.named("processReleaseGoogleServices") { dependsOn(verifyReleaseFirebaseConfig) }
tasks.configureEach { task ->
  if (task.name == "preReleaseBuild") {
    task.dependsOn(verifyReleasePrerequisites)
  }
}\n`
  );
  await write(root, "apps/mobile/firebase-environments.json", {
    schemaVersion: 2,
    permanentAppId: "com.seorilabs.cyclepair",
    projectId: "cyclepair-fixture-prod",
    androidConfig: "android/app/google-services.json",
    iosConfig: "ios/Firebase/GoogleService-Info.plist",
  });
  for (const relativePath of [
    "android/app/google-services.json.example",
    "ios/Firebase/GoogleService-Info.plist.example",
  ]) {
    await write(root, `apps/mobile/${relativePath}`, "fixture marker\n");
  }
  await write(root, "apps/mobile/android/app/google-services.json", {
    project_info: { project_id: "cyclepair-fixture-prod" },
    client: [
      {
        client_info: {
          mobilesdk_app_id: "fixture-android-app-id",
          android_client_info: {
            package_name: "com.seorilabs.cyclepair",
          },
        },
      },
    ],
  });
  await write(
    root,
    "apps/mobile/ios/Firebase/GoogleService-Info.plist",
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>PROJECT_ID</key><string>cyclepair-fixture-prod</string>
<key>BUNDLE_ID</key><string>com.seorilabs.cyclepair</string>
<key>GOOGLE_APP_ID</key><string>fixture-ios-app-id</string>
</dict></plist>
`
  );
  await write(
    root,
    "apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj",
    `MARKETING_VERSION = 0.1.0;
PRODUCT_BUNDLE_IDENTIFIER = com.seorilabs.cyclepair;
buildPhases = (
  [Firebase] Validate Environment Config,
  /* Sources */,
  /* [CP] Copy Pods Resources */,
  [Firebase] Embed Environment Config,
  /* [CP-User] [RNFB] Core Configuration */,
);
FIREBASE_CONFIG_PATH = Firebase/GoogleService-Info.plist;
FIREBASE_CONFIG_PATH = Firebase/GoogleService-Info.plist;
FIREBASE_EXPECTED_PROJECT_ID = "cyclepair-fixture-prod";
FIREBASE_EXPECTED_PROJECT_ID = "cyclepair-fixture-prod";
APP_ATTEST_ENVIRONMENT = development;
APP_ATTEST_ENVIRONMENT = production;
SWIFT_OBJC_BRIDGING_HEADER = CyclePair/CyclePair-Bridging-Header.h;
SWIFT_OBJC_BRIDGING_HEADER = CyclePair/CyclePair-Bridging-Header.h;
`
  );
  await write(
    root,
    "apps/mobile/ios/CyclePair/AppDelegate.swift",
    `RNFBAppCheckModule.sharedInstance()
FirebaseApp.configure()
`
  );
  await write(
    root,
    "apps/mobile/ios/CyclePair/CyclePair-Bridging-Header.h",
    "#import <RNFBAppCheckModule.h>\n"
  );
  await write(
    root,
    "apps/mobile/ios/CyclePair/CyclePair.entitlements",
    "<key>com.apple.developer.devicecheck.appattest-environment</key>\n"
  );
  await write(
    root,
    "apps/mobile/ios/Podfile.lock",
    "- RNFBAppCheck (25.1.0)\n"
  );
  await write(root, "apps/mobile/firebase.json", {
    "react-native": {
      app_data_collection_default_enabled: false,
      app_check_token_auto_refresh: true,
    },
  });
  await write(
    root,
    "apps/mobile/src/platform/firebase/FirebaseAppCheckBootstrap.ts",
    `import {initializeAppCheck, ReactNativeFirebaseAppCheckProvider} from '@react-native-firebase/app-check';
const environment = app.options.projectId === firebaseEnvironments.projectId;
const provider = new ReactNativeFirebaseAppCheckProvider();
const mode = {developmentBundle: __DEV__};
const development = {android: {provider: 'debug'}, apple: {provider: 'debug'}};
const production = {android: {provider: 'playIntegrity'}, apple: {provider: 'appAttestWithDeviceCheckFallback'}};
initializeAppCheck(app, {provider, isTokenAutoRefreshEnabled: true});
`
  );
  await write(
    root,
    "apps/mobile/index.js",
    "const appCheckInitialization = initializeFirebaseAppCheck();\n<FirebaseAppCheckGate />;\n"
  );
  await write(
    root,
    "apps/mobile/scripts/select-ios-firebase-config.sh",
    `FIREBASE_CONFIG_PATH="configured"
FIREBASE_EXPECTED_PROJECT_ID="configured"
echo "single tracked project"
echo "GoogleService-Info.plist"
`
  );
  await write(root, "packages/product-core/src/index.ts", "export {};\n");
  await write(root, "play-store/google-play.config.json", {
    packageName: "com.seorilabs.cyclepair",
  });
  await write(root, "app-store/app-store.config.json", {
    bundleId: "com.seorilabs.cyclepair",
    appleTeamId: "FIXTURETEAM",
    review: {
      credentials: {
        ...verified("fixture credential reference"),
        loginSmoke: verified("fixture login smoke"),
      },
    },
  });
  await write(root, "apps-in-toss/apps-in-toss.config.json", {
    appName: "cycle-pair",
  });
  await write(root, ".firebaserc", {
    projects: {
      default: "cyclepair-fixture-prod",
    },
  });
  await write(root, "firebase.json", {
    "react-native": {
      app_data_collection_default_enabled: false,
      app_check_token_auto_refresh: true,
    },
    firestore: {
      rules: "firebase/firestore.rules",
      indexes: "firebase/firestore.indexes.json",
    },
    functions: [{ source: "firebase/functions", runtime: "nodejs22" }],
  });
  await write(root, "firebase/firestore.rules", 'rules_version = "2";\n');
  await write(root, "firebase/firestore.indexes.json", {
    indexes: [],
    fieldOverrides: [],
  });
  await write(
    root,
    "firebase/functions/src/index.ts",
    `const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true";
const callableOptions = {enforceAppCheck,};
export const value = 1;
`
  );
  await write(root, "firebase/functions/package.json", {
    name: "fixture-functions",
    version: "0.1.0",
  });
  await write(root, "firebase/functions/tsconfig.json", {
    compilerOptions: {},
  });
  await write(root, "firebase/package.json", {
    name: "fixture-firebase-workspace",
    private: true,
  });
  await write(
    root,
    "firebase/pnpm-workspace.yaml",
    "packages:\n  - functions\n"
  );
  await write(root, "firebase/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");

  const releaseEvidence = {
    schemaVersion: 1,
    targetMarkets: {
      googlePlay: { included: false, ...verified("fixture scope exclusion") },
      appStore: { included: false, ...verified("fixture scope exclusion") },
      appsInToss: { included: false, ...verified("MVP scope exclusion") },
    },
    artifacts: {
      googlePlaySignedAab: missing(),
      appStoreArchive: missing(),
      appsInTossPackage: missing(),
    },
    console: {
      googlePlayApp: verified(),
      appStoreConnectApp: verified(),
      appsInTossApp: missing(),
    },
    policy: {
      googlePlayDataSafety: verified(),
      appStorePrivacy: verified(),
      appsInTossCompatibility: missing(),
    },
    privacy: {
      privacyPolicy: verified(),
      accountDeletionPage: verified(),
      sensitiveHealthConsent: verified(),
    },
    manualTests: {
      googlePlayTwoPerson: verified(),
      testFlightTwoPerson: verified(),
      appsInTossSandboxTwoPerson: missing(),
    },
    approvals: { deployment: verified() },
  };
  await write(root, "release/readiness.json", releaseEvidence);

  const fingerprints = await computeFirebaseSourceFingerprints(root);
  const deploymentGitSha = await commitFixtureSource(root);
  const deploymentSource = {
    algorithm: fingerprints.algorithm,
    firebaseConfigSha256: fingerprints.firebaseConfig,
    firestoreRulesSha256: fingerprints.firestoreRules,
    firestoreIndexesSha256: fingerprints.firestoreIndexes,
    functionsSha256: fingerprints.functions,
  };
  await write(root, "firebase/release-readiness.json", {
    schemaVersion: 4,
    environment: {
      projectId: "cyclepair-fixture-prod",
      region: "asia-northeast3",
      nativeAppsRegistered: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
      },
      billingLinked: verified(),
      runtimeIamConfigured: verified(),
      callableInvokerIamConfigured: verified(),
      livePairSmoke: verified(),
      productionBillingLinked: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
      },
      productionRuntimeIamConfigured: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
      },
      productionCallableInvokerIamConfigured: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
      },
      productionLivePairSmoke: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
      },
      productionNotificationDelivery: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
        androidFcmReceived: true,
        iosApnsReceived: true,
      },
      productionGooglePlaySubscriptions: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
        developerApiVerified: true,
        rtdnVerified: true,
      },
      productionAppleSubscriptions: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
        secretsVerified: true,
        notificationsV2Verified: true,
      },
      productionAccountExport: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
        httpsInvokerVerified: true,
        cleanupSchedulerVerified: true,
        legacyExportMyDataRemoved: true,
      },
      productionProject: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
      },
      productionAuth: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
      },
      appCheckEnforcement: {
        ...verified(),
        projectId: "cyclepair-fixture-prod",
        providers: {
          android: "playIntegrity",
          apple: "appAttestWithDeviceCheckFallback",
        },
        enforcement: {
          firestore: true,
          callableFunctions: true,
        },
      },
    },
    deployment: {
      ...verified(),
      projectId: "cyclepair-fixture-prod",
      region: "asia-northeast3",
      deployedAt: "2026-07-14T00:00:00Z",
      gitSha: deploymentGitSha,
      source: deploymentSource,
    },
  });
}

test("App Review 평문 비밀번호 필드를 거부한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-review-plaintext-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.appStore = { included: true, ...verified() };
  await write(root, "release/readiness.json", readiness);
  const config = await readJsonFixture(
    root,
    "app-store/app-store.config.json"
  );
  config.review.password = "repository-plaintext-must-fail";
  await write(root, "app-store/app-store.config.json", config);

  const result = await evaluateReleaseReadiness(root);
  const appStore = result.sections.find(
    (section) => section.market === "App Store"
  );
  assert.ok(
    appStore.blockers.includes("App Review 평문 계정 필드 사용 금지")
  );
});

test("App Review credential 하위의 평문 username도 거부한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-review-nested-plaintext-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.appStore = { included: true, ...verified() };
  await write(root, "release/readiness.json", readiness);
  const config = await readJsonFixture(
    root,
    "app-store/app-store.config.json"
  );
  config.review.credentials.username = "repository-plaintext-must-fail";
  await write(root, "app-store/app-store.config.json", config);

  const result = await evaluateReleaseReadiness(root);
  const appStore = result.sections.find(
    (section) => section.market === "App Store"
  );
  assert.ok(
    appStore.blockers.includes("App Review 평문 계정 필드 사용 금지")
  );
});

test("App Review credential reference만 있고 로그인 smoke가 없으면 차단한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-review-smoke-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.appStore = { included: true, ...verified() };
  await write(root, "release/readiness.json", readiness);
  const config = await readJsonFixture(
    root,
    "app-store/app-store.config.json"
  );
  config.review.credentials.loginSmoke = missing();
  await write(root, "app-store/app-store.config.json", config);

  const result = await evaluateReleaseReadiness(root);
  const appStore = result.sections.find(
    (section) => section.market === "App Store"
  );
  assert.ok(
    appStore.blockers.includes(
      "App Review credential reference와 로그인 smoke evidence 없음"
    )
  );
});

test("모든 실제 evidence가 일치하면 ready를 계산한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cyclepair-release-ready-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);

  const result = await evaluateReleaseReadiness(root);

  assert.equal(result.ready, true, JSON.stringify(result.sections, null, 2));
  assert.equal(
    result.sections.every((section) => section.blockers.length === 0),
    true
  );
  assert.deepEqual(
    result.sections.find((section) => section.market === "AppsInToss").blockers,
    []
  );
  assert.ok(result.sourceFingerprints.firebase.firebaseConfig);
  assert.ok(result.sourceFingerprints.firebase.firestoreRules);
  assert.ok(result.sourceFingerprints.firebase.firestoreIndexes);
  assert.ok(result.sourceFingerprints.firebase.functions);
});

test("verified 문구만 있고 재조회 reference가 없으면 evidence로 인정하지 않는다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-evidence-reference-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const readiness = await readJsonFixture(root, "release/readiness.json");
  delete readiness.targetMarkets.googlePlay.reference;
  readiness.targetMarkets.googlePlay.evidence = "준비할 계획만 기록";
  await write(root, "release/readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const googlePlay = result.sections.find(
    (section) => section.market === "Google Play"
  );
  assert.ok(
    googlePlay.blockers.includes("Google Play target market 결정 evidence 없음")
  );
});

test("Android 동적 versionName의 기본값을 package version과 대조한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-dynamic-version-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const gradlePath = "apps/mobile/android/app/build.gradle";
  const gradle = await readFile(path.join(root, gradlePath), "utf8");
  await write(
    root,
    gradlePath,
    gradle
      .replace(
        "android {",
        `def releaseVersionName = (
  System.getenv("GOOGLE_PLAY_VERSION_NAME") ?:
    "0.1.0"
).toString()
throw new Error("versionName must use numeric SemVer")
android {`
      )
      .replace('versionName "0.1.0"', "versionName releaseVersionName")
  );

  const result = await evaluateReleaseReadiness(root);
  const architecture = result.sections.find(
    (section) => section.market === "Architecture"
  );

  assert.equal(
    architecture.blockers.includes(
      "Android versionName과 mobile package version 불일치"
    ),
    false,
    JSON.stringify(architecture.blockers)
  );
});

test("AppsInToss 실제 AIT metadata와 payload 무결성이 일치하면 통과한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-ait-valid-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await configureAppsInTossReadyFixture(root, await createAppsInTossArtifact());

  const result = await evaluateReleaseReadiness(root);
  const appsInToss = result.sections.find(
    (section) => section.market === "AppsInToss"
  );

  assert.deepEqual(appsInToss.blockers, []);
});

test("hash만 맞는 임의 파일은 AppsInToss package가 아니다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-ait-fake-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await configureAppsInTossReadyFixture(root, Buffer.from("not an AIT bundle"));

  const result = await evaluateReleaseReadiness(root);
  const appsInToss = result.sections.find(
    (section) => section.market === "AppsInToss"
  );

  assert.ok(
    appsInToss.blockers.includes("AppsInToss package AIT 포맷 검증 실패")
  );
});

test("provisional appName과 placeholder icon은 AIT가 유효해도 차단한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-ait-provisional-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await configureAppsInTossReadyFixture(
    root,
    await createAppsInTossArtifact(),
    {
      appNameStatus: "provisional-console-match-required",
      icon: "https://placehold.co/600x600.png",
    }
  );

  const result = await evaluateReleaseReadiness(root);
  const appsInToss = result.sections.find(
    (section) => section.market === "AppsInToss"
  );

  assert.ok(
    appsInToss.blockers.includes(
      "AppsInToss appName Console 대조 미확정 또는 불일치"
    )
  );
  assert.ok(appsInToss.blockers.includes("AppsInToss 정식 icon 미설정"));
});

test("TDS가 package와 AIT metadata 양쪽에서 빠져도 차단한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-ait-missing-tds-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await configureAppsInTossReadyFixture(
    root,
    await createAppsInTossArtifact({ tdsVersion: null }),
    { tdsVersion: null }
  );

  const result = await evaluateReleaseReadiness(root);
  const appsInToss = result.sections.find(
    (section) => section.market === "AppsInToss"
  );

  assert.ok(
    appsInToss.blockers.includes(
      "AppsInToss package SDK 2.x / RN 0.84 / TDS metadata 불일치"
    )
  );
});

test("React Native가 아닌 AIT platform metadata를 차단한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-ait-web-platform-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await configureAppsInTossReadyFixture(
    root,
    await createAppsInTossArtifact({ platform: PlatformType.WEB })
  );

  const result = await evaluateReleaseReadiness(root);
  const appsInToss = result.sections.find(
    (section) => section.market === "AppsInToss"
  );

  assert.ok(
    appsInToss.blockers.includes(
      "AppsInToss package SDK 2.x / RN 0.84 / TDS metadata 불일치"
    )
  );
});

test("운영 Firebase project ID가 없으면 ready가 될 수 없다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-prod-project-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const environments = await readJsonFixture(
    root,
    "apps/mobile/firebase-environments.json"
  );
  environments.projectId = null;
  await write(root, "apps/mobile/firebase-environments.json", environments);

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes("Firebase 단일 project ID 미확정 또는 불일치")
  );
});

test("운영 native Firebase config가 없으면 ready가 될 수 없다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-prod-native-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await rm(
    path.join(root, "apps/mobile/android/app/google-services.json"),
    { force: true }
  );
  await rm(
    path.join(root, "apps/mobile/ios/Firebase/GoogleService-Info.plist"),
    { force: true }
  );

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(firebase.blockers.includes("Android Firebase config 파일 없음"));
  assert.ok(firebase.blockers.includes("iOS Firebase config 파일 없음"));
});

test("Android Release Firebase variant guard가 없으면 ready가 될 수 없다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-android-selection-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const gradlePath = "apps/mobile/android/app/build.gradle";
  const gradle = await readFile(path.join(root, gradlePath), "utf8");
  await write(
    root,
    gradlePath,
    gradle.replace("processReleaseGoogleServices", "processOtherGoogleServices")
  );

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.some((blocker) =>
      blocker.includes("processReleaseGoogleServices")
    )
  );
});

test("iOS Release Firebase embed 선택이 없으면 ready가 될 수 없다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-ios-selection-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const projectPath = "apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj";
  const project = await readFile(path.join(root, projectPath), "utf8");
  await write(
    root,
    projectPath,
    project.replaceAll(
      "FIREBASE_CONFIG_PATH = Firebase/GoogleService-Info.plist;",
      "FIREBASE_CONFIG_PATH = Firebase/Wrong/GoogleService-Info.plist;"
    )
  );

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.some((blocker) =>
      blocker.includes("Firebase/GoogleService-Info.plist")
    )
  );
});

test("운영 Firebase 배포 evidence가 없으면 ready가 될 수 없다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-prod-deployment-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const readiness = await readJsonFixture(
    root,
    "firebase/release-readiness.json"
  );
  delete readiness.deployment;
  await write(root, "firebase/release-readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes(
      "단일 Firebase 배포 evidence가 stale 또는 미검증"
    )
  );
});

test("App Check dependency가 없으면 문자열 evidence만으로 ready가 될 수 없다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cyclepair-app-check-dep-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const mobilePackage = await readJsonFixture(root, "apps/mobile/package.json");
  delete mobilePackage.dependencies["@react-native-firebase/app-check"];
  await write(root, "apps/mobile/package.json", mobilePackage);

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes("RNFirebase App Check 25.1.0 dependency 미확정")
  );
});

test("App Check production provider source drift를 차단한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-app-check-provider-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const sourcePath =
    "apps/mobile/src/platform/firebase/FirebaseAppCheckBootstrap.ts";
  const source = await readFile(path.join(root, sourcePath), "utf8");
  await write(root, sourcePath, source.replace("playIntegrity", "debug"));

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes(
      "App Check 환경별 client initialization source 미검증"
    )
  );
});

test("App Check provider 객체의 formatter 공백은 evidence를 깨뜨리지 않는다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-app-check-provider-spacing-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const sourcePath =
    "apps/mobile/src/platform/firebase/FirebaseAppCheckBootstrap.ts";
  const source = await readFile(path.join(root, sourcePath), "utf8");
  await write(root, sourcePath, source.replaceAll("{provider:", "{ provider:"));

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, true);
  assert.ok(
    !firebase.blockers.includes(
      "App Check 환경별 client initialization source 미검증"
    )
  );
});

test("App Check 운영 강제 evidence는 project/provider/service에 결합한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-app-check-enforcement-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const readiness = await readJsonFixture(
    root,
    "firebase/release-readiness.json"
  );
  readiness.environment.appCheckEnforcement =
    verified("문자열만 있는 수동 확인");
  await write(root, "firebase/release-readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes("App Check 운영 강제 project ID 불일치")
  );
  assert.ok(
    firebase.blockers.includes(
      "App Check 운영 attestation provider evidence 불일치"
    )
  );
  assert.ok(firebase.blockers.includes("Firestore App Check 운영 강제 미검증"));
  assert.ok(
    firebase.blockers.includes("Callable Functions App Check 운영 강제 미검증")
  );
});

test("비대상 마켓도 제외 결정 evidence가 없으면 blocker다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cyclepair-release-scope-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const releaseEvidence = JSON.parse(
    await readFile(path.join(root, "release/readiness.json"), "utf8")
  );
  releaseEvidence.targetMarkets.appsInToss = {
    included: false,
    ...missing(),
  };
  await write(root, "release/readiness.json", releaseEvidence);

  const result = await evaluateReleaseReadiness(root);
  const appsInToss = result.sections.find(
    (section) => section.market === "AppsInToss"
  );

  assert.equal(result.ready, false);
  assert.deepEqual(appsInToss.blockers, [
    "AppsInToss target market 결정 evidence 없음",
  ]);
});

test("App Store bundle ID와 Xcode identifier drift를 차단한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cyclepair-release-ios-id-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const releaseEvidence = await readJsonFixture(root, "release/readiness.json");
  releaseEvidence.targetMarkets.appStore = {
    included: true,
    ...verified(),
  };
  await write(root, "release/readiness.json", releaseEvidence);
  await write(
    root,
    "apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj",
    "MARKETING_VERSION = 0.1.0;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.drift;\n"
  );

  const result = await evaluateReleaseReadiness(root);
  const appStore = result.sections.find(
    (section) => section.market === "App Store"
  );

  assert.equal(result.ready, false);
  assert.ok(
    appStore.blockers.includes(
      "App Store bundleId와 Xcode PRODUCT_BUNDLE_IDENTIFIER 불일치"
    )
  );
});

test("Rules source 변경은 이전 배포 evidence를 즉시 stale로 만든다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cyclepair-release-rules-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(
    root,
    "firebase/firestore.rules",
    'rules_version = "2";\n// repository source changed\n'
  );

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes(
      "단일 현재 Firestore Rules source와 배포 evidence 불일치"
    )
  );
});

test("Firestore indexes 변경은 이전 배포 evidence를 즉시 stale로 만든다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cyclepair-release-indexes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(root, "firebase/firestore.indexes.json", {
    indexes: [{ collectionGroup: "changed" }],
    fieldOverrides: [],
  });

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes(
      "단일 현재 Firestore indexes source와 배포 evidence 불일치"
    )
  );
});

test("root firebase.json 변경은 이전 배포 evidence를 즉시 stale로 만든다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-firebase-json-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(root, "firebase.json", {
    firestore: {
      rules: "firebase/firestore.rules",
      indexes: "firebase/firestore.indexes.json",
    },
    functions: [{ source: "firebase/functions", runtime: "nodejs24" }],
  });

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes(
      "단일 현재 firebase.json source와 배포 evidence 불일치"
    )
  );
});

test("Functions source 변경은 이전 배포 evidence를 즉시 stale로 만든다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-functions-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(
    root,
    "firebase/functions/src/index.ts",
    "export const value = 2;\n"
  );

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes(
      "단일 현재 Cloud Functions source와 배포 evidence 불일치"
    )
  );
});

test("Firebase workspace lockfile 변경은 Functions 배포 evidence를 stale 처리한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-functions-lock-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(
    root,
    "firebase/pnpm-lock.yaml",
    "lockfileVersion: '9.0'\n# dependency graph changed\n"
  );

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes(
      "단일 현재 Cloud Functions source와 배포 evidence 불일치"
    )
  );
  assert.ok(
    firebase.blockers.includes(
      "단일 Firebase 배포 gitSha commit과 현재 deployment source 불일치"
    )
  );
});

test("root mobile workspace lockfile 변경은 Functions fingerprint를 바꾸지 않는다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-root-lock-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const before = await computeFirebaseSourceFingerprints(root);
  await write(
    root,
    "pnpm-lock.yaml",
    "lockfileVersion: '9.0'\n# mobile importer changed\n"
  );

  const after = await computeFirebaseSourceFingerprints(root);
  const result = await evaluateReleaseReadiness(root);

  assert.equal(after.functions, before.functions);
  assert.equal(result.ready, true);
});

test("firebase.json emulator-only 변경은 deployment fingerprint를 바꾸지 않는다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-emulator-config-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const before = await computeFirebaseSourceFingerprints(root);
  const config = await readJsonFixture(root, "firebase.json");
  config.emulators = {
    firestore: { port: 9399 },
    functions: { port: 5301 },
    ui: { enabled: false },
  };
  await write(root, "firebase.json", config);

  const after = await computeFirebaseSourceFingerprints(root);
  const result = await evaluateReleaseReadiness(root);

  assert.equal(after.firebaseConfig, before.firebaseConfig);
  assert.equal(result.ready, true);
});

test("개발 evidence를 운영 capability evidence로 재사용할 수 없다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-prod-capabilities-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const readiness = await readJsonFixture(
    root,
    "firebase/release-readiness.json"
  );
  for (const key of [
    "productionBillingLinked",
    "productionRuntimeIamConfigured",
    "productionCallableInvokerIamConfigured",
    "productionLivePairSmoke",
    "productionNotificationDelivery",
    "productionGooglePlaySubscriptions",
    "productionAppleSubscriptions",
    "productionAccountExport",
  ]) {
    delete readiness.environment[key];
  }
  await write(root, "firebase/release-readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  for (const blocker of [
    "운영 Firebase 결제 계정 연결 live evidence 없음",
    "운영 Functions runtime IAM live evidence 없음",
    "운영 Callable invoker IAM live evidence 없음",
    "운영 Pair smoke live evidence 없음",
    "운영 Android FCM 실제 수신 미검증",
    "운영 iOS APNs 실제 수신 미검증",
    "운영 Google Play Developer API 미검증",
    "운영 Google Play RTDN 미검증",
    "운영 Apple subscription secrets 미검증",
    "운영 App Store Server Notifications V2 미검증",
    "운영 export HTTPS invoker IAM 미검증",
    "운영 export cleanup scheduler 미검증",
    "legacy exportMyData callable 제거 미검증",
  ]) {
    assert.ok(firebase.blockers.includes(blocker), blocker);
  }
});

test("운영 capability evidence는 production project ID에 결합한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-prod-capability-project-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const readiness = await readJsonFixture(
    root,
    "firebase/release-readiness.json"
  );
  readiness.environment.productionBillingLinked.projectId =
    "cyclepair-fixture-dev";
  await write(root, "firebase/release-readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes("운영 Firebase 결제 계정 연결 project ID 불일치")
  );
});

test("Firebase 배포 evidence는 gitSha, region, deployedAt을 검증한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-deployment-provenance-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const readiness = await readJsonFixture(
    root,
    "firebase/release-readiness.json"
  );
  readiness.deployment.gitSha = "not-a-git-sha";
  readiness.deployment.region = "us-central1";
  readiness.deployment.deployedAt = "2026-07-14";
  await write(root, "firebase/release-readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes("단일 Firebase 배포 region evidence 불일치")
  );
  assert.ok(
    firebase.blockers.includes(
      "단일 Firebase 배포 gitSha evidence 없음 또는 형식 오류"
    )
  );
  assert.ok(
    firebase.blockers.includes(
      "단일 Firebase deployedAt RFC 3339 evidence 없음"
    )
  );
});

test("형식만 맞는 gitSha는 현재 repository commit evidence가 아니다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-deployment-unknown-commit-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const readiness = await readJsonFixture(
    root,
    "firebase/release-readiness.json"
  );
  readiness.deployment.gitSha = "f".repeat(40);
  await write(root, "firebase/release-readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const firebase = result.sections.find(
    (section) => section.market === "Firebase"
  );

  assert.equal(result.ready, false);
  assert.ok(
    firebase.blockers.includes(
      "단일 Firebase 배포 gitSha가 현재 repo commit에 없음"
    )
  );
});

test("payload 문자열로 위조한 AAB entry 이름은 central directory evidence가 아니다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-aab-entry-spoof-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(
    root,
    "artifacts/cyclepair.aab",
    createStoredZip({
      "payload.txt":
        "BundleConfig.pb base/manifest/AndroidManifest.xml base/dex/classes.dex",
    })
  );
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.googlePlay = { included: true, ...verified() };
  readiness.artifacts.googlePlaySignedAab = androidArtifactEvidence(
    await hash(root, "artifacts/cyclepair.aab")
  );
  await write(root, "release/readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const googlePlay = result.sections.find(
    (section) => section.market === "Google Play"
  );

  assert.equal(result.ready, false);
  assert.ok(
    googlePlay.blockers.includes(
      "서명된 Android AAB 필수 archive entry 누락: BundleConfig.pb"
    )
  );
});

test("실제 jarsigner 서명과 manifest/DEX가 일치하는 AAB evidence는 통과한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-aab-signed-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(
    root,
    "artifacts/cyclepair.aab",
    createStoredZip(unsignedAabEntries())
  );
  const certificateSha256 = await signFixtureAab(root);
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.googlePlay = { included: true, ...verified() };
  readiness.artifacts.googlePlaySignedAab = androidArtifactEvidence(
    await hash(root, "artifacts/cyclepair.aab")
  );
  readiness.artifacts.googlePlaySignedAab.signing.certificateSha256 =
    certificateSha256;
  await write(root, "release/readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);

  assert.equal(result.ready, true, JSON.stringify(result.sections, null, 2));
  assert.deepEqual(
    result.sections.find((section) => section.market === "Google Play")
      .blockers,
    []
  );
});

test("구조만 갖춘 unsigned AAB는 release artifact가 아니다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-aab-unsigned-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(
    root,
    "artifacts/cyclepair.aab",
    createStoredZip(unsignedAabEntries())
  );
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.googlePlay = { included: true, ...verified() };
  readiness.artifacts.googlePlaySignedAab = androidArtifactEvidence(
    await hash(root, "artifacts/cyclepair.aab")
  );
  await write(root, "release/readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const googlePlay = result.sections.find(
    (section) => section.market === "Google Play"
  );

  assert.equal(result.ready, false);
  assert.ok(
    googlePlay.blockers.includes("서명된 Android AAB JAR signature entry 누락")
  );
});

test("가짜 META-INF 파일은 jarsigner 실제 검증을 통과하지 못한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-aab-fake-signature-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  const fakeManifest = `Manifest-Version: 1.0

Name: BundleConfig.pb
SHA-256-Digest: AAA=

Name: base/manifest/AndroidManifest.xml
SHA-256-Digest: AAA=

Name: base/dex/classes.dex
SHA-256-Digest: AAA=
`;
  await write(
    root,
    "artifacts/cyclepair.aab",
    createStoredZip(
      unsignedAabEntries({
        "META-INF/MANIFEST.MF": fakeManifest,
        "META-INF/FIXTURE.SF": "not a signature file",
        "META-INF/FIXTURE.RSA": "not a signature block",
      })
    )
  );
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.googlePlay = { included: true, ...verified() };
  readiness.artifacts.googlePlaySignedAab = androidArtifactEvidence(
    await hash(root, "artifacts/cyclepair.aab")
  );
  await write(root, "release/readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const googlePlay = result.sections.find(
    (section) => section.market === "Google Play"
  );

  assert.equal(result.ready, false);
  assert.ok(
    googlePlay.blockers.includes(
      "서명된 Android AAB JAR signature verification 실패"
    )
  );
});

test("AAB protobuf manifest의 실제 package/version drift를 차단한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-aab-manifest-drift-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(
    root,
    "artifacts/cyclepair.aab",
    createStoredZip(
      unsignedAabEntries({
        "base/manifest/AndroidManifest.xml": createAabManifest({
          packageName: "com.example.drift",
          versionName: "9.9.9",
          versionCode: 999,
        }),
      })
    )
  );
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.googlePlay = { included: true, ...verified() };
  readiness.artifacts.googlePlaySignedAab = androidArtifactEvidence(
    await hash(root, "artifacts/cyclepair.aab")
  );
  await write(root, "release/readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const googlePlay = result.sections.find(
    (section) => section.market === "Google Play"
  );

  assert.equal(result.ready, false);
  assert.ok(
    googlePlay.blockers.includes(
      "서명된 Android AAB 실제 manifest package/version 불일치"
    )
  );
});

test("xcarchive 내부 Info.plist bundle ID drift를 실제 추출해 차단한다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-xcarchive-plist-drift-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(
    root,
    "artifacts/cyclepair.xcarchive.zip",
    createStoredZip(xcarchiveEntries("com.example.drift"))
  );
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.appStore = { included: true, ...verified() };
  readiness.artifacts.appStoreArchive = appStoreArtifactEvidence(
    await hash(root, "artifacts/cyclepair.xcarchive.zip")
  );
  await write(root, "release/readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const appStore = result.sections.find(
    (section) => section.market === "App Store"
  );

  assert.equal(result.ready, false);
  assert.ok(
    appStore.blockers.includes(
      process.platform === "darwin"
        ? "App Store archive 실제 plist bundle/version/team 불일치"
        : "App Store archive 검증은 macOS codesign 환경 필요"
    )
  );
});

test("xcarchive plist가 맞아도 실제 codesign 검증 없이는 ready가 아니다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-xcarchive-codesign-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(
    root,
    "artifacts/cyclepair.xcarchive.zip",
    createStoredZip(xcarchiveEntries())
  );
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.appStore = { included: true, ...verified() };
  readiness.artifacts.appStoreArchive = appStoreArtifactEvidence(
    await hash(root, "artifacts/cyclepair.xcarchive.zip")
  );
  await write(root, "release/readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const appStore = result.sections.find(
    (section) => section.market === "App Store"
  );

  assert.equal(result.ready, false);
  assert.ok(
    appStore.blockers.includes(
      process.platform === "darwin"
        ? "App Store archive plist/codesign 실제 검증 실패"
        : "App Store archive 검증은 macOS codesign 환경 필요"
    )
  );
});

test("plain text AAB와 archive는 hash가 맞아도 release ready가 아니다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-artifact-structure-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(root, "artifacts/cyclepair.aab", "plain text aab\n");
  await write(
    root,
    "artifacts/cyclepair.xcarchive.zip",
    "plain text archive\n"
  );
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.googlePlay = { included: true, ...verified() };
  readiness.targetMarkets.appStore = { included: true, ...verified() };
  readiness.artifacts.googlePlaySignedAab = {
    ...verified(),
    path: "artifacts/cyclepair.aab",
    sha256: await hash(root, "artifacts/cyclepair.aab"),
    format: "android-app-bundle",
    packageName: "com.seorilabs.cyclepair",
    versionName: "0.1.0",
    versionCode: 1,
    signing: { certificateSha256: "a".repeat(64) },
  };
  readiness.artifacts.appStoreArchive = {
    ...verified(),
    path: "artifacts/cyclepair.xcarchive.zip",
    sha256: await hash(root, "artifacts/cyclepair.xcarchive.zip"),
    format: "xcarchive-zip",
    bundleId: "com.seorilabs.cyclepair",
    marketingVersion: "0.1.0",
    buildNumber: 1,
    signing: { teamId: "FIXTURETEAM" },
  };
  await write(root, "release/readiness.json", readiness);

  const result = await evaluateReleaseReadiness(root);
  const googlePlay = result.sections.find(
    (section) => section.market === "Google Play"
  );
  const appStore = result.sections.find(
    (section) => section.market === "App Store"
  );

  assert.equal(result.ready, false);
  assert.ok(
    googlePlay.blockers.includes(
      "서명된 Android AAB central directory 구조 검증 실패"
    )
  );
  assert.ok(
    appStore.blockers.includes(
      "App Store archive central directory 구조 검증 실패"
    )
  );
});

test("artifact hash 불일치는 release ready로 오인하지 않는다", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "cyclepair-release-artifact-")
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  await createReadyFixture(root);
  await write(root, "artifacts/cyclepair.aab", "original artifact\n");
  const readiness = await readJsonFixture(root, "release/readiness.json");
  readiness.targetMarkets.googlePlay = { included: true, ...verified() };
  readiness.artifacts.googlePlaySignedAab = {
    ...verified(),
    path: "artifacts/cyclepair.aab",
    sha256: await hash(root, "artifacts/cyclepair.aab"),
    format: "android-app-bundle",
    packageName: "com.seorilabs.cyclepair",
    versionName: "0.1.0",
    versionCode: 1,
    signing: { certificateSha256: "a".repeat(64) },
  };
  await write(root, "release/readiness.json", readiness);
  await write(root, "artifacts/cyclepair.aab", "different artifact\n");

  const result = await evaluateReleaseReadiness(root);
  const googlePlay = result.sections.find(
    (section) => section.market === "Google Play"
  );

  assert.equal(result.ready, false);
  assert.ok(googlePlay.blockers.includes("서명된 Android AAB SHA-256 불일치"));
});

test("운영 Firebase smoke는 현재 Rules 문서 계약을 사용한다", async () => {
  const source = await readFile(
    new URL("./smoke-live-firebase.mjs", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /CYCLEPAIR_FIREBASE_PROJECT \?\? 'seorilabs-cyclepair-prod'/
  );
  assert.match(source, /setToServerValue:\s*'REQUEST_TIME'/);
  assert.match(source, /schemaVersion:\s*1/);
  assert.match(source, /recordsCycle:\s*true/);
  assert.match(source, /consentAcceptedAt:/);
  assert.match(source, /averageCycleLength:\s*28/);
  assert.match(source, /averagePeriodLength:\s*5/);
  assert.match(source, /schemaVersion:\s*2/);
  assert.match(source, /lastMutationId:\s*'live-smoke-daily'/);
  assert.match(source, /nextPeriodWindow:\s*enabled/);
  assert.match(source, /carePreferences:\s*enabled/);
  assert.doesNotMatch(source, /privateDailyLogs\/live-smoke/);
});
