import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";

import { AITReader, PlatformType } from "@apps-in-toss/ait-format";

import { assertNativeFirebaseSelectionStructure } from "./native-firebase-selection-lib.mjs";

const UNKNOWN_MARKER = "확정 필요";
const VERIFIED_EVIDENCE_STATUSES = new Set(["verified", "not-applicable"]);
const execFileAsync = promisify(execFile);
const FIREBASE_DEPLOYMENT_SOURCE_PATHS = [
  "firebase/firestore.rules",
  "firebase/firestore.indexes.json",
  "firebase/functions/src",
  "firebase/functions/package.json",
  "firebase/functions/tsconfig.json",
  "firebase/functions/.npmrc",
  "firebase/functions/pnpm-lock.yaml",
  "firebase/functions/package-lock.json",
  "firebase/functions/yarn.lock",
  "firebase/package.json",
  "firebase/pnpm-lock.yaml",
  "firebase/pnpm-workspace.yaml",
];

async function exists(root, relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readText(root, relativePath) {
  if (!(await exists(root, relativePath))) return null;
  return readFile(path.join(root, relativePath), "utf8");
}

async function readJson(root, relativePath) {
  const value = await readText(root, relativePath);
  return value === null ? null : JSON.parse(value);
}

function containsUnknown(value) {
  return value !== null && JSON.stringify(value).includes(UNKNOWN_MARKER);
}

function hasRequeryReference(entry) {
  return (
    (typeof entry?.reference === "string" &&
      entry.reference.trim().length > 0) ||
    (typeof entry?.url === "string" && entry.url.trim().length > 0) ||
    (typeof entry?.projectId === "string" &&
      entry.projectId.trim().length > 0) ||
    (typeof entry?.gitSha === "string" && entry.gitSha.trim().length > 0) ||
    (typeof entry?.path === "string" &&
      entry.path.trim().length > 0 &&
      typeof entry?.sha256 === "string" &&
      /^[a-f0-9]{64}$/i.test(entry.sha256))
  );
}

function hasAuditEvidence(entry, { allowNotApplicable = true } = {}) {
  const acceptedStatuses = allowNotApplicable
    ? VERIFIED_EVIDENCE_STATUSES
    : new Set(["verified"]);

  return (
    acceptedStatuses.has(entry?.status) &&
    typeof entry?.evidence === "string" &&
    entry.evidence.trim().length > 0 &&
    typeof entry?.verifiedAt === "string" &&
    Number.isFinite(Date.parse(entry.verifiedAt)) &&
    (entry.status === "not-applicable" || hasRequeryReference(entry))
  );
}

function hasPlaintextReviewCredential(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasPlaintextReviewCredential);
  return Object.entries(value).some(
    ([key, nested]) =>
      ["username", "password"].includes(key.toLowerCase()) ||
      hasPlaintextReviewCredential(nested)
  );
}

function appReviewCredentialBlockers(review) {
  const blockers = [];
  if (hasPlaintextReviewCredential(review)) {
    blockers.push("App Review 평문 계정 필드 사용 금지");
  }
  if (
    !hasAuditEvidence(review?.credentials, { allowNotApplicable: false }) ||
    !hasAuditEvidence(review?.credentials?.loginSmoke, {
      allowNotApplicable: false,
    })
  ) {
    blockers.push("App Review credential reference와 로그인 smoke evidence 없음");
  }
  return blockers;
}

function parseSubscriptionPlanIds(source) {
  if (typeof source !== "string") return [];
  const plans = [];
  const pattern =
    /provider:\s*["'](google-play|app-store)["'](?:\s+as const)?,\s*productId:\s*["']([^"']+)["'](?:\s+as const)?,\s*basePlanId:\s*["']([^"']+)["'](?:\s+as const)?/g;
  for (const match of source.matchAll(pattern)) {
    plans.push({
      provider: match[1],
      productId: match[2],
      basePlanId: match[3],
    });
  }
  return plans;
}

function parseSubscriptionPlansWithPeriods(source) {
  if (typeof source !== "string") return [];
  const plans = [];
  const pattern =
    /provider:\s*["'](google-play|app-store)["'](?:\s+as const)?,\s*productId:\s*["']([^"']+)["'](?:\s+as const)?,\s*basePlanId:\s*["']([^"']+)["'](?:\s+as const)?,\s*billingPeriod:\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    plans.push({
      provider: match[1],
      productId: match[2],
      basePlanId: match[3],
      billingPeriod: match[4],
    });
  }
  return plans;
}

function configuredSubscriptionPlans(config, provider) {
  return (config?.monetization?.subscriptionProducts ?? []).map((plan) => ({
    provider,
    productId: plan?.productId,
    basePlanId: plan?.basePlanId,
    billingPeriod: plan?.billingPeriod,
  }));
}

function planSet(plans, { includeBillingPeriod = false } = {}) {
  return new Set(
    plans.map((plan) =>
      [
        plan.provider,
        plan.productId,
        plan.basePlanId,
        ...(includeBillingPeriod ? [plan.billingPeriod] : []),
      ].join("|")
    )
  );
}

function sameSet(left, right) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

export function subscriptionContractBlockers({
  playConfig,
  appStoreConfig,
  mobileCatalogSource,
  firebaseCatalogSource,
}) {
  const blockers = { firebase: [], googlePlay: [], appStore: [] };
  const playUsesSubscriptions =
    playConfig?.monetization?.model === "premium-subscription";
  const appStoreUsesSubscriptions =
    appStoreConfig?.monetization?.model === "premium-subscription";
  if (!playUsesSubscriptions && !appStoreUsesSubscriptions) return blockers;

  const mobilePlans = parseSubscriptionPlansWithPeriods(mobileCatalogSource);
  const mobilePlanIds = parseSubscriptionPlanIds(mobileCatalogSource);
  const firebasePlanIds = parseSubscriptionPlanIds(firebaseCatalogSource);

  if (!sameSet(planSet(mobilePlanIds), planSet(firebasePlanIds))) {
    blockers.firebase.push(
      "모바일과 Firebase 구독 product/base plan 계약 불일치"
    );
  }

  if (playUsesSubscriptions) {
    const configured = configuredSubscriptionPlans(playConfig, "google-play");
    const expected = mobilePlans.filter(
      (plan) => plan.provider === "google-play"
    );
    if (
      !sameSet(
        planSet(configured, { includeBillingPeriod: true }),
        planSet(expected, { includeBillingPeriod: true })
      )
    ) {
      blockers.googlePlay.push(
        "Play 구독 product/base plan과 모바일 catalog 불일치"
      );
    }
  }

  if (appStoreUsesSubscriptions) {
    const configured = configuredSubscriptionPlans(appStoreConfig, "app-store");
    const expected = mobilePlans.filter(
      (plan) => plan.provider === "app-store"
    );
    if (
      !sameSet(
        planSet(configured, { includeBillingPeriod: true }),
        planSet(expected, { includeBillingPeriod: true })
      )
    ) {
      blockers.appStore.push("App Store 구독 product와 모바일 catalog 불일치");
    }
  }

  return blockers;
}

async function sha256File(root, relativePath) {
  if (!(await exists(root, relativePath))) return null;
  return createHash("sha256")
    .update(await readFile(path.join(root, relativePath)))
    .digest("hex");
}

async function listFiles(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!(await exists(root, relativeDirectory))) return [];

  const result = [];
  const visit = async (absolutePath, relativePath) => {
    const entries = await readdir(absolutePath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const childAbsolutePath = path.join(absolutePath, entry.name);
      const childRelativePath = path.posix.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        await visit(childAbsolutePath, childRelativePath);
      } else if (entry.isFile()) {
        result.push(childRelativePath);
      }
    }
  };

  await visit(absoluteDirectory, relativeDirectory);
  return result;
}

async function sha256Manifest(root, relativePaths) {
  const hash = createHash("sha256");

  for (const relativePath of [...relativePaths].sort()) {
    const content = await readFile(path.join(root, relativePath));
    hash.update(relativePath);
    hash.update("\0");
    hash.update(String(content.byteLength));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }

  return hash.digest("hex");
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeJson(value[key])])
    );
  }
  return value;
}

function firebaseDeployConfigFingerprintFromJson(config) {
  // Emulator ports/UI and RN client defaults do not affect a Firebase deploy.
  // Keep only the Firestore/Functions deployment surfaces in this fingerprint.
  const deploymentConfig = canonicalizeJson({
    firestore: config.firestore ?? null,
    functions: config.functions ?? null,
  });
  return createHash("sha256")
    .update(JSON.stringify(deploymentConfig))
    .digest("hex");
}

async function firebaseDeployConfigFingerprint(root) {
  const config = await readJson(root, "firebase.json");
  return config === null
    ? null
    : firebaseDeployConfigFingerprintFromJson(config);
}

export async function computeFirebaseSourceFingerprints(root) {
  const functionSourceFiles = await listFiles(root, "firebase/functions/src");
  const functionManifestCandidates = [
    "firebase/functions/package.json",
    "firebase/functions/pnpm-lock.yaml",
    "firebase/functions/package-lock.json",
    "firebase/functions/yarn.lock",
    "firebase/functions/.npmrc",
    "firebase/functions/tsconfig.json",
    "firebase/package.json",
    "firebase/pnpm-lock.yaml",
    "firebase/pnpm-workspace.yaml",
  ];
  const functionManifestFiles = [];
  for (const candidate of functionManifestCandidates) {
    if (await exists(root, candidate)) functionManifestFiles.push(candidate);
  }
  const functionFiles = [...functionManifestFiles, ...functionSourceFiles];

  return {
    algorithm: "sha256-deployment-source-v3",
    firebaseConfig: await firebaseDeployConfigFingerprint(root),
    firestoreRules: await sha256File(root, "firebase/firestore.rules"),
    firestoreIndexes: await sha256File(root, "firebase/firestore.indexes.json"),
    functions:
      functionSourceFiles.length === 0 || functionManifestFiles.length === 0
        ? null
        : await sha256Manifest(root, functionFiles),
  };
}

function findNamedGroovyBlock(source, name, startAt = 0) {
  const nameIndex = source.indexOf(name, startAt);
  if (nameIndex < 0) return null;
  const openBraceIndex = source.indexOf("{", nameIndex + name.length);
  if (openBraceIndex < 0) return null;

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex + 1, index);
    }
  }
  return null;
}

function parseAndroidTargetSdk(androidRootGradle) {
  const match = androidRootGradle?.match(/targetSdkVersion\s*=\s*(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function readAndroidApplicationId(androidAppGradle, firebaseEnvironments) {
  const literal = androidAppGradle?.match(
    /applicationId\s+["']([^"']+)["']/
  )?.[1];
  if (literal) return literal;
  if (
    androidAppGradle?.match(/applicationId\s+permanentApplicationId\b/) &&
    typeof firebaseEnvironments?.permanentAppId === "string"
  ) {
    return firebaseEnvironments.permanentAppId;
  }
  return null;
}

function readAndroidVersionName(androidAppGradle) {
  const literal = androidAppGradle?.match(
    /^\s*versionName\s+["']([^"']+)["']\s*$/m
  )?.[1];
  if (literal) return literal;

  const variableName = androidAppGradle?.match(
    /^\s*versionName\s+([A-Za-z_$][\w$]*)\s*$/m
  )?.[1];
  if (!variableName) return null;

  const escapedVariableName = variableName.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  const assignment = androidAppGradle.match(
    new RegExp(
      `def\\s+${escapedVariableName}\\s*=\\s*\\(([\\s\\S]*?)\\)\\.toString\\(\\)`
    )
  )?.[1];
  if (!assignment) return null;

  const stringLiterals = [...assignment.matchAll(/["']([^"']+)["']/g)];
  return stringLiterals.at(-1)?.[1] ?? null;
}

function readIosBundleIdentifiers(iosProject) {
  if (iosProject === null) return [];
  return [
    ...new Set(
      [
        ...iosProject.matchAll(
          /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\s]+)\s*;/g
        ),
      ].map((match) => match[1])
    ),
  ];
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readXmlPlistString(xml, key) {
  const pattern = new RegExp(
    `<key>\\s*${escapeRegExp(key)}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`
  );
  const match = xml.match(pattern);
  return match === null ? null : decodeXml(match[1].trim());
}

async function nativeConfigBlockers(
  root,
  firebaseEnvironments,
  expectedProjectId
) {
  const blockers = [];
  const permanentAppId = firebaseEnvironments?.permanentAppId;
  const expectedAndroidPath = "android/app/google-services.json";
  const expectedIosPath = "ios/Firebase/GoogleService-Info.plist";
  const configuredAndroidPath = firebaseEnvironments?.androidConfig;
  const configuredIosPath = firebaseEnvironments?.iosConfig;

  if (configuredAndroidPath !== expectedAndroidPath) {
    blockers.push("Android Firebase config 경로가 단일 main source set이 아님");
  }
  if (configuredIosPath !== expectedIosPath) {
    blockers.push("iOS Firebase config 경로가 단일 공용 경로가 아님");
  }

  const androidPath = `apps/mobile/${expectedAndroidPath}`;
  if (!(await exists(root, androidPath))) {
    blockers.push("Android Firebase config 파일 없음");
  } else {
    try {
      const config = await readJson(root, androidPath);
      const projectId = config?.project_info?.project_id;
      const client = Array.isArray(config?.client)
        ? config.client.find(
            (candidate) =>
              candidate?.client_info?.android_client_info?.package_name ===
              permanentAppId
          )
        : undefined;
      if (
        projectId !== expectedProjectId ||
        typeof client?.client_info?.mobilesdk_app_id !== "string" ||
        client.client_info.mobilesdk_app_id.trim().length === 0
      ) {
        blockers.push("Android Firebase config project/app ID 불일치");
      }
    } catch {
      blockers.push("Android Firebase config JSON 검증 실패");
    }
  }

  const iosPath = `apps/mobile/${expectedIosPath}`;
  const iosConfig = await readText(root, iosPath);
  if (iosConfig === null) {
    blockers.push("iOS Firebase config 파일 없음");
  } else if (
    readXmlPlistString(iosConfig, "PROJECT_ID") !== expectedProjectId ||
    readXmlPlistString(iosConfig, "BUNDLE_ID") !== permanentAppId ||
    !readXmlPlistString(iosConfig, "GOOGLE_APP_ID")
  ) {
    blockers.push("iOS Firebase config project/app ID 불일치");
  }

  return blockers;
}

function releaseUsesDebugSigning(androidAppGradle) {
  if (androidAppGradle === null) return false;
  const buildTypes = findNamedGroovyBlock(androidAppGradle, "buildTypes");
  const release = buildTypes && findNamedGroovyBlock(buildTypes, "release");
  return release?.includes("signingConfig signingConfigs.debug") ?? false;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
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

function parseZipArchive(content) {
  const searchStart = Math.max(0, content.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = content.length - 22; offset >= searchStart; offset -= 1) {
    if (
      content.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + content.readUInt16LE(offset + 20) === content.length
    ) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("EOCD not found");
  if (
    content.readUInt16LE(eocdOffset + 4) !== 0 ||
    content.readUInt16LE(eocdOffset + 6) !== 0
  ) {
    throw new Error("multi-disk ZIP is unsupported");
  }

  const entryCount = content.readUInt16LE(eocdOffset + 10);
  const centralSize = content.readUInt32LE(eocdOffset + 12);
  const centralOffset = content.readUInt32LE(eocdOffset + 16);
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entryCount === 0 ||
    centralOffset + centralSize !== eocdOffset
  ) {
    throw new Error("invalid or ZIP64 central directory");
  }

  const entries = new Map();
  let offset = centralOffset;
  let totalUncompressedSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > eocdOffset ||
      content.readUInt32LE(offset) !== 0x02014b50
    ) {
      throw new Error("invalid central directory entry");
    }
    const flags = content.readUInt16LE(offset + 8);
    const compressionMethod = content.readUInt16LE(offset + 10);
    const checksum = content.readUInt32LE(offset + 16);
    const compressedSize = content.readUInt32LE(offset + 20);
    const uncompressedSize = content.readUInt32LE(offset + 24);
    const nameLength = content.readUInt16LE(offset + 28);
    const extraLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    const externalAttributes = content.readUInt32LE(offset + 38);
    const localHeaderOffset = content.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (
      entryEnd > eocdOffset ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      (flags & 0x1) !== 0
    ) {
      throw new Error("unsupported ZIP entry");
    }

    const name = content
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    const segments = name.split("/");
    if (
      name.length === 0 ||
      name.includes("\\") ||
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name) ||
      segments.includes("..") ||
      (segments.includes("") && !name.endsWith("/")) ||
      entries.has(name)
    ) {
      throw new Error("unsafe or duplicate ZIP entry");
    }
    const unixFileType = (externalAttributes >>> 16) & 0xf000;
    if (unixFileType === 0xa000) {
      throw new Error("ZIP symlink entry is forbidden");
    }
    if (
      localHeaderOffset + 30 > centralOffset ||
      content.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw new Error("invalid local ZIP header");
    }
    const localNameLength = content.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = content.readUInt16LE(localHeaderOffset + 28);
    const localName = content
      .subarray(
        localHeaderOffset + 30,
        localHeaderOffset + 30 + localNameLength
      )
      .toString("utf8");
    const dataOffset =
      localHeaderOffset + 30 + localNameLength + localExtraLength;
    if (
      localName !== name ||
      dataOffset + compressedSize > centralOffset ||
      ![0, 8].includes(compressionMethod)
    ) {
      throw new Error("invalid ZIP entry payload");
    }

    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > 2 * 1024 * 1024 * 1024) {
      throw new Error("ZIP expands beyond safety limit");
    }
    entries.set(name, {
      name,
      checksum,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      dataOffset,
    });
    offset = entryEnd;
  }
  if (offset !== eocdOffset) throw new Error("central directory size mismatch");
  return entries;
}

function readZipEntry(content, entry) {
  const compressed = content.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize
  );
  const result =
    entry.compressionMethod === 0 ? compressed : inflateRawSync(compressed);
  if (
    result.length !== entry.uncompressedSize ||
    crc32(result) !== entry.checksum
  ) {
    throw new Error(`ZIP CRC/size mismatch: ${entry.name}`);
  }
  return result;
}

function readProtoVarint(content, start) {
  let result = 0n;
  let shift = 0n;
  for (
    let offset = start;
    offset < Math.min(content.length, start + 10);
    offset += 1
  ) {
    const byte = content[offset];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result, nextOffset: offset + 1 };
    }
    shift += 7n;
  }
  throw new Error("invalid protobuf varint");
}

function parseProtoFields(content) {
  const fields = [];
  let offset = 0;
  while (offset < content.length) {
    const key = readProtoVarint(content, offset);
    offset = key.nextOffset;
    const fieldNumber = Number(key.value >> 3n);
    const wireType = Number(key.value & 7n);
    if (fieldNumber <= 0) throw new Error("invalid protobuf field");
    if (wireType === 0) {
      const value = readProtoVarint(content, offset);
      fields.push({ fieldNumber, wireType, value: value.value });
      offset = value.nextOffset;
    } else if (wireType === 1) {
      if (offset + 8 > content.length) throw new Error("truncated protobuf");
      fields.push({
        fieldNumber,
        wireType,
        value: content.subarray(offset, offset + 8),
      });
      offset += 8;
    } else if (wireType === 2) {
      const length = readProtoVarint(content, offset);
      offset = length.nextOffset;
      const size = Number(length.value);
      if (!Number.isSafeInteger(size) || offset + size > content.length) {
        throw new Error("truncated protobuf field");
      }
      fields.push({
        fieldNumber,
        wireType,
        value: content.subarray(offset, offset + size),
      });
      offset += size;
    } else if (wireType === 5) {
      if (offset + 4 > content.length) throw new Error("truncated protobuf");
      fields.push({
        fieldNumber,
        wireType,
        value: content.subarray(offset, offset + 4),
      });
      offset += 4;
    } else {
      throw new Error("unsupported protobuf wire type");
    }
  }
  return fields;
}

function protoString(fields, fieldNumber) {
  const field = fields.find(
    (candidate) =>
      candidate.fieldNumber === fieldNumber && candidate.wireType === 2
  );
  return field ? field.value.toString("utf8") : null;
}

function compiledManifestAttributeValue(attributeFields) {
  const item = attributeFields.find(
    (field) => field.fieldNumber === 5 && field.wireType === 2
  );
  if (!item) return null;
  const itemFields = parseProtoFields(item.value);
  const stringValue = protoString(itemFields, 2);
  if (stringValue !== null) return stringValue;
  const primitive = itemFields.find(
    (field) => field.fieldNumber === 5 && field.wireType === 2
  );
  if (!primitive) return null;
  const primitiveFields = parseProtoFields(primitive.value);
  const integer = primitiveFields.find(
    (field) => [6, 7].includes(field.fieldNumber) && field.wireType === 0
  );
  return integer ? String(integer.value) : null;
}

function parseAabManifestMetadata(content) {
  const nodeFields = parseProtoFields(content);
  const element = nodeFields.find(
    (field) => field.fieldNumber === 1 && field.wireType === 2
  );
  if (!element) throw new Error("manifest root element missing");
  const elementFields = parseProtoFields(element.value);
  if (protoString(elementFields, 2) !== "manifest") {
    throw new Error("manifest root name mismatch");
  }

  const attributes = new Map();
  for (const attribute of elementFields.filter(
    (field) => field.fieldNumber === 4 && field.wireType === 2
  )) {
    const attributeFields = parseProtoFields(attribute.value);
    const name = protoString(attributeFields, 2);
    const value =
      protoString(attributeFields, 3) ??
      compiledManifestAttributeValue(attributeFields);
    if (name && value !== null) attributes.set(name, value);
  }
  return {
    packageName: attributes.get("package") ?? null,
    versionName: attributes.get("versionName") ?? null,
    versionCode: Number.parseInt(attributes.get("versionCode") ?? "", 10),
  };
}

function parseJarManifestSignedEntries(content) {
  const unfolded = content
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replace(/\n ([^\n]*)/g, "$1");
  const signedEntries = new Set();
  for (const section of unfolded.split(/\n\n+/)) {
    const lines = section.split("\n");
    const name = lines.find((line) => line.startsWith("Name: "))?.slice(6);
    const hasDigest = lines.some((line) =>
      /^SHA-(?:256|384|512)-Digest: /.test(line)
    );
    if (name && hasDigest) signedEntries.add(name);
  }
  return signedEntries;
}

async function baseArtifactBlockers(root, artifact, label, expectedSuffix) {
  if (!hasAuditEvidence(artifact, { allowNotApplicable: false })) {
    return [`${label} 검증 evidence 없음`];
  }
  if (typeof artifact.path !== "string" || artifact.path.trim().length === 0) {
    return [`${label} artifact 경로 없음`];
  }
  if (!(await exists(root, artifact.path))) {
    return [`${label} artifact 파일 없음`];
  }
  const blockers = [];
  if (!artifact.path.toLowerCase().endsWith(expectedSuffix)) {
    blockers.push(`${label} artifact 확장자 불일치`);
  }
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? "")) {
    blockers.push(`${label} SHA-256 evidence 없음`);
  } else if ((await sha256File(root, artifact.path)) !== artifact.sha256) {
    blockers.push(`${label} SHA-256 불일치`);
  }
  return blockers;
}

async function appsInTossArtifactBlockers(root, artifact, config) {
  const label = "AppsInToss package";
  const blockers = await baseArtifactBlockers(root, artifact, label, ".ait");
  if (
    typeof artifact?.path !== "string" ||
    !(await exists(root, artifact.path))
  ) {
    return blockers;
  }

  let reader;
  try {
    reader = AITReader.fromBuffer(
      await readFile(path.join(root, artifact.path))
    );
  } catch {
    blockers.push(`${label} AIT 포맷 검증 실패`);
    return blockers;
  }

  if (reader.formatVersion !== 1) {
    blockers.push(`${label} format version 1 필요`);
  }
  if (!config?.appName || reader.appName !== config.appName) {
    blockers.push(`${label} appName과 등록 설정 불일치`);
  }
  if (config?.buildTarget?.artifact !== artifact.path) {
    blockers.push(`${label} 경로와 build target 불일치`);
  }

  const aitPackage = await readJson(root, "apps/ait/package.json");
  const metadata = reader.metadata;
  const embeddedDependencies = metadata?.packageJson?.dependencies;
  const expectedRuntime = aitPackage?.dependencies?.["react-native"];
  const expectedSdk = aitPackage?.dependencies?.["@apps-in-toss/framework"];
  const expectedTds = aitPackage?.dependencies?.["@toss/tds-react-native"];
  if (
    metadata?.isGame !== false ||
    metadata?.platform !== PlatformType.REACT_NATIVE ||
    metadata?.runtimeVersion !== expectedRuntime ||
    !/^0\.84\./.test(metadata?.runtimeVersion ?? "") ||
    metadata?.sdkVersion !== expectedSdk ||
    !/^2\./.test(metadata?.sdkVersion ?? "") ||
    typeof expectedTds !== "string" ||
    expectedTds.trim().length === 0 ||
    embeddedDependencies?.["react-native"] !== expectedRuntime ||
    embeddedDependencies?.["@apps-in-toss/framework"] !== expectedSdk ||
    embeddedDependencies?.["@toss/tds-react-native"] !== expectedTds
  ) {
    blockers.push(`${label} SDK 2.x / RN 0.84 / TDS metadata 불일치`);
  }

  const entryNames = reader.listEntries();
  const uniqueEntryNames = new Set(entryNames);
  const runtimeSuffix = (expectedRuntime ?? "").replaceAll(".", "_");
  const requiredEntries = [
    `bundle.ios.${runtimeSuffix}.js`,
    `bundle.android.${runtimeSuffix}.js`,
  ];
  if (
    entryNames.length === 0 ||
    entryNames.length !== uniqueEntryNames.size ||
    requiredEntries.some((entry) => !uniqueEntryNames.has(entry)) ||
    requiredEntries.some((entry) => !metadata?.bundleFiles?.includes(entry))
  ) {
    blockers.push(`${label} iOS/Android runtime bundle entry 불일치`);
    return blockers;
  }

  try {
    for (const entry of reader.bundle.index) {
      const payload = await reader.readEntry(entry.name);
      const payloadHash = createHash("sha256").update(payload).digest("hex");
      if (
        payload.length !== Number(entry.uncompressedSize) ||
        payloadHash !== entry.sha256Hex
      ) {
        throw new Error("AIT entry integrity mismatch");
      }
    }
  } catch {
    blockers.push(`${label} bundle payload 무결성 검증 실패`);
  }
  return blockers;
}

async function androidArtifactBlockers(
  root,
  artifact,
  expectedPackageName,
  expectedVersionName
) {
  const label = "서명된 Android AAB";
  const blockers = await baseArtifactBlockers(root, artifact, label, ".aab");
  if (
    typeof artifact?.path !== "string" ||
    !(await exists(root, artifact.path))
  ) {
    return blockers;
  }

  const absolutePath = path.join(root, artifact.path);
  let content;
  let entries;
  try {
    content = await readFile(absolutePath);
    entries = parseZipArchive(content);
  } catch {
    blockers.push(`${label} central directory 구조 검증 실패`);
    return blockers;
  }

  const requiredEntries = [
    "BundleConfig.pb",
    "base/manifest/AndroidManifest.xml",
  ];
  for (const requiredEntry of requiredEntries) {
    if (!entries.has(requiredEntry)) {
      blockers.push(`${label} 필수 archive entry 누락: ${requiredEntry}`);
    }
  }
  const dexEntries = [...entries.keys()].filter((name) =>
    /^base\/dex\/classes(?:\d*)\.dex$/.test(name)
  );
  if (dexEntries.length === 0) {
    blockers.push(`${label} base DEX entry 누락`);
  }
  if (blockers.some((blocker) => blocker.includes("entry 누락"))) {
    return blockers;
  }

  let manifestMetadata;
  try {
    const bundleConfig = readZipEntry(content, entries.get("BundleConfig.pb"));
    if (bundleConfig.length === 0) throw new Error("empty BundleConfig");
    manifestMetadata = parseAabManifestMetadata(
      readZipEntry(content, entries.get("base/manifest/AndroidManifest.xml"))
    );
    for (const dexEntry of dexEntries) {
      const dex = readZipEntry(content, entries.get(dexEntry));
      if (
        !/^dex\n0(?:35|37|38|39|40|41)\0/.test(
          dex.subarray(0, 8).toString("latin1")
        )
      ) {
        throw new Error("invalid DEX magic");
      }
    }
  } catch {
    blockers.push(`${label} manifest/DEX payload 구조 검증 실패`);
    return blockers;
  }

  if (
    artifact?.format !== "android-app-bundle" ||
    manifestMetadata.packageName !== expectedPackageName ||
    manifestMetadata.versionName !== expectedVersionName ||
    manifestMetadata.packageName !== artifact?.packageName ||
    manifestMetadata.versionName !== artifact?.versionName ||
    !isPositiveInteger(manifestMetadata.versionCode) ||
    manifestMetadata.versionCode !== artifact?.versionCode
  ) {
    blockers.push(`${label} 실제 manifest package/version 불일치`);
  }

  const jarManifestEntry = [...entries.keys()].find((name) =>
    /^META-INF\/MANIFEST\.MF$/i.test(name)
  );
  const signatureFile = [...entries.keys()].some((name) =>
    /^META-INF\/[^/]+\.SF$/i.test(name)
  );
  const signatureBlock = [...entries.keys()].some((name) =>
    /^META-INF\/[^/]+\.(?:RSA|DSA|EC)$/i.test(name)
  );
  if (!jarManifestEntry || !signatureFile || !signatureBlock) {
    blockers.push(`${label} JAR signature entry 누락`);
    return blockers;
  }
  try {
    const signedEntries = parseJarManifestSignedEntries(
      readZipEntry(content, entries.get(jarManifestEntry))
    );
    const unsignedPayloads = [...entries.keys()].filter(
      (name) =>
        !name.endsWith("/") &&
        !name.toUpperCase().startsWith("META-INF/") &&
        !signedEntries.has(name)
    );
    if (unsignedPayloads.length > 0) {
      blockers.push(`${label} unsigned payload entry 존재`);
    }
  } catch {
    blockers.push(`${label} JAR manifest 검증 실패`);
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      "jarsigner",
      ["-verify", "-verbose", "-certs", absolutePath],
      {
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
        maxBuffer: 20 * 1024 * 1024,
      }
    );
    if (!/jar verified\./i.test(`${stdout}\n${stderr}`)) {
      throw new Error("jarsigner did not verify");
    }
  } catch {
    blockers.push(`${label} JAR signature verification 실패`);
    return blockers;
  }

  try {
    let certificateOutput = "";
    try {
      const result = await execFileAsync(
        "keytool",
        ["-printcert", "-rfc", "-jarfile", absolutePath],
        { env: { ...process.env, LC_ALL: "C", LANG: "C" } }
      );
      certificateOutput = `${result.stdout}\n${result.stderr}`;
    } catch (error) {
      // Some macOS JDK wrappers print the signer certificate successfully and
      // then return a non-zero default-keystore error. Only the PEM block is
      // trusted; any invocation without it still fails closed below.
      certificateOutput = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
    }
    const pem = certificateOutput.match(
      /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/
    )?.[1];
    const fingerprint = pem
      ? createHash("sha256")
          .update(Buffer.from(pem.replace(/\s/g, ""), "base64"))
          .digest("hex")
      : null;
    if (
      !fingerprint ||
      artifact?.signing?.certificateSha256?.toLowerCase() !== fingerprint
    ) {
      throw new Error("signing certificate fingerprint mismatch");
    }
  } catch {
    blockers.push(`${label} signer certificate SHA-256 불일치`);
  }
  return blockers;
}

async function plistValue(plistPath, keyPath) {
  const { stdout } = await execFileAsync(
    "/usr/bin/plutil",
    ["-extract", keyPath, "raw", "-o", "-", plistPath],
    { maxBuffer: 1024 * 1024 }
  );
  return stdout.trim();
}

async function appStoreArtifactBlockers(
  root,
  artifact,
  expectedBundleId,
  expectedTeamId,
  expectedVersion
) {
  const label = "App Store archive";
  const blockers = await baseArtifactBlockers(
    root,
    artifact,
    label,
    ".xcarchive.zip"
  );
  if (
    typeof artifact?.path !== "string" ||
    !(await exists(root, artifact.path))
  ) {
    return blockers;
  }

  const absolutePath = path.join(root, artifact.path);
  let entries;
  try {
    entries = parseZipArchive(await readFile(absolutePath));
  } catch {
    blockers.push(`${label} central directory 구조 검증 실패`);
    return blockers;
  }
  const archiveInfoEntries = [...entries.keys()].filter((name) =>
    /^(?:[^/]+\/)*[^/]+\.xcarchive\/Info\.plist$/.test(name)
  );
  const appInfoEntries = [...entries.keys()].filter((name) =>
    /\.xcarchive\/Products\/Applications\/[^/]+\.app\/Info\.plist$/.test(name)
  );
  if (archiveInfoEntries.length !== 1 || appInfoEntries.length !== 1) {
    blockers.push(`${label} xcarchive/app Info.plist entry 구조 불일치`);
    return blockers;
  }
  const appRoot = appInfoEntries[0].slice(0, -"Info.plist".length);
  if (!entries.has(`${appRoot}_CodeSignature/CodeResources`)) {
    blockers.push(`${label} CodeResources entry 누락`);
    return blockers;
  }
  if (process.platform !== "darwin") {
    blockers.push(`${label} 검증은 macOS codesign 환경 필요`);
    return blockers;
  }

  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "cyclepair-xcarchive-")
  );
  try {
    await execFileAsync("/usr/bin/unzip", ["-tqq", absolutePath]);
    await execFileAsync("/usr/bin/unzip", [
      "-qq",
      absolutePath,
      "-d",
      temporaryDirectory,
    ]);
    const archiveInfoPath = path.join(
      temporaryDirectory,
      archiveInfoEntries[0]
    );
    const appInfoPath = path.join(temporaryDirectory, appInfoEntries[0]);
    const appPath = path.dirname(appInfoPath);
    const [bundleId, version, buildNumber, executable, archiveTeam] =
      await Promise.all([
        plistValue(appInfoPath, "CFBundleIdentifier"),
        plistValue(appInfoPath, "CFBundleShortVersionString"),
        plistValue(appInfoPath, "CFBundleVersion"),
        plistValue(appInfoPath, "CFBundleExecutable"),
        plistValue(archiveInfoPath, "ApplicationProperties.Team"),
      ]);
    if (
      bundleId !== expectedBundleId ||
      version !== expectedVersion ||
      artifact?.format !== "xcarchive-zip" ||
      artifact?.bundleId !== bundleId ||
      artifact?.marketingVersion !== version ||
      String(artifact?.buildNumber) !== buildNumber ||
      !/^\d+$/.test(buildNumber) ||
      Number.parseInt(buildNumber, 10) <= 0 ||
      archiveTeam !== expectedTeamId ||
      artifact?.signing?.teamId !== expectedTeamId ||
      !(await exists(temporaryDirectory, path.posix.join(appRoot, executable)))
    ) {
      blockers.push(`${label} 실제 plist bundle/version/team 불일치`);
      return blockers;
    }

    await execFileAsync(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", "--verbose=2", appPath],
      { maxBuffer: 10 * 1024 * 1024 }
    );
    const details = await execFileAsync(
      "/usr/bin/codesign",
      ["-d", "--verbose=4", appPath],
      { maxBuffer: 10 * 1024 * 1024 }
    );
    const output = `${details.stdout}\n${details.stderr}`;
    const actualTeamId = output.match(/TeamIdentifier=([^\s]+)/)?.[1];
    if (
      actualTeamId !== expectedTeamId ||
      /Signature=adhoc/.test(output) ||
      !/^Authority=/m.test(output)
    ) {
      blockers.push(`${label} Apple signing identity/team 검증 실패`);
    }
  } catch {
    blockers.push(`${label} plist/codesign 실제 검증 실패`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  return blockers;
}

function evidenceBlocker(entry, message, options) {
  return hasAuditEvidence(entry, options) ? [] : [message];
}

function projectEvidenceBlocker(entry, expectedProjectId, message) {
  return hasAuditEvidence(entry, { allowNotApplicable: false }) &&
    entry?.projectId === expectedProjectId
    ? []
    : [message];
}

function productionCapabilityEvidenceBlockers({
  entry,
  expectedProjectId,
  label,
  requiredChecks = [],
}) {
  const blockers = [];
  if (!hasAuditEvidence(entry, { allowNotApplicable: false })) {
    blockers.push(`${label} live evidence 없음`);
  }
  if (!expectedProjectId || entry?.projectId !== expectedProjectId) {
    blockers.push(`${label} project ID 불일치`);
  }
  for (const [key, message] of requiredChecks) {
    if (entry?.[key] !== true) blockers.push(message);
  }
  return blockers;
}

function appCheckEnforcementBlockers(entry, expectedProjectId) {
  const blockers = [];
  if (!hasAuditEvidence(entry, { allowNotApplicable: false })) {
    blockers.push("App Check 운영 강제 live evidence 없음");
  }
  if (!expectedProjectId || entry?.projectId !== expectedProjectId) {
    blockers.push("App Check 운영 강제 project ID 불일치");
  }
  if (
    entry?.providers?.android !== "playIntegrity" ||
    entry?.providers?.apple !== "appAttestWithDeviceCheckFallback"
  ) {
    blockers.push("App Check 운영 attestation provider evidence 불일치");
  }
  if (entry?.enforcement?.firestore !== true) {
    blockers.push("Firestore App Check 운영 강제 미검증");
  }
  if (entry?.enforcement?.callableFunctions !== true) {
    blockers.push("Callable Functions App Check 운영 강제 미검증");
  }
  return blockers;
}

async function appCheckClientSourceBlockers(root, mobilePackage) {
  const blockers = [];
  const appCheckVersion =
    mobilePackage?.dependencies?.["@react-native-firebase/app-check"];
  const firebaseAppVersion =
    mobilePackage?.dependencies?.["@react-native-firebase/app"];
  if (appCheckVersion !== "25.1.0" || appCheckVersion !== firebaseAppVersion) {
    blockers.push("RNFirebase App Check 25.1.0 dependency 미확정");
  }

  const [
    bootstrap,
    mobileIndex,
    mobileFirebaseConfig,
    appDelegate,
    bridgingHeader,
    entitlements,
    iosProject,
    podLock,
    functionsSource,
  ] = await Promise.all([
    readText(
      root,
      "apps/mobile/src/platform/firebase/FirebaseAppCheckBootstrap.ts"
    ),
    readText(root, "apps/mobile/index.js"),
    readJson(root, "apps/mobile/firebase.json"),
    readText(root, "apps/mobile/ios/CyclePair/AppDelegate.swift"),
    readText(root, "apps/mobile/ios/CyclePair/CyclePair-Bridging-Header.h"),
    readText(root, "apps/mobile/ios/CyclePair/CyclePair.entitlements"),
    readText(root, "apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj"),
    readText(root, "apps/mobile/ios/Podfile.lock"),
    readText(root, "firebase/functions/src/index.ts"),
  ]);

  const requiredBootstrapEvidence = [
    "@react-native-firebase/app-check",
    "ReactNativeFirebaseAppCheckProvider",
    "initializeAppCheck",
    "app.options.projectId",
    "firebaseEnvironments.projectId",
    "developmentBundle: __DEV__",
    "isTokenAutoRefreshEnabled: true",
  ];
  const requiredProviderEvidence = [
    /android:\s*\{\s*provider:\s*['"]debug['"]\s*\}/,
    /apple:\s*\{\s*provider:\s*['"]debug['"]\s*\}/,
    /android:\s*\{\s*provider:\s*['"]playIntegrity['"]\s*\}/,
    /apple:\s*\{\s*provider:\s*['"]appAttestWithDeviceCheckFallback['"]\s*\}/,
  ];
  if (
    bootstrap === null ||
    requiredBootstrapEvidence.some((value) => !bootstrap.includes(value)) ||
    requiredProviderEvidence.some((pattern) => !pattern.test(bootstrap))
  ) {
    blockers.push("App Check 환경별 client initialization source 미검증");
  }
  if (
    mobileIndex === null ||
    !mobileIndex.includes("initializeFirebaseAppCheck()") ||
    !mobileIndex.includes("FirebaseAppCheckGate")
  ) {
    blockers.push("App Check startup fail-closed gate 미검증");
  }

  const reactNativeConfig = mobileFirebaseConfig?.["react-native"];
  if (
    reactNativeConfig?.app_data_collection_default_enabled !== false ||
    reactNativeConfig?.app_check_token_auto_refresh !== true
  ) {
    blockers.push("App Check token refresh와 privacy default 분리 미검증");
  }

  const nativeHook =
    appDelegate?.indexOf("RNFBAppCheckModule.sharedInstance()") ?? -1;
  const firebaseConfigure =
    appDelegate?.indexOf("FirebaseApp.configure()") ?? -1;
  if (
    nativeHook < 0 ||
    firebaseConfigure < 0 ||
    nativeHook > firebaseConfigure ||
    !bridgingHeader?.includes("#import <RNFBAppCheckModule.h>") ||
    !podLock?.includes("RNFBAppCheck (25.1.0)")
  ) {
    blockers.push("iOS App Check native provider factory linkage 미검증");
  }
  if (
    !entitlements?.includes(
      "com.apple.developer.devicecheck.appattest-environment"
    ) ||
    !iosProject?.includes("APP_ATTEST_ENVIRONMENT = development;") ||
    !iosProject?.includes("APP_ATTEST_ENVIRONMENT = production;") ||
    (iosProject?.match(
      /SWIFT_OBJC_BRIDGING_HEADER = "?CyclePair\/CyclePair-Bridging-Header\.h"?;/g
    )?.length ?? 0) < 2
  ) {
    blockers.push("iOS App Attest capability/build environment 미검증");
  }
  if (
    !functionsSource?.includes('process.env.ENFORCE_APP_CHECK === "true"') ||
    !functionsSource?.includes("enforceAppCheck,")
  ) {
    blockers.push("Callable Functions App Check enforcement source 미검증");
  }

  return blockers;
}

function targetMarketDecision(releaseEvidence, key, label) {
  const decision = releaseEvidence?.targetMarkets?.[key];
  const blockers = [];
  if (decision?.included !== true && decision?.included !== false) {
    blockers.push(`${label} target market 포함 여부 미확정`);
    return { included: true, blockers };
  }
  if (!hasAuditEvidence(decision, { allowNotApplicable: false })) {
    blockers.push(`${label} target market 결정 evidence 없음`);
  }
  return { included: decision.included, blockers };
}

async function gitCommand(root, args) {
  try {
    const result = await execFileAsync("git", ["-C", root, ...args], {
      maxBuffer: 5 * 1024 * 1024,
    });
    return { ok: true, ...result };
  } catch (error) {
    return {
      ok: false,
      stdout: error?.stdout ?? "",
      stderr: error?.stderr ?? "",
    };
  }
}

async function firebaseDeploymentBlockers({
  root,
  deployment,
  expectedProjectId,
  expectedRegion,
  fingerprints,
  label,
}) {
  const blockers = [];
  if (!hasAuditEvidence(deployment, { allowNotApplicable: false })) {
    blockers.push(`${label} Firebase 배포 evidence가 stale 또는 미검증`);
  }
  if (!expectedProjectId || deployment?.projectId !== expectedProjectId) {
    blockers.push(`${label} Firebase 배포 evidence project ID 불일치`);
  }
  if (!expectedRegion || deployment?.region !== expectedRegion) {
    blockers.push(`${label} Firebase 배포 region evidence 불일치`);
  }
  const gitSha = deployment?.gitSha;
  const validGitSha = /^[a-f0-9]{40}$/i.test(gitSha ?? "");
  if (!validGitSha) {
    blockers.push(`${label} Firebase 배포 gitSha evidence 없음 또는 형식 오류`);
  } else {
    const commitExists = await gitCommand(root, [
      "cat-file",
      "-e",
      `${gitSha}^{commit}`,
    ]);
    if (!commitExists.ok) {
      blockers.push(`${label} Firebase 배포 gitSha가 현재 repo commit에 없음`);
    } else {
      const isAncestor = await gitCommand(root, [
        "merge-base",
        "--is-ancestor",
        gitSha,
        "HEAD",
      ]);
      if (!isAncestor.ok) {
        blockers.push(
          `${label} Firebase 배포 gitSha가 현재 HEAD ancestor가 아님`
        );
      }
      const sourceDiff = await gitCommand(root, [
        "diff",
        "--quiet",
        gitSha,
        "--",
        ...FIREBASE_DEPLOYMENT_SOURCE_PATHS,
      ]);
      const untracked = await gitCommand(root, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--",
        ...FIREBASE_DEPLOYMENT_SOURCE_PATHS,
      ]);
      const committedFirebaseConfig = await gitCommand(root, [
        "show",
        `${gitSha}:firebase.json`,
      ]);
      let firebaseDeployConfigMatches = false;
      if (committedFirebaseConfig.ok) {
        try {
          firebaseDeployConfigMatches =
            firebaseDeployConfigFingerprintFromJson(
              JSON.parse(committedFirebaseConfig.stdout)
            ) === fingerprints.firebaseConfig;
        } catch {
          firebaseDeployConfigMatches = false;
        }
      }
      if (
        !sourceDiff.ok ||
        !untracked.ok ||
        untracked.stdout.trim().length > 0 ||
        !firebaseDeployConfigMatches
      ) {
        blockers.push(
          `${label} Firebase 배포 gitSha commit과 현재 deployment source 불일치`
        );
      }
    }
  }
  const deployedAt = deployment?.deployedAt;
  const hasDeploymentTimestamp =
    typeof deployedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      deployedAt
    ) &&
    Number.isFinite(Date.parse(deployedAt));
  if (!hasDeploymentTimestamp) {
    blockers.push(`${label} Firebase deployedAt RFC 3339 evidence 없음`);
  } else if (
    Number.isFinite(Date.parse(deployment?.verifiedAt)) &&
    Date.parse(deployedAt) > Date.parse(deployment.verifiedAt)
  ) {
    blockers.push(`${label} Firebase deployedAt이 verifiedAt보다 늦음`);
  }
  if (deployment?.source?.algorithm !== fingerprints.algorithm) {
    blockers.push(`${label} Firebase source fingerprint algorithm 불일치`);
  }

  const components = [
    ["firebaseConfigSha256", "firebaseConfig", "firebase.json"],
    ["firestoreRulesSha256", "firestoreRules", "Firestore Rules"],
    ["firestoreIndexesSha256", "firestoreIndexes", "Firestore indexes"],
    ["functionsSha256", "functions", "Cloud Functions"],
  ];
  for (const [evidenceKey, fingerprintKey, componentLabel] of components) {
    const currentFingerprint = fingerprints[fingerprintKey];
    if (!currentFingerprint) {
      blockers.push(`${componentLabel} deployment source 누락`);
    } else if (deployment?.source?.[evidenceKey] !== currentFingerprint) {
      blockers.push(
        `${label} 현재 ${componentLabel} source와 배포 evidence 불일치`
      );
    }
  }

  return blockers;
}

export async function evaluateReleaseReadiness(root) {
  const [
    rootPackage,
    mobilePackage,
    playConfig,
    appStoreConfig,
    appsInTossConfig,
    releaseEvidence,
    firebaseReadiness,
    androidAppGradle,
    androidRootGradle,
    iosProject,
    firebaseProjects,
    firebaseEnvironments,
    mobileSubscriptionCatalog,
    firebaseSubscriptionCatalog,
  ] = await Promise.all([
    readJson(root, "package.json"),
    readJson(root, "apps/mobile/package.json"),
    readJson(root, "play-store/google-play.config.json"),
    readJson(root, "app-store/app-store.config.json"),
    readJson(root, "apps-in-toss/apps-in-toss.config.json"),
    readJson(root, "release/readiness.json"),
    readJson(root, "firebase/release-readiness.json"),
    readText(root, "apps/mobile/android/app/build.gradle"),
    readText(root, "apps/mobile/android/build.gradle"),
    readText(root, "apps/mobile/ios/CyclePair.xcodeproj/project.pbxproj"),
    readJson(root, ".firebaserc"),
    readJson(root, "apps/mobile/firebase-environments.json"),
    readText(root, "apps/mobile/src/platform/purchases/subscriptionCatalog.ts"),
    readText(root, "firebase/functions/src/domain/subscription.ts"),
  ]);
  const firebaseFingerprints = await computeFirebaseSourceFingerprints(root);
  const googlePlayTarget = targetMarketDecision(
    releaseEvidence,
    "googlePlay",
    "Google Play"
  );
  const appStoreTarget = targetMarketDecision(
    releaseEvidence,
    "appStore",
    "App Store"
  );
  const appsInTossTarget = targetMarketDecision(
    releaseEvidence,
    "appsInToss",
    "AppsInToss"
  );
  const subscriptionBlockers = subscriptionContractBlockers({
    playConfig,
    appStoreConfig,
    mobileCatalogSource: mobileSubscriptionCatalog,
    firebaseCatalogSource: firebaseSubscriptionCatalog,
  });

  const architectureBlockers = [];
  if (!(await exists(root, "packages/product-core/src"))) {
    architectureBlockers.push("product-core 미구현");
  }
  if (!rootPackage?.version || rootPackage.version !== mobilePackage?.version) {
    architectureBlockers.push("root/mobile package version 불일치");
  }
  if (readAndroidVersionName(androidAppGradle) !== mobilePackage?.version) {
    architectureBlockers.push(
      "Android versionName과 mobile package version 불일치"
    );
  }
  if (!iosProject?.includes(`MARKETING_VERSION = ${mobilePackage?.version};`)) {
    architectureBlockers.push(
      "iOS MARKETING_VERSION과 mobile package version 불일치"
    );
  }

  const firebaseBlockers = [];
  if (!(await exists(root, "firebase/firestore.rules"))) {
    firebaseBlockers.push("Security Rules 미구현");
  }
  if (firebaseReadiness?.schemaVersion !== 4) {
    firebaseBlockers.push("Firebase release-readiness schema v4 필요");
  }
  const projectId = firebaseReadiness?.environment?.projectId;
  const trackedProjectId = firebaseEnvironments?.projectId;
  if (
    !projectId ||
    projectId !== trackedProjectId ||
    firebaseProjects?.projects?.default !== projectId
  ) {
    firebaseBlockers.push("Firebase 단일 project ID 미확정 또는 불일치");
  }
  const firebaseRegion = firebaseReadiness?.environment?.region;
  try {
    await assertNativeFirebaseSelectionStructure(root, firebaseEnvironments);
  } catch (error) {
    firebaseBlockers.push(
      `Native Firebase variant 선택 구조 검증 실패: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const deploymentBlockers = await firebaseDeploymentBlockers({
    root,
    deployment: firebaseReadiness?.deployment,
    expectedProjectId: projectId,
    expectedRegion: firebaseRegion,
    fingerprints: firebaseFingerprints,
    label: "단일",
  });
  firebaseBlockers.push(
    ...(await appCheckClientSourceBlockers(root, mobilePackage)),
    ...(await nativeConfigBlockers(root, firebaseEnvironments, projectId)),
    ...deploymentBlockers
  );
  firebaseBlockers.push(
    ...projectEvidenceBlocker(
      firebaseReadiness?.environment?.nativeAppsRegistered,
      projectId,
      "Firebase native 앱 등록 미검증"
    ),
    ...projectEvidenceBlocker(
      firebaseReadiness?.environment?.nativeAppsRegistered,
      projectId,
      "Firebase release native 앱 등록 미검증"
    ),
    ...evidenceBlocker(
      firebaseReadiness?.environment?.billingLinked,
      "Firebase 결제 계정 연결 미검증"
    ),
    ...evidenceBlocker(
      firebaseReadiness?.environment?.runtimeIamConfigured,
      "Functions runtime IAM 미검증"
    ),
    ...evidenceBlocker(
      firebaseReadiness?.environment?.callableInvokerIamConfigured,
      "Callable invoker IAM 설정 미검증"
    ),
    ...evidenceBlocker(
      firebaseReadiness?.environment?.livePairSmoke,
      "현재 Firebase source 기준 Pair smoke 미검증",
      { allowNotApplicable: false }
    ),
    ...productionCapabilityEvidenceBlockers({
      entry: firebaseReadiness?.environment?.productionBillingLinked,
      expectedProjectId: projectId,
      label: "운영 Firebase 결제 계정 연결",
    }),
    ...productionCapabilityEvidenceBlockers({
      entry: firebaseReadiness?.environment?.productionRuntimeIamConfigured,
      expectedProjectId: projectId,
      label: "운영 Functions runtime IAM",
    }),
    ...productionCapabilityEvidenceBlockers({
      entry:
        firebaseReadiness?.environment?.productionCallableInvokerIamConfigured,
      expectedProjectId: projectId,
      label: "운영 Callable invoker IAM",
    }),
    ...productionCapabilityEvidenceBlockers({
      entry: firebaseReadiness?.environment?.productionLivePairSmoke,
      expectedProjectId: projectId,
      label: "운영 Pair smoke",
    }),
    ...productionCapabilityEvidenceBlockers({
      entry: firebaseReadiness?.environment?.productionNotificationDelivery,
      expectedProjectId: projectId,
      label: "운영 APNs/FCM 수신",
      requiredChecks: [
        ["androidFcmReceived", "운영 Android FCM 실제 수신 미검증"],
        ["iosApnsReceived", "운영 iOS APNs 실제 수신 미검증"],
      ],
    }),
    ...productionCapabilityEvidenceBlockers({
      entry: firebaseReadiness?.environment?.productionGooglePlaySubscriptions,
      expectedProjectId: projectId,
      label: "운영 Google Play 구독 연동",
      requiredChecks: [
        ["developerApiVerified", "운영 Google Play Developer API 미검증"],
        ["rtdnVerified", "운영 Google Play RTDN 미검증"],
      ],
    }),
    ...productionCapabilityEvidenceBlockers({
      entry: firebaseReadiness?.environment?.productionAppleSubscriptions,
      expectedProjectId: projectId,
      label: "운영 Apple 구독 연동",
      requiredChecks: [
        ["secretsVerified", "운영 Apple subscription secrets 미검증"],
        [
          "notificationsV2Verified",
          "운영 App Store Server Notifications V2 미검증",
        ],
      ],
    }),
    ...productionCapabilityEvidenceBlockers({
      entry: firebaseReadiness?.environment?.productionAccountExport,
      expectedProjectId: projectId,
      label: "운영 계정 데이터 export",
      requiredChecks: [
        ["httpsInvokerVerified", "운영 export HTTPS invoker IAM 미검증"],
        ["cleanupSchedulerVerified", "운영 export cleanup scheduler 미검증"],
        [
          "legacyExportMyDataRemoved",
          "legacy exportMyData callable 제거 미검증",
        ],
      ],
    }),
    ...projectEvidenceBlocker(
      firebaseReadiness?.environment?.productionProject,
      projectId,
      "운영 Firebase 프로젝트 미확정"
    ),
    ...projectEvidenceBlocker(
      firebaseReadiness?.environment?.productionAuth,
      projectId,
      "운영 로그인 제공자 project-bound evidence 없음"
    ),
    ...appCheckEnforcementBlockers(
      firebaseReadiness?.environment?.appCheckEnforcement,
      projectId
    ),
    ...subscriptionBlockers.firebase
  );

  const googlePlayBlockers = [...googlePlayTarget.blockers];
  if (googlePlayTarget.included) {
    if (playConfig === null || containsUnknown(playConfig)) {
      googlePlayBlockers.push("Play 메타데이터에 미확정 값 존재");
    }
    const androidApplicationId = readAndroidApplicationId(
      androidAppGradle,
      firebaseEnvironments
    );
    if (
      !playConfig?.packageName ||
      playConfig.packageName !== androidApplicationId
    ) {
      googlePlayBlockers.push(
        "Play packageName과 Android applicationId 불일치"
      );
    }
    const targetSdk = parseAndroidTargetSdk(androidRootGradle);
    if (targetSdk === null || targetSdk < 36) {
      googlePlayBlockers.push("Google Play target API 36 이상 필요");
    }
    if (releaseUsesDebugSigning(androidAppGradle)) {
      googlePlayBlockers.push("Android release가 debug signing을 참조함");
    }
    if (
      !androidAppGradle?.includes("verifyReleaseSigning") ||
      !androidAppGradle?.includes("verifyReleasePrerequisites") ||
      !androidAppGradle?.includes("task.dependsOn(verifyReleasePrerequisites)")
    ) {
      googlePlayBlockers.push("Android release signing fail-closed gate 없음");
    }
    googlePlayBlockers.push(
      ...subscriptionBlockers.googlePlay,
      ...(await androidArtifactBlockers(
        root,
        releaseEvidence?.artifacts?.googlePlaySignedAab,
        playConfig?.packageName,
        mobilePackage?.version
      )),
      ...evidenceBlocker(
        releaseEvidence?.console?.googlePlayApp,
        "Play Console 앱 생성 evidence 없음",
        { allowNotApplicable: false }
      ),
      ...evidenceBlocker(
        releaseEvidence?.manualTests?.googlePlayTwoPerson,
        "Google Play internal 2인 테스트 evidence 없음",
        { allowNotApplicable: false }
      )
    );
  }

  const appStoreBlockers = [...appStoreTarget.blockers];
  if (appStoreTarget.included) {
    if (appStoreConfig === null || containsUnknown(appStoreConfig)) {
      appStoreBlockers.push("App Store 메타데이터에 미확정 값 존재");
    }
    const iosBundleIdentifiers = readIosBundleIdentifiers(iosProject);
    if (
      !appStoreConfig?.bundleId ||
      iosBundleIdentifiers.length === 0 ||
      iosBundleIdentifiers.some(
        (bundleId) => bundleId !== appStoreConfig.bundleId
      )
    ) {
      appStoreBlockers.push(
        "App Store bundleId와 Xcode PRODUCT_BUNDLE_IDENTIFIER 불일치"
      );
    }
    appStoreBlockers.push(
      ...subscriptionBlockers.appStore,
      ...appReviewCredentialBlockers(appStoreConfig?.review)
    );
    appStoreBlockers.push(
      ...(await appStoreArtifactBlockers(
        root,
        releaseEvidence?.artifacts?.appStoreArchive,
        appStoreConfig?.bundleId,
        appStoreConfig?.appleTeamId,
        mobilePackage?.version
      )),
      ...evidenceBlocker(
        releaseEvidence?.console?.appStoreConnectApp,
        "App Store Connect 앱 생성 evidence 없음",
        { allowNotApplicable: false }
      ),
      ...evidenceBlocker(
        releaseEvidence?.manualTests?.testFlightTwoPerson,
        "TestFlight 2인 테스트 evidence 없음",
        { allowNotApplicable: false }
      )
    );
  }

  const appsInTossBlockers = [...appsInTossTarget.blockers];
  if (appsInTossTarget.included) {
    if (appsInTossConfig === null || containsUnknown(appsInTossConfig)) {
      appsInTossBlockers.push("AppsInToss 설정에 미확정 값 존재");
    }
    const aitGraniteConfig = await readText(root, "apps/ait/granite.config.ts");
    const graniteAppName = aitGraniteConfig?.match(
      /^\s*appName:\s*["']([^"']+)["'],?\s*$/m
    )?.[1];
    if (
      appsInTossConfig?.appNameStatus !== "confirmed-console-match" ||
      graniteAppName !== appsInTossConfig?.appName
    ) {
      appsInTossBlockers.push(
        "AppsInToss appName Console 대조 미확정 또는 불일치"
      );
    }
    if (/placehold\.co/i.test(aitGraniteConfig ?? "")) {
      appsInTossBlockers.push("AppsInToss 정식 icon 미설정");
    }
    const appsInTossConsoleEvidence = releaseEvidence?.console?.appsInTossApp;
    if (
      hasAuditEvidence(appsInTossConsoleEvidence, {
        allowNotApplicable: false,
      }) &&
      appsInTossConsoleEvidence?.appName !== appsInTossConfig?.appName
    ) {
      appsInTossBlockers.push("AppsInToss Console appName evidence 불일치");
    }
    appsInTossBlockers.push(
      ...(await appsInTossArtifactBlockers(
        root,
        releaseEvidence?.artifacts?.appsInTossPackage,
        appsInTossConfig
      )),
      ...evidenceBlocker(
        releaseEvidence?.console?.appsInTossApp,
        "AppsInToss Console 앱 생성 evidence 없음",
        { allowNotApplicable: false }
      ),
      ...evidenceBlocker(
        releaseEvidence?.policy?.appsInTossCompatibility,
        "AppsInToss 민감정보·계정·구독 정책 검토 evidence 없음",
        { allowNotApplicable: false }
      ),
      ...evidenceBlocker(
        releaseEvidence?.manualTests?.appsInTossSandboxTwoPerson,
        "AppsInToss sandbox 2인 테스트 evidence 없음",
        { allowNotApplicable: false }
      )
    );
  }

  const privacyBlockers = [
    ...evidenceBlocker(
      releaseEvidence?.privacy?.privacyPolicy,
      "개인정보 처리방침 게시 evidence 없음",
      { allowNotApplicable: false }
    ),
    ...evidenceBlocker(
      releaseEvidence?.privacy?.accountDeletionPage,
      "계정 삭제 안내 페이지 게시 evidence 없음",
      { allowNotApplicable: false }
    ),
    ...evidenceBlocker(
      releaseEvidence?.privacy?.sensitiveHealthConsent,
      "민감 건강정보 동의문 검토 evidence 없음",
      { allowNotApplicable: false }
    ),
  ];
  if (googlePlayTarget.included) {
    privacyBlockers.push(
      ...evidenceBlocker(
        releaseEvidence?.policy?.googlePlayDataSafety,
        "Google Play Data safety 검토 evidence 없음",
        { allowNotApplicable: false }
      )
    );
  }
  if (appStoreTarget.included) {
    privacyBlockers.push(
      ...evidenceBlocker(
        releaseEvidence?.policy?.appStorePrivacy,
        "App Store privacy labels 검토 evidence 없음",
        { allowNotApplicable: false }
      )
    );
  }

  const approvalBlockers = [
    ...(releaseEvidence?.schemaVersion === 1
      ? []
      : ["release readiness evidence schema v1 필요"]),
    ...evidenceBlocker(
      releaseEvidence?.approvals?.deployment,
      "deployment approval evidence 없음",
      { allowNotApplicable: false }
    ),
  ];

  const sections = [
    { market: "Architecture", blockers: architectureBlockers },
    { market: "Firebase", blockers: firebaseBlockers },
    { market: "Google Play", blockers: googlePlayBlockers },
    { market: "App Store", blockers: appStoreBlockers },
    { market: "AppsInToss", blockers: appsInTossBlockers },
    { market: "Privacy", blockers: privacyBlockers },
    { market: "Approval", blockers: approvalBlockers },
  ];

  return {
    ready: sections.every((section) => section.blockers.length === 0),
    sections,
    sourceFingerprints: { firebase: firebaseFingerprints },
  };
}
