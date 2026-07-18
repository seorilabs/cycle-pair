import {access, readFile} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import process from 'node:process';

import {assertNativeFirebaseSelectionStructure} from './native-firebase-selection-lib.mjs';

const ROOT_CONFIG_PATH = 'firebase.json';
const MOBILE_CONFIG_PATH = 'apps/mobile/firebase.json';
const ENVIRONMENT_MANIFEST_PATH = 'apps/mobile/firebase-environments.json';
const EXPECTED_CONFIG_PATHS = Object.freeze({
  development: Object.freeze({
    androidConfig: 'android/app/src/debug/google-services.json',
    iosConfig: 'ios/Firebase/Debug/GoogleService-Info.plist',
  }),
  production: Object.freeze({
    androidConfig: 'android/app/src/release/google-services.json',
    iosConfig: 'ios/Firebase/Release/GoogleService-Info.plist',
  }),
});
const REQUIRED_DISABLED_DEFAULTS = Object.freeze({
  app_data_collection_default_enabled: false,
  analytics_auto_collection_enabled: false,
  google_analytics_automatic_screen_reporting_enabled: false,
  crashlytics_auto_collection_enabled: false,
  crashlytics_debug_enabled: false,
  crashlytics_ndk_enabled: false,
  messaging_auto_init_enabled: false,
  messaging_ios_auto_register_for_remote_messages: false,
});
const REQUIRED_SECURITY_DEFAULTS = Object.freeze({
  app_check_token_auto_refresh: true,
});

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertPrivacyDefaults(config, label) {
  const reactNative = config?.['react-native'];
  if (reactNative === undefined || typeof reactNative !== 'object') {
    throw new Error(`${label}에 react-native 설정이 없습니다.`);
  }
  for (const [key, expected] of Object.entries(REQUIRED_DISABLED_DEFAULTS)) {
    if (reactNative[key] !== expected) {
      throw new Error(`${label}의 react-native.${key}는 false여야 합니다.`);
    }
  }
  for (const [key, expected] of Object.entries(REQUIRED_SECURITY_DEFAULTS)) {
    if (reactNative[key] !== expected) {
      throw new Error(`${label}의 react-native.${key}는 true여야 합니다.`);
    }
  }
  return reactNative;
}

function assertNonEmptyString(value, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message);
  }
  return value;
}

function assertEnvironmentManifest(manifest) {
  if (manifest?.schemaVersion !== 1) {
    throw new Error(`${ENVIRONMENT_MANIFEST_PATH} schemaVersion은 1이어야 합니다.`);
  }
  const permanentAppId = assertNonEmptyString(
    manifest.permanentAppId,
    `${ENVIRONMENT_MANIFEST_PATH}에 permanentAppId가 없습니다.`,
  );
  if (permanentAppId !== 'com.seorilabs.cyclepair') {
    throw new Error('Cycle Pair의 영구 package/bundle ID가 변경됐습니다.');
  }

  for (const environmentName of ['development', 'production']) {
    const environment = manifest[environmentName];
    if (environment === undefined || typeof environment !== 'object') {
      throw new Error(`${ENVIRONMENT_MANIFEST_PATH}에 ${environmentName}가 없습니다.`);
    }
    for (const key of ['androidConfig', 'iosConfig']) {
      if (environment[key] !== EXPECTED_CONFIG_PATHS[environmentName][key]) {
        throw new Error(
          `${environmentName}.${key}는 명시적인 Debug/Release 경로여야 합니다.`,
        );
      }
    }
  }

  const developmentProjectId = assertNonEmptyString(
    manifest.development.projectId,
    'development Firebase project ID가 없습니다.',
  );
  if (manifest.production.projectId !== null &&
      (typeof manifest.production.projectId !== 'string' ||
       manifest.production.projectId.trim() === '')) {
    throw new Error('production.projectId는 확정된 문자열 또는 null이어야 합니다.');
  }
  if (manifest.production.projectId === developmentProjectId) {
    throw new Error('production Firebase project는 development와 달라야 합니다.');
  }
  return permanentAppId;
}

function assertTrackedProjectId(projectId, environmentName, manifest) {
  const expectedProjectId = manifest[environmentName].projectId;
  if (typeof expectedProjectId !== 'string' || expectedProjectId.trim() === '') {
    throw new Error(
      `${environmentName} Firebase config 사용 전 ${ENVIRONMENT_MANIFEST_PATH}의 projectId를 확정해야 합니다.`,
    );
  }
  if (projectId !== expectedProjectId) {
    throw new Error(
      `${environmentName} Firebase config가 tracked project ID와 일치하지 않습니다.`,
    );
  }
  if (environmentName === 'production' &&
      projectId === manifest.development.projectId) {
    throw new Error('Release config는 development Firebase project를 사용할 수 없습니다.');
  }
}

async function assertAndroidConfig(path, environmentName, manifest) {
  const config = await readJson(path);
  const projectId = assertNonEmptyString(
    config?.project_info?.project_id,
    `${environmentName} Android Firebase config에 project_id가 없습니다.`,
  );
  const client = Array.isArray(config?.client)
    ? config.client.find(candidate => (
      candidate?.client_info?.android_client_info?.package_name ===
        manifest.permanentAppId
    ))
    : undefined;
  assertNonEmptyString(
    client?.client_info?.mobilesdk_app_id,
    `${environmentName} Android Firebase config에 영구 앱 ID용 client가 없습니다.`,
  );
  assertTrackedProjectId(projectId, environmentName, manifest);
  return projectId;
}

function decodeXml(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readXmlPlistString(xml, key) {
  const pattern = new RegExp(
    `<key>\\s*${escapeRegExp(key)}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`,
  );
  const match = xml.match(pattern);
  return match === null ? undefined : decodeXml(match[1].trim());
}

async function assertIosConfig(path, environmentName, manifest) {
  const xml = await readFile(path, 'utf8');
  const projectId = assertNonEmptyString(
    readXmlPlistString(xml, 'PROJECT_ID'),
    `${environmentName} iOS Firebase config에 PROJECT_ID가 없습니다.`,
  );
  if (readXmlPlistString(xml, 'BUNDLE_ID') !== manifest.permanentAppId) {
    throw new Error(
      `${environmentName} iOS Firebase config가 영구 bundle ID를 대상으로 하지 않습니다.`,
    );
  }
  assertNonEmptyString(
    readXmlPlistString(xml, 'GOOGLE_APP_ID'),
    `${environmentName} iOS Firebase config에 GOOGLE_APP_ID가 없습니다.`,
  );
  assertTrackedProjectId(projectId, environmentName, manifest);
  return projectId;
}

function plistJson(path) {
  if (process.platform !== 'darwin') {
    throw new Error('built Info.plist 검증은 macOS의 plutil이 필요합니다.');
  }
  const result = spawnSync(
    'plutil',
    ['-convert', 'json', '-o', '-', path],
    {encoding: 'utf8'},
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${path}를 읽을 수 없습니다.`);
  }
  return JSON.parse(result.stdout);
}

function inferBuiltEnvironment(projectId, manifest) {
  for (const environmentName of ['development', 'production']) {
    if (manifest[environmentName].projectId === projectId) {
      return environmentName;
    }
  }
  throw new Error('built Firebase plist의 environment를 tracked project ID에서 찾을 수 없습니다.');
}

function assertBuiltInfoPlist(path, requestedEnvironment, manifest) {
  const plist = plistJson(path);
  const expectedPlistValues = {
    FirebaseDataCollectionDefaultEnabled: false,
    FirebaseAppCheckTokenAutoRefreshEnabled: true,
    FIREBASE_ANALYTICS_COLLECTION_ENABLED: false,
    FirebaseAutomaticScreenReportingEnabled: false,
    FirebaseCrashlyticsCollectionEnabled: false,
    FirebaseMessagingAutoInitEnabled: false,
  };
  for (const [key, expected] of Object.entries(expectedPlistValues)) {
    if (plist[key] !== expected) {
      throw new Error(
        `${path}의 ${key}가 ${String(expected)}로 빌드되지 않았습니다.`,
      );
    }
  }
  if (plist.CFBundleIdentifier !== manifest.permanentAppId) {
    throw new Error('built app이 Cycle Pair 영구 bundle ID를 사용하지 않습니다.');
  }

  if (typeof plist.firebase_json_raw !== 'string') {
    throw new Error(`${path}에 RNFirebase firebase_json_raw가 없습니다.`);
  }
  let embeddedConfig;
  try {
    embeddedConfig = JSON.parse(
      Buffer.from(plist.firebase_json_raw, 'base64').toString('utf8'),
    );
  } catch {
    throw new Error(`${path}의 firebase_json_raw를 해석할 수 없습니다.`);
  }
  assertPrivacyDefaults(
    {'react-native': embeddedConfig},
    `${path} embedded firebase.json`,
  );

  const googleServicePath = join(dirname(path), 'GoogleService-Info.plist');
  const googleServicePlist = plistJson(googleServicePath);
  if (googleServicePlist.BUNDLE_ID !== manifest.permanentAppId) {
    throw new Error('built GoogleService-Info.plist의 bundle ID가 올바르지 않습니다.');
  }
  const projectId = assertNonEmptyString(
    googleServicePlist.PROJECT_ID,
    'built GoogleService-Info.plist에 PROJECT_ID가 없습니다.',
  );
  assertNonEmptyString(
    googleServicePlist.GOOGLE_APP_ID,
    'built GoogleService-Info.plist에 GOOGLE_APP_ID가 없습니다.',
  );
  const environmentName = requestedEnvironment ??
    inferBuiltEnvironment(projectId, manifest);
  assertTrackedProjectId(projectId, environmentName, manifest);
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--built-plist') {
      if (value === undefined) {
        throw new Error('--built-plist 다음에 Info.plist 경로가 필요합니다.');
      }
      options.builtPlistPath = value;
      index += 1;
    } else if (arg === '--built-environment') {
      if (!['development', 'production'].includes(value)) {
        throw new Error('--built-environment는 development 또는 production이어야 합니다.');
      }
      options.builtEnvironment = value;
      index += 1;
    } else if (arg === '--require-environment') {
      if (!['development', 'production'].includes(value)) {
        throw new Error('--require-environment는 development 또는 production이어야 합니다.');
      }
      options.requiredEnvironment = value;
      index += 1;
    } else {
      throw new Error(`알 수 없는 인자: ${arg}`);
    }
  }
  if (options.builtEnvironment !== undefined && options.builtPlistPath === undefined) {
    throw new Error('--built-environment는 --built-plist와 함께 사용해야 합니다.');
  }
  return options;
}

async function validateEnvironmentConfigs(manifest, requiredEnvironment) {
  for (const environmentName of ['development', 'production']) {
    const environment = manifest[environmentName];
    const androidPath = `apps/mobile/${environment.androidConfig}`;
    const iosPath = `apps/mobile/${environment.iosConfig}`;
    const [hasAndroid, hasIos] = await Promise.all([
      exists(androidPath),
      exists(iosPath),
    ]);

    if (requiredEnvironment === environmentName && (!hasAndroid || !hasIos)) {
      throw new Error(
        `${environmentName} native Firebase config가 Android와 iOS에 모두 필요합니다.`,
      );
    }

    const [androidProjectId, iosProjectId] = await Promise.all([
      hasAndroid
        ? assertAndroidConfig(androidPath, environmentName, manifest)
        : undefined,
      hasIos
        ? assertIosConfig(iosPath, environmentName, manifest)
        : undefined,
    ]);
    if (androidProjectId !== undefined && iosProjectId !== undefined &&
        androidProjectId !== iosProjectId) {
      throw new Error(
        `${environmentName} Android와 iOS Firebase project가 다릅니다.`,
      );
    }
  }
}

const options = parseArgs(process.argv.slice(2));
const [rootConfig, mobileConfig, environmentManifest] = await Promise.all([
  readJson(ROOT_CONFIG_PATH),
  readJson(MOBILE_CONFIG_PATH),
  readJson(ENVIRONMENT_MANIFEST_PATH),
]);
const rootReactNative = assertPrivacyDefaults(rootConfig, ROOT_CONFIG_PATH);
const mobileReactNative = assertPrivacyDefaults(mobileConfig, MOBILE_CONFIG_PATH);
if (canonicalJson(rootReactNative) !== canonicalJson(mobileReactNative)) {
  throw new Error(
    `${ROOT_CONFIG_PATH}와 ${MOBILE_CONFIG_PATH}의 react-native 설정이 다릅니다.`,
  );
}
if (Object.keys(mobileConfig).some(key => key !== 'react-native')) {
  throw new Error(`${MOBILE_CONFIG_PATH}에는 react-native 설정만 둘 수 있습니다.`);
}

assertEnvironmentManifest(environmentManifest);
await assertNativeFirebaseSelectionStructure(process.cwd(), environmentManifest);
await validateEnvironmentConfigs(
  environmentManifest,
  options.requiredEnvironment,
);
if (options.builtPlistPath !== undefined) {
  assertBuiltInfoPlist(
    options.builtPlistPath,
    options.builtEnvironment,
    environmentManifest,
  );
}

console.log(
  options.builtPlistPath === undefined
    ? 'RNFirebase privacy and native environment selection check passed.'
    : 'RNFirebase privacy, environment selection, and built app checks passed.',
);
