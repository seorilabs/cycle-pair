import {lstat, readFile, realpath, readdir, rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ACCOUNT_CANARY_SCOPE, resolvePrivateInput} from './private-e2e-input.mjs';

export const ANDROID_AUTH_FLOWS = Object.freeze(['account-upgrade', 'account-logout', 'account-login', 'account-reauthenticate']);
export const ANDROID_CANARY_STAGES = Object.freeze(['initial-email-empty', 'initial-password-empty', 'initial-confirm-empty',
  'email-exact', 'password-masked', 'confirm-masked', 'closed', 'reopened', 'cleared-email', 'cleared-password', 'cleared-confirm', 'closed-again']);
const ERROR = '같은 후보의 실제 Android 공개 canary 통과와 소유 비공개 입력이 필요합니다';
const digest = value => createHash('sha256').update(value).digest('hex');

export async function removeAndroidRawAfterGroup(temporary, ownedGroupCleaned) {
  if (ownedGroupCleaned !== true) return false;
  await rm(temporary, {recursive: true, force: true});
  return true;
}

export function androidAuthRequested(options) {
  if (options.runtimes?.[0]?.platform !== 'android') {
    if (options.inputFile || options.receipt) throw new Error(ERROR);
    return false;
  }
  const flows = options.flow?.split(',') || [];
  const requested = flows.some(flow => ANDROID_AUTH_FLOWS.includes(flow));
  if (!requested) {
    if (options.inputFile || options.receipt) throw new Error(ERROR);
    return false;
  }
  if (!options.authoring || options.backend !== 'emulator' || options.scope !== 'solo' ||
      options.runtimes?.length !== 1 || options.runtimes[0].platform !== 'android' ||
      options.runtimes[0].appId !== 'com.seorilabs.cyclepair.qa' || !options.inputFile || !options.receipt ||
      flows.some((flow, index) => !ANDROID_AUTH_FLOWS.includes(flow) ||
        (index > 0 && ANDROID_AUTH_FLOWS.indexOf(flow) <= ANDROID_AUTH_FLOWS.indexOf(flows[index - 1])))) throw new Error(ERROR);
  return true;
}
async function privateFile(root, file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !file.startsWith(root + path.sep) || await realpath(file) !== file) throw new Error(ERROR);
  for (let current = file; current !== root; current = path.dirname(current))
    if ((await lstat(current)).isSymbolicLink()) throw new Error(ERROR);
  const stat = await lstat(file);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid()) throw new Error(ERROR);
  return file;
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function maestroFingerprint(binary) {
  const executable = await realpath(binary), lib = path.resolve(path.dirname(executable), '../lib');
  const files = (await readdir(lib)).filter(file => file.endsWith('.jar')).sort();
  if (!files.length) throw new Error(ERROR);
  const entries = [['bin/maestro', await hashFile(executable)]];
  for (const file of files) {
    const full = path.join(lib, file), stat = await lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(ERROR);
    entries.push(['lib/' + file, await hashFile(full)]);
  }
  return digest(JSON.stringify(entries));
}
export async function androidAccountBinding({ownership, candidateSha, privateRoot, maestro, sourceRoot}) {
  try {
    const root = await realpath(privateRoot), stat = await lstat(root);
    if ((stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid() || !/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error(ERROR);
    const bytes = await readFile(await privateFile(root, ownership)), manifest = JSON.parse(bytes);
    const runtime = manifest.runtimes?.[0];
    if (manifest.app !== 'cycle-pair' || manifest.backend !== 'emulator' || manifest.runtimes.length !== 1 ||
        runtime?.platform !== 'android' || runtime.kind !== 'physical' || runtime.createdFor !== 'cycle-pair-native-launch' || runtime.authorized !== true ||
        runtime.appData !== 'synthetic' || runtime.allowAppDataReset !== false || runtime.appId !== 'com.seorilabs.cyclepair.qa' ||
        typeof runtime.deviceId !== 'string' || !runtime.deviceId || runtime.deviceId.startsWith('emulator-') ||
        manifest.candidateSourceSha !== candidateSha || manifest.nativeArtifactBuildSourceSha !== candidateSha ||
        manifest.installedArtifactReadbackInThisRun !== true) throw new Error(ERROR);
    const account = await readFile(await privateFile(root, manifest.accountOwnershipPath)), owner = JSON.parse(account);
    if (owner.app !== 'cycle-pair' || owner.backend !== 'emulator' || owner.syntheticOnly !== true || owner.platform !== 'android' ||
        owner.appId !== runtime.appId || owner.deviceId !== runtime.deviceId || typeof owner.uid !== 'string' || !owner.uid) throw new Error(ERROR);
    const apk = await hashFile(manifest.artifactPath);
    if (apk !== manifest.artifactSHA256 || apk !== manifest.installedArtifactSHA256) throw new Error(ERROR);
    const flows = ['account-input-canary', ...ANDROID_AUTH_FLOWS];
    const flowFiles = await Promise.all(flows.map(async flow => [flow, await hashFile(path.join(sourceRoot, `e2e/flows/${flow}.yaml`))]));
    flowFiles.push(['read-account-empty', await hashFile(path.join(sourceRoot, 'e2e/scripts/read-account-empty.js'))]);
    return {sourceSha: candidateSha, ownershipManifestSHA256: digest(bytes), accountOwnershipSHA256: digest(account),
      apkSHA256: apk, maestroSHA256: await maestroFingerprint(maestro), flowSHA256: digest(JSON.stringify(flowFiles))};
  } catch { throw new Error(ERROR); }
}
export function makeAndroidAccountCanaryReceipt(binding, execution) {
  const passed = execution.passed === true && execution.sourceDirty === false &&
    ANDROID_CANARY_STAGES.every(stage => execution.stages.includes(stage)) &&
    ['ownedMaestroGroupCleaned', 'privateRawRemoved', 'keyboardSubtypesRestored', 'reversePortsRestored'].every(key => execution[key] === true);
  return {...binding, purpose: 'account', flow: 'account-input-canary', executionMode: 'physical', driver: 'maestro',
    passed, sourceDirty: execution.sourceDirty !== false, completedAt: new Date().toISOString(), diagnosticOnly: false, canaryScope: ACCOUNT_CANARY_SCOPE,
    counts: {totalTests: 1, passedTests: passed ? 1 : 0, failedTests: passed ? 0 : 1, skippedTests: 0},
    ownedMaestroGroupCleaned: execution.ownedMaestroGroupCleaned === true, privateRawRemoved: execution.privateRawRemoved === true,
    keyboardSubtypesRestored: execution.keyboardSubtypesRestored === true, reversePortsRestored: execution.reversePortsRestored === true};
}
export async function loadAndroidAccountInput(options, dependencies = {}) {
  try {
    const root = await realpath(options.privateRoot);
    const binding = await androidAccountBinding(options);
    const receipt = JSON.parse(await readFile(await privateFile(root, options.receipt)));
    if (Object.entries(binding).some(([key, value]) => receipt[key] !== value) || receipt.purpose !== 'account' ||
        receipt.flow !== 'account-input-canary' || receipt.executionMode !== 'physical' || receipt.driver !== 'maestro' ||
        receipt.passed !== true || receipt.sourceDirty !== false || receipt.diagnosticOnly !== false ||
        !Number.isFinite(Date.parse(receipt.completedAt)) || Date.parse(receipt.completedAt) > Date.now() ||
        Date.now() - Date.parse(receipt.completedAt) > 168 * 60 * 60 * 1000 ||
        Object.entries(ACCOUNT_CANARY_SCOPE).some(([key, value]) => receipt.canaryScope?.[key] !== value) ||
        receipt.counts?.totalTests !== 1 || receipt.counts.passedTests !== 1 || receipt.counts.failedTests !== 0 || receipt.counts.skippedTests !== 0 ||
        ['ownedMaestroGroupCleaned', 'privateRawRemoved', 'keyboardSubtypesRestored', 'reversePortsRestored'].some(key => receipt[key] !== true)) throw new Error(ERROR);
    const input = JSON.parse(await (dependencies.readInputFile || readFile)(await privateFile(root, options.inputFile), 'utf8'));
    resolvePrivateInput({inputKind: 'account'}, input);
    return {inputKind: 'account', privateInput: input};
  } catch { throw new Error(ERROR); }
}
