#!/usr/bin/env node
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST_PATH = resolve(ROOT, 'apps/mobile/firebase-environments.json');
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const expectedPackage = manifest.permanentAppId;
const expectedProject = manifest.production.projectId;

function parseArgs(argv) {
  const args = new Set(argv);
  const requireConfig = args.delete('--require');
  const restoreAll = args.delete('--all');
  const restoreAndroid = restoreAll || args.delete('--android');
  const restoreIos = restoreAll || args.delete('--ios');
  if (args.size > 0 || (!restoreAndroid && !restoreIos)) {
    throw new Error(
      '사용법: restore-mobile-firebase-config.mjs --android|--ios|--all [--require]',
    );
  }
  return {requireConfig, restoreAndroid, restoreIos};
}

function decodeEnvironment(name, required) {
  const encoded = process.env[name]?.trim();
  if (!encoded) {
    if (required) {
      throw new Error(`${name} secret이 필요합니다.`);
    }
    console.log(`${name}이 없어 복원을 건너뜁니다.`);
    return null;
  }
  return Buffer.from(encoded, 'base64');
}

function writeConfig(relativePath, content) {
  const outputPath = resolve(ROOT, 'apps/mobile', relativePath);
  mkdirSync(dirname(outputPath), {recursive: true});
  writeFileSync(outputPath, content, {mode: 0o600});
  console.log(`${relativePath} 복원 완료`);
}

function validateAndroid(content) {
  const config = JSON.parse(content.toString('utf8'));
  if (config?.project_info?.project_id !== expectedProject) {
    throw new Error('Android Firebase config의 production project ID가 일치하지 않습니다.');
  }
  const matchingClient = config?.client?.find(candidate => (
    candidate?.client_info?.android_client_info?.package_name === expectedPackage
  ));
  if (!matchingClient?.client_info?.mobilesdk_app_id) {
    throw new Error('Android Firebase config에 Cycle Pair release client가 없습니다.');
  }
}

function plistValue(xml, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `<key>\\s*${escapedKey}\\s*</key>\\s*<string>([^<]+)</string>`,
  ).exec(xml);
  return match?.[1]?.trim();
}

function validateIos(content) {
  const xml = content.toString('utf8');
  if (plistValue(xml, 'PROJECT_ID') !== expectedProject) {
    throw new Error('iOS Firebase config의 production project ID가 일치하지 않습니다.');
  }
  if (plistValue(xml, 'BUNDLE_ID') !== expectedPackage) {
    throw new Error('iOS Firebase config의 bundle ID가 일치하지 않습니다.');
  }
  if (!plistValue(xml, 'GOOGLE_APP_ID')) {
    throw new Error('iOS Firebase config에 GOOGLE_APP_ID가 없습니다.');
  }
}

try {
  if (!expectedProject || expectedProject === manifest.development.projectId) {
    throw new Error('production Firebase project source of truth가 올바르지 않습니다.');
  }
  const args = parseArgs(process.argv.slice(2));
  if (args.restoreAndroid) {
    const content = decodeEnvironment(
      'FIREBASE_ANDROID_GOOGLE_SERVICES_JSON_BASE64',
      args.requireConfig,
    );
    if (content !== null) {
      validateAndroid(content);
      writeConfig(manifest.production.androidConfig, content);
    }
  }
  if (args.restoreIos) {
    const content = decodeEnvironment(
      'FIREBASE_IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64',
      args.requireConfig,
    );
    if (content !== null) {
      validateIos(content);
      writeConfig(manifest.production.iosConfig, content);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
