import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, openSync, writeSync, closeSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { resolvePrivateInput, privateInputEnvironment, IOS_ACCOUNT_CANARY_SCOPE } from './private-e2e-input.mjs';

const TARGET = 'CyclePairPhysicalUITests';
export const DEFAULT_FLOWS = Object.freeze({
  start: { method: 'testStartFromOnboarding', className: 'CyclePairCoordinatedUITests', secret: false, ready: true },
  'cold-home': { method: 'testColdHomeExposesAccessibleControls', secret: false, ready: true },
  language: { method: 'testLanguageChangeSurvivesColdRestart', secret: false, ready: true },
  record: { method: 'testRecordSurvivesColdRestart', secret: false, ready: true },
  'diagnostics-consent': { method: 'testDiagnosticsConsentSurvivesColdRestart', secret: false, ready: true },
  'privacy-read': { method: 'testPrivacyNoticeCanBeReadAndClosed', secret: false, ready: true },
  'invitation-canary': { method: 'testInvitationInputCanary', className: 'CyclePairCoordinatedUITests', canaryPurpose: 'invitation', secret: false, ready: true },
  'account-input-canary': { method: 'testAccountInputCanary', className: 'CyclePairCoordinatedUITests', canaryPurpose: 'account', secret: false, ready: true },
  'account-upgrade': { method: 'testAccountUpgrade', className: 'CyclePairCoordinatedUITests', inputKind: 'account', secret: true, ready: true },
  'account-logout': { method: 'testAccountLogout', className: 'CyclePairCoordinatedUITests', inputKind: 'account', secret: true, ready: true },
  'account-login': { method: 'testAccountLogin', className: 'CyclePairCoordinatedUITests', inputKind: 'account', secret: true, ready: true },
  'account-reauthenticate': { method: 'testAccountReauthenticate', className: 'CyclePairCoordinatedUITests', inputKind: 'account', secret: true, ready: true },
  'invitation-accept': { method: 'testInvitationAccept', className: 'CyclePairCoordinatedUITests', inputKind: 'invitation', secret: true, ready: true },
  'sharing-private': { method: 'testSharingPrivate', className: 'CyclePairCoordinatedUITests', secret: false, ready: true },
  'partner-received': { method: 'testPartnerReceived', className: 'CyclePairCoordinatedUITests', secret: false, ready: true },
  'event-received': { method: 'testEventReceived', className: 'CyclePairCoordinatedUITests', secret: false, ready: true },
  'partner-revoked': { method: 'testPartnerRevoked', className: 'CyclePairCoordinatedUITests', secret: false, ready: true },
  'disconnected-restart': { method: 'testDisconnectedRestart', className: 'CyclePairCoordinatedUITests', secret: false, ready: true },
});
const tokenCharacter = char => /^[A-Za-z0-9_-]$/.test(char);

/** 한 stream의 UTF-8와 임의 chunk 경계를 보존한다. 긴 token은 길이 제한 없이 가린다. */
export function createStreamRedactor(secretValues = []) {
  const secrets = [...new Set(secretValues
    .filter(value => typeof value === 'string' && value.length)
    .flatMap(value => {
      const forms = [...new Set([value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)])];
      const variants = [...forms];
      // XCTest abbreviates typeText activity even when attachments are disabled.
      for (const form of forms) for (let length = 1; length < form.length; length++) {
        const prefix = form.slice(0, length);
        variants.push(`${prefix}...`, `${prefix}…`);
      }
      return variants;
    }))].sort((a, b) => b.length - a.length);
  const hold = Math.max(1, ...secrets.map(value => value.length));
  const decoder = new StringDecoder('utf8');
  let pending = '', suppressToken = false, ended = false;
  function drain(final) {
    let result = '', i = 0;
    while (i < pending.length) {
      if (suppressToken) {
        while (i < pending.length && tokenCharacter(pending[i])) i++;
        if (i === pending.length) break;
        suppressToken = false;
      }
      if (!final && pending.length - i < hold) break;
      const exact = secrets.find(secret => pending.startsWith(secret, i));
      if (exact) { result += '[redacted]'; i += exact.length; continue; }
      if (tokenCharacter(pending[i])) {
        let end = i;
        while (end < pending.length && tokenCharacter(pending[end])) end++;
        if (end - i >= 43) {
          result += '[redacted]';
          suppressToken = !final && end === pending.length;
          i = end;
          continue;
        }
        if (!final && end === pending.length) break;
      }
      result += pending[i++];
    }
    pending = pending.slice(i);
    return result;
  }
  return {
    push(chunk) {
      if (ended) throw new Error('이미 종료한 로그 stream');
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      return drain(false);
    },
    end() {
      if (ended) throw new Error('이미 종료한 로그 stream');
      ended = true;
      pending += decoder.end();
      return drain(true);
    },
  };
}

const digest = value => createHash('sha256').update(value).digest('hex');
const sanitize = (text, secrets) => {
  const redactor = createStreamRedactor(secrets);
  return redactor.push(String(text)) + redactor.end();
};

export async function validateCanaryReceipt({ receipt, baseXctestrun, ownership, candidateSha, privateRoot, purpose }) {
  const expected = {
    invitation: ['invitation-canary', 'CyclePairCoordinatedUITests/testInvitationInputCanary'],
    account: ['account-input-canary', 'CyclePairCoordinatedUITests/testAccountInputCanary'],
  }[purpose];
  if (!expected) throw new Error('공개 입력 시험의 목적을 명시해야 합니다');
  const root = await realpath(privateRoot);
  const file = await ownedPath(root, receipt);
  await assertPrivateFile(file);
  const record = JSON.parse(await readFile(file, 'utf8'));
  const base = await ownedPath(root, baseXctestrun);
  const manifestFile = await ownedPath(root, ownership);
  await assertPrivateFile(base);
  await assertPrivateFile(manifestFile);
  const counts = record.counts;
  let metadata = '';
  const inspected = await runOwnedCommand('/usr/bin/python3', [fileURLToPath(new URL('./prepare-xctestrun.py', import.meta.url))], {
    input: JSON.stringify({ source: base, inspectOnly: true }),
    onStdout: chunk => { metadata += chunk; }, onStderr: () => {}, timeoutMs: 30_000,
  });
  if (inspected.code !== 0 || inspected.timedOut || inspected.ownedGroupCleaned !== true)
    throw new Error('현재 signed helper 지문을 읽을 수 없습니다');
  const fingerprint = JSON.parse(metadata);
  if (record.executionMode !== 'physical' || record.flow !== expected[0] || record.passed !== true ||
      record.testIdentifier !== expected[1] || record.diagnosticOnly !== false ||
      record.plistPreparation?.testBundleExecutableSHA256 !== fingerprint.testBundleExecutableSHA256 ||
      record.sourceSha !== candidateSha || record.requestedCandidateSha !== candidateSha ||
      record.ownershipManifestSHA256 !== digest(await readFile(manifestFile)) ||
      record.plistPreparation?.sourceSHA256 !== digest(await readFile(base)) ||
      record.summaryDeviceMatches !== true || record.ownedXcodebuildGroupCleaned !== true || record.privateRawRemoved !== true ||
      counts?.totalTestCount !== 1 || counts.passedTests !== 1 || counts.failedTests !== 0 || counts.skippedTests !== 0 || counts.expectedFailures !== 0)
    throw new Error('같은 후보, 설치와 도우미에서 공개 입력 시험이 실제 통과하고 정리된 근거가 필요합니다');
  if (purpose === 'account') {
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    const account = await ownedPath(root, manifest.accountOwnershipPath);
    await assertPrivateFile(account);
    if (record.accountOwnershipSHA256 !== digest(await readFile(account)) ||
        Object.entries(IOS_ACCOUNT_CANARY_SCOPE).some(([key, value]) => record.canaryScope?.[key] !== value))
      throw new Error('같은 소유 계정과 제한된 계정 canary 범위가 필요합니다');
  }
  return true;
}
function cleanEnvironment() {
  const result = {};
  for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'DEVELOPER_DIR', 'TMPDIR'])
    if (process.env[name]) result[name] = process.env[name];
  return result;
}

/** detached spawn으로 만든 PGID만 종료한다. spawn 실패나 외부 PID에는 신호를 보내지 않는다. */
export function runOwnedCommand(command, args, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const kill = options.killImpl || ((pid, signal) => process.kill(pid, signal));
  const pause = options.pauseImpl || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd: options.cwd, env: options.env || cleanEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: true,
    });
    let ownedPgid, escalation, stopped = false, timedOut = false, abortRequested = false;
    const signalGroup = signal => {
      if (!ownedPgid || ownedPgid !== child.pid || ownedPgid <= 1 || ownedPgid === process.pid) return false;
      try { kill(-ownedPgid, signal); return true; }
      catch (error) { if (error.code === 'ESRCH') return false; throw error; }
    };
    const abort = () => {
      if (stopped || abortRequested) return;
      abortRequested = true;
      if (ownedPgid) {
        signalGroup('SIGINT');
        escalation = setTimeout(() => { if (!stopped) signalGroup('SIGKILL'); }, 5000);
        escalation.unref?.();
      }
    };
    const timeout = options.timeoutMs ? setTimeout(() => { timedOut = true; abort(); }, options.timeoutMs) : undefined;
    const cleanup = () => {
      stopped = true;
      clearTimeout(timeout); clearTimeout(escalation);
      options.signal?.removeEventListener('abort', abort);
    };
    child.stdout.on('data', options.onStdout || (() => {}));
    child.stderr.on('data', options.onStderr || (() => {}));
    child.once('spawn', () => {
      if (Number.isSafeInteger(child.pid) && child.pid > 1 && child.pid !== process.pid) ownedPgid = child.pid;
      if (abortRequested && ownedPgid) {
        signalGroup('SIGINT');
        escalation = setTimeout(() => { if (!stopped) signalGroup('SIGKILL'); }, 5000);
        escalation.unref?.();
      }
    });
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', async (code, signal) => {
      // leader가 끝나도 같은 소유 그룹의 후손이 쓰기를 계속할 수 있으므로 먼저 정리한다.
      let ownedGroupCleaned = !ownedPgid;
      try {
        if (ownedPgid) {
          let alive = signalGroup(0);
          if (alive) {
            signalGroup('SIGINT');
            for (let i = 0; i < 10 && (alive = signalGroup(0)); i++) await pause(100);
            if (alive) {
              signalGroup('SIGKILL');
              for (let i = 0; i < 10 && (alive = signalGroup(0)); i++) await pause(100);
            }
          }
          ownedGroupCleaned = !alive;
        }
      } catch { ownedGroupCleaned = false; }
      cleanup();
      resolve({ code, signal, timedOut, ownedGroupCleaned });
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdin.on('error', () => {}); // spawn 실패 시 EPIPE에 원문을 출력하지 않는다.
    child.stdin.end(options.input);
  });
}

async function assertPrivateFile(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077))
    throw new Error('소유 비공개 일반 파일이 필요합니다');
}
function within(root, candidate) {
  return candidate.startsWith(root + path.sep);
}
async function ownedPath(privateRoot, candidate, isNew = false) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw new Error('비공개 작업 공간 절대 경로 필요');
  const resolved = isNew ? path.join(await realpath(path.dirname(candidate)), path.basename(candidate)) : await realpath(candidate);
  if (!within(privateRoot, resolved)) throw new Error('소유 비공개 작업 공간 밖의 경로 거절');
  return resolved;
}
async function rawBundleHash(directory) {
  let files = 0, bytes = 0;
  const hash = createHash('sha256');
  async function visit(current, relative = '') {
    for (const name of (await readdir(current)).sort()) {
      const file = path.join(current, name), rel = path.join(relative, name), stat = await lstat(file);
      hash.update(rel).update('\0');
      if (stat.isSymbolicLink()) throw new Error('원시 bundle 심볼릭 링크 거절');
      if (stat.isDirectory()) await visit(file, rel);
      else if (stat.isFile()) {
        files++; bytes += stat.size;
        for await (const chunk of createReadStream(file)) hash.update(chunk);
      } else throw new Error('지원하지 않는 원시 bundle 파일');
    }
  }
  try { await visit(directory); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return { sha256: hash.digest('hex'), files, bytes };
}

/** 한 실제 UI 흐름을 실행한다. 전체 회귀와 독립 검수 판정은 별도 실행 원장에서 확인한다. */
export async function runPhysicalIosFlow(options, dependencies = {}) {
  const execute = dependencies.runCommand || runOwnedCommand;
  const fake = Boolean(dependencies.runCommand);
  const flows = dependencies.flowDefinitions || DEFAULT_FLOWS;
  const flow = flows[options.flow];
  const className = flow?.className || TARGET;
  if (!flow || !/^[a-z][a-z-]{0,40}$/.test(options.flow) ||
      !/^test[A-Za-z0-9]+$/.test(flow.method) || !/^[A-Za-z][A-Za-z0-9]+$/.test(className)) throw new Error('허용한 단일 flow 필요');
  if (typeof options.deviceId !== 'string' || !/^(?:[0-9a-f]{8}-[0-9a-f]{16}|[0-9a-f]{40})$/i.test(options.deviceId) || options.destination !== undefined)
    throw new Error('명시한 물리 iPhone UDID만 허용하며 destination 재정의는 거절합니다');
  if (!/^cp-\d{17}-[a-f0-9]{6}$/.test(options.runId)) throw new Error('합성 실행 ID 형식 필요');
  if (!flow.ready) throw new Error('UI helper 계약과 canary 검증이 준비되지 않은 flow');
  if (flow.secret && (!options.allowSecretExecution || !options.secretTransportValidated))
    throw new Error('비밀 flow는 공개 canary와 입력 경로 검증이 선행되어야 합니다');
  if (options.invitation !== undefined) throw new Error('typed private input을 사용해야 합니다');
  const input = resolvePrivateInput(flow, options.privateInput);
  if (flow.secret !== Boolean(options.privateInput)) throw new Error('flow와 비밀 입력 범위가 다릅니다');
  if (!fake && options.executePhysical !== true) throw new Error('실제 실행은 명시적으로 선택해야 합니다');
  // 공개 canary도 향후 비밀 입력과 같은 exact-value 가림 경로를 검증한다.
  const secrets = input.secrets;
  for (const value of [options.baseXctestrun, options.ownership, options.output])
    if (secrets.some(secret => typeof value === 'string' && value.includes(secret)))
      throw new Error('파일 경로에 비밀값을 넣을 수 없습니다');
  if (typeof options.privateRoot !== 'string' || !path.isAbsolute(options.privateRoot))
    throw new Error('소유 비공개 작업 공간의 절대 경로가 필요합니다');
  const privateRoot = await realpath(options.privateRoot);
  const sourceRoot = await realpath(process.cwd());
  if (privateRoot === sourceRoot || within(sourceRoot, privateRoot))
    throw new Error('비공개 실행 자료는 소스 트리 밖에 보관해야 합니다');
  const base = await ownedPath(privateRoot, options.baseXctestrun);
  const ownershipPath = await ownedPath(privateRoot, options.ownership);
  const output = await ownedPath(privateRoot, options.output, true);
  await assertPrivateFile(base); await assertPrivateFile(ownershipPath);
  const manifestBytes = await readFile(ownershipPath);
  const manifest = JSON.parse(manifestBytes);
  const runtime = manifest.runtimes?.find(item => item.deviceId === options.deviceId);
  if (manifest.app !== 'cycle-pair' || !['emulator', 'service'].includes(options.backend) || manifest.backend !== options.backend || !runtime ||
      runtime.platform !== 'ios' || runtime.kind !== 'physical' || runtime.authorized !== true ||
      runtime.appData !== 'synthetic' || runtime.allowAppDataReset !== false ||
      runtime.appId !== 'com.seorilabs.cyclepair' ||
      runtime.createdFor !== 'cycle-pair-native-launch' ||
      !/^[a-f0-9]{40}$/.test(manifest.installedSourceSha || ''))
    throw new Error('승인한 소유 synthetic physical iOS manifest 필요');
  const account = await ownedPath(privateRoot, manifest.accountOwnershipPath);
  await assertPrivateFile(account);
  const accountOwnershipSHA256 = digest(await readFile(account));
  if (!/^[a-f0-9]{40}$/.test(options.candidateSha || '') || options.candidateSha !== manifest.installedSourceSha)
    throw new Error('설치 후보와 요청 후보가 다릅니다');
  if (input.kind === 'account' && options.privateInput && !fake)
    await validateCanaryReceipt({ receipt: options.inputValidation, baseXctestrun: base, ownership: ownershipPath,
      candidateSha: options.candidateSha, privateRoot, purpose: 'account' });
  const redactors = { stdout: createStreamRedactor(secrets), stderr: createStreamRedactor(secrets) };
  await mkdir(output, { mode: 0o700 }); // 덮어쓰기 금지
  const temporary = await mkdtemp(path.join(output, '.private-raw-'));
  const privatePlist = path.join(temporary, 'private.xctestrun');
  const resultBundle = path.join(temporary, 'result.xcresult');
  const abort = new AbortController();
  const signalSource = dependencies.signalSource || process;
  let cancelledBy = null;
  const interrupted = () => { cancelledBy = 'SIGINT'; abort.abort(); };
  const terminated = () => { cancelledBy = 'SIGTERM'; abort.abort(); };
  signalSource.on('SIGINT', interrupted); signalSource.on('SIGTERM', terminated);
  const externalAbort = () => { cancelledBy = 'abort'; abort.abort(); };
  options.signal?.addEventListener('abort', externalAbort, { once: true });
  if (options.signal?.aborted) externalAbort();
  const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') };
  const log = openSync(path.join(output, 'xcodebuild.redacted.log'), 'wx', 0o600);
  const record = { tool: 'xctest', executionMode: fake ? 'injected-fake' : 'physical',
    sourceSha: manifest.installedSourceSha, requestedCandidateSha: options.candidateSha || null,
    flow: options.flow, testIdentifier: `${className}/${flow.method}`,
    diagnosticOnly: Boolean(dependencies.flowDefinitions), runId: options.runId, startedAt: new Date().toISOString(),
    ownershipManifestSHA256: digest(manifestBytes), formalUIRounds: 0, fullL3: false,
    privateInputKind: input.kind, privateInputProvided: Boolean(options.privateInput),
    accountOwnershipSHA256,
    ...(flow.canaryPurpose === 'account' ? { canaryScope: IOS_ACCOUNT_CANARY_SCOPE } : {}),
    passed: false, status: 'failed',
    automaticRetry: false, attachmentPolicy: { system: 'keepNever', user: 'keepNever' } };
  let summaryText = '', summaryStderr = '', summaryCode, failure;
  const stream = name => chunk => {
    hashes[name].update(chunk);
    const safe = redactors[name].push(chunk);
    if (safe) writeSync(log, safe);
  };
  try {
    const environment = { CYCLEPAIR_PHYSICAL_UI_APPROVED: '1', CYCLEPAIR_SYNTHETIC_INSTALLATION: '1',
      CYCLEPAIR_TEST_RUN_ID: options.runId, CYCLEPAIR_CAPTURE_SAFE_SCREENS: '0',
      CYCLEPAIR_TEST_FLOW: options.flow, ...privateInputEnvironment(input, 'ios') };
    if (options.privateInput) {
      environment.CYCLEPAIR_SECRET_INPUT_VALIDATED = '1';
    }
    let preparation = '';
    const prepared = await runOwnedCommand('/usr/bin/python3', [fileURLToPath(new URL('./prepare-xctestrun.py', import.meta.url))], {
      input: JSON.stringify({ source: base, destination: privatePlist, environment, identifier: `${className}/${flow.method}` }),
      onStdout: chunk => { preparation += chunk; }, onStderr: () => {},
      signal: abort.signal, timeoutMs: 30_000,
    });
    if (prepared.code !== 0 || prepared.timedOut || prepared.ownedGroupCleaned === false || abort.signal.aborted) throw new Error('비공개 plist 준비 실패');
    record.plistPreparation = JSON.parse(preparation);
    const executed = await execute('/usr/bin/xcodebuild', [
      'test-without-building', '-xctestrun', privatePlist,
      '-destination', `platform=iOS,id=${options.deviceId}`,
      '-destination-timeout', '20', '-parallel-testing-enabled', 'NO',
      '-collect-test-diagnostics', 'never', '-enableCodeCoverage', 'NO',
      `-only-testing:${TARGET}/${className}/${flow.method}`, '-resultBundlePath', resultBundle,
    ], { env: cleanEnvironment(), signal: abort.signal, timeoutMs: options.timeoutMs || 300_000,
      onStdout: stream('stdout'), onStderr: stream('stderr') });
    record.xcodebuildExitCode = executed.code;
    record.xcodebuildSignal = executed.signal || null;
    record.xcodebuildTimedOut = executed.timedOut === true;
    record.ownedXcodebuildGroupCleaned = executed.ownedGroupCleaned !== false;
    if (!abort.signal.aborted) {
      const summarized = await execute('/usr/bin/xcrun', ['xcresulttool', 'get', 'test-results', 'summary',
        '--schema-version', '0.4.0', '--path', resultBundle, '--compact'], {
        env: cleanEnvironment(), signal: abort.signal, timeoutMs: 30_000,
        onStdout: chunk => { summaryText += chunk; if (summaryText.length > 4_000_000) abort.abort(); },
        onStderr: chunk => { summaryStderr += chunk; if (summaryStderr.length > 4_000_000) abort.abort(); },
      });
      summaryCode = summarized.code;
      if (summaryCode === 0) {
        const summary = JSON.parse(summaryText);
        record.counts = Object.fromEntries(['totalTestCount', 'passedTests', 'failedTests', 'skippedTests', 'expectedFailures']
          .map(key => [key, summary[key]]));
        const entries = summary.devicesAndConfigurations;
        const device = Array.isArray(entries) && entries.length === 1 ? entries[0].device : undefined;
        record.summaryDeviceMatches = device?.deviceId === options.deviceId &&
          typeof device?.platform === 'string' && /^iOS$/i.test(device.platform);
        record.passed = executed.code === 0 && !executed.signal && !executed.timedOut && !summarized.timedOut && executed.ownedGroupCleaned !== false && summarized.ownedGroupCleaned !== false && !abort.signal.aborted &&
          summary.result === 'Passed' && summary.totalTestCount === 1 && summary.passedTests === 1 &&
          summary.failedTests === 0 && summary.skippedTests === 0 && summary.expectedFailures === 0 &&
          record.summaryDeviceMatches && (summary.testFailures?.length === 0);
      }
    }
  } catch (error) {
    failure = sanitize(error?.message || '실행 도구 오류', secrets);
  } finally {
    try {
      try {
        for (const name of ['stdout', 'stderr']) {
          const tail = redactors[name].end();
          if (tail) writeSync(log, tail);
        }
      } finally { closeSync(log); }
      record.rawLogSHA256 = Object.fromEntries(Object.entries(hashes).map(([name, hash]) => [name, hash.digest('hex')]));
      record.rawSummarySHA256 = summaryText ? digest(summaryText) : null;
      record.rawSummaryStderrSHA256 = summaryStderr ? digest(summaryStderr) : null;
      record.summaryExitCode = summaryCode ?? null;
      try { record.rawBundleHash = await rawBundleHash(resultBundle); }
      catch { record.rawBundleHash = null; record.rawBundleHashFailed = true; record.passed = false; }
      // 실패해도 비식별 요약과 원시 hash만 남긴다. 첨부는 내보내지 않는다.
      if (summaryText) await writeFile(path.join(output, 'summary.redacted.json'), sanitize(summaryText, secrets), { mode: 0o600, flag: 'wx' });
      if (summaryStderr) await writeFile(path.join(output, 'summary.stderr.redacted.log'), sanitize(summaryStderr, secrets), { mode: 0o600, flag: 'wx' });
    } catch {
      record.artifactWriteFailed = true; record.passed = false;
    } finally {
      try {
        if (record.ownedXcodebuildGroupCleaned === false) {
          record.privateRawRemoved = false; record.privateRawRetentionReason = '소유 실행 그룹 종료 확인 실패'; record.passed = false;
        } else { await rm(temporary, { recursive: true, force: true }); record.privateRawRemoved = true; }
      }
      catch { record.privateRawRemoved = false; record.passed = false; }
      signalSource.off('SIGINT', interrupted); signalSource.off('SIGTERM', terminated);
      options.signal?.removeEventListener('abort', externalAbort);
    }
    record.cancelledBy = cancelledBy;
    if (cancelledBy || abort.signal.aborted) record.passed = false;
    record.status = record.passed ? 'passed' : cancelledBy ? 'cancelled' : 'failed';
    record.error = failure || null;
    record.completedAt = new Date().toISOString();
    await writeFile(path.join(output, 'result.json'), JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx' });
  }
  return record;
}
