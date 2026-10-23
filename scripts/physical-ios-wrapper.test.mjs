import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { DEFAULT_FLOWS, createStreamRedactor, runPhysicalIosFlow, runOwnedCommand, validateCanaryReceipt } from './physical-ios-wrapper.mjs';
import { ACCOUNT_CANARY_SCOPE, IOS_ACCOUNT_CANARY_SCOPE, PUBLIC_ACCOUNT_CANARY, resolvePrivateInput, privateInputEnvironment } from './private-e2e-input.mjs';
const APPROVED_DEVICE_ID = '00000000-0000000000000000';
// 아래 값은 공개된 고정 가짜 값이며 실제 초대를 생성하지 않는다.
const CANARY = 'C'.repeat(43), OTHER = 'Z'.repeat(500), RUN = 'cp-20261023010000000-abcdef', SHA = '1'.repeat(40);
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'cyclepair-ios-wrapper-unit-')));
const fakeFlows = { ...DEFAULT_FLOWS, 'invitation-accept': { ...DEFAULT_FLOWS['invitation-accept'], ready: true } };
let index = 0;
const py = (script, args = []) => execFileSync('/usr/bin/python3', ['-c', script, ...args], { encoding: 'utf8' });
const exec = promisify(execFile);
const baseFingerprint = source => JSON.parse(execFileSync('/usr/bin/python3', [new URL('./prepare-xctestrun.py', import.meta.url).pathname], { input: JSON.stringify({ source, inspectOnly: true }), encoding: 'utf8' }));
async function fixture(binary = false) {
  const dir = path.join(root, `case-${index++}`); await mkdir(dir, { mode: 0o700 });
  const base = path.join(dir, 'base.xctestrun');
  py(`import plistlib,sys,pathlib,datetime
p=pathlib.Path(sys.argv[1]); d={'CyclePairPhysicalUITests':{'IsUITestBundle':True,'TestHostPath':'__TESTROOT__/Debug-iphoneos/Runner.app','TestBundlePath':'__TESTHOST__/PlugIns/Test.xctest','EnvironmentVariables':{'NORMAL':'preserve','CYCLEPAIR_TEST_RUN_ID':'stale'},'SystemAttachmentLifetime':'keepAlways','UserAttachmentLifetime':'keepAlways','UnknownData':b'abc','UnknownDate':datetime.datetime(2026,10,23)},'__xctestrun_metadata__':{'FormatVersion':1}}; p.write_bytes(plistlib.dumps(d,fmt=plistlib.FMT_BINARY if sys.argv[2]=='true' else plistlib.FMT_XML,sort_keys=False))`, [base, String(binary)]);
  await chmod(base, 0o600);
  const bundle = path.join(dir, 'Debug-iphoneos/Runner.app/PlugIns/Test.xctest');
  await mkdir(bundle, { recursive: true, mode: 0o700 });
  py("import pathlib,plistlib,sys;pathlib.Path(sys.argv[1]).write_bytes(plistlib.dumps({'CFBundleExecutable':'Test'}))", [path.join(bundle, 'Info.plist')]);
  const helper = path.join(bundle, 'Test');
  await writeFile(helper, 'synthetic UI helper binary');
  const account = path.join(dir, 'owned-account.json'); await writeFile(account, '{"syntheticOnly":true}', { mode: 0o600 });
  const manifest = { app: 'cycle-pair', backend: 'emulator', installedSourceSha: SHA, accountOwnershipPath: account,
    runtimes: [{ platform: 'ios', kind: 'physical', deviceId: APPROVED_DEVICE_ID, appId: 'com.seorilabs.cyclepair', createdFor: 'cycle-pair-native-launch', authorized: true, appData: 'synthetic', allowAppDataReset: false }] };
  const ownership = path.join(dir, 'owned.json'); await writeFile(ownership, JSON.stringify(manifest), { mode: 0o600 });
  return { dir, base, helper, manifest, ownership, options: { privateRoot: dir, backend: 'emulator', baseXctestrun: base, ownership, deviceId: APPROVED_DEVICE_ID, flow: 'cold-home', runId: RUN, output: path.join(dir, 'output'), candidateSha: SHA } };
}
function summary(patch = {}) { return { result: 'Passed', totalTestCount: 1, passedTests: 1, failedTests: 0, skippedTests: 0, expectedFailures: 0, testFailures: [], devicesAndConfigurations: [{ device: { deviceId: APPROVED_DEVICE_ID, platform: 'iOS' } }], ...patch }; }
function fake(overrides = {}) {
  const calls = []; let plistPath, bundlePath;
  const runCommand = async (command, args, options) => {
    calls.push({ command, args, env: options.env });
    if (command === '/usr/bin/xcodebuild') {
      plistPath = args[args.indexOf('-xctestrun') + 1]; bundlePath = args[args.indexOf('-resultBundlePath') + 1];
      assert.ok(!args.some(value => value.includes(CANARY)), '가짜 비밀은 CLI에 없음');
      assert.ok(!JSON.stringify(options.env).includes(CANARY), '가짜 비밀은 실행 프로세스 env에 없음');
      assert.ok(args.includes(`platform=iOS,id=${APPROVED_DEVICE_ID}`));
      assert.equal((await stat(plistPath)).mode & 0o777, 0o600); assert.equal((await stat(path.dirname(plistPath))).mode & 0o777, 0o700);
      const prepared = JSON.parse(py(`import plistlib,json,sys
p=plistlib.load(open(sys.argv[1],'rb'))['CyclePairPhysicalUITests']; print(json.dumps({k:p[k] for k in ['EnvironmentVariables','TestHostPath','TestBundlePath','OnlyTestIdentifiers','SystemAttachmentLifetime','UserAttachmentLifetime']}))`, [plistPath]));
      assert.equal(prepared.SystemAttachmentLifetime, 'keepNever'); assert.equal(prepared.UserAttachmentLifetime, 'keepNever');
      assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_TEST_RUN_ID, RUN); assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_CAPTURE_SAFE_SCREENS, '0');
      if (overrides.secret) {
        assert.ok(prepared.EnvironmentVariables.CYCLEPAIR_TEST_INVITATION === CANARY);
        assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_SECRET_INPUT_VALIDATED, '1');
      }
      else assert.ok(!('CYCLEPAIR_TEST_INVITATION' in prepared.EnvironmentVariables));
      if (overrides.inspect) await overrides.inspect({ prepared, plistPath, args });
      await mkdir(bundlePath, { mode: 0o700 }); await writeFile(path.join(bundlePath, 'raw'), `synthetic activity ${CANARY}`, { mode: 0o600 });
      if(overrides.publicCanary){options.onStdout(Buffer.from('typeText cyclepair-canary-'));options.onStdout(Buffer.from('20261023 완료\n'));}
      assert.ok(!args.includes('-retry-tests-on-failure')); assert.ok(!args.includes('-test-iterations'));
      options.onStdout(Buffer.from('한국어 ' + CANARY.slice(0, 17))); options.onStdout(Buffer.from(CANARY.slice(17) + ' 완료\n'));
      options.onStderr(Buffer.from('stderr ' + OTHER.slice(0, 29))); options.onStderr(Buffer.from(OTHER.slice(29) + '\n'));
      if (overrides.execute) return overrides.execute(options);
      return { code: overrides.code ?? 0, signal: null, timedOut: overrides.timedOut ?? false };
    }
    assert.equal(command, '/usr/bin/xcrun');
    const text = overrides.invalid ? '{invalid' : JSON.stringify(summary({ diagnosticCanary: CANARY, ...overrides.summary }));
    options.onStdout(Buffer.from(text.slice(0, 37))); options.onStdout(Buffer.from(text.slice(37)));
    return { code: overrides.summaryCode ?? 0, signal: null };
  };
  return { runCommand, calls, plist: () => plistPath, bundle: () => bundlePath };
}
async function gone(file) { await assert.rejects(stat(file), error => error.code === 'ENOENT'); }
async function safeArtifacts(output) {
  let text = '';
  for (const name of await readdir(output)) { const p = path.join(output, name); assert.ok((await stat(p)).isFile()); assert.equal((await stat(p)).mode & 0o777, 0o600); text += await readFile(p, 'utf8'); }
  assert.ok(!text.includes(CANARY)); assert.ok(!text.includes(OTHER));
}
test('초대 형태가 모든 chunk 경계에서 나뉘어도 가린다', () => {
  for (let n = 0; n <= CANARY.length; n++) { const r = createStreamRedactor([CANARY]); assert.equal(r.push('prefix ' + CANARY.slice(0,n)) + r.push(CANARY.slice(n) + ' suffix') + r.end(), 'prefix [redacted] suffix'); }
});
test('XCTest가 입력을 줄여 남긴 앞부분도 모든 chunk 경계에서 가린다', () => {
  const secret = 'cyclepair-canary-20261023';
  for (const shortened of ['cyclepair-canary-2...', 'cyclepair-canary-2…']) {
    const content = `Type '${shortened}' into field\n`;
    for (let boundary = 0; boundary <= content.length; boundary++) {
      const redactor = createStreamRedactor([secret]);
      assert.equal(redactor.push(content.slice(0, boundary)) + redactor.push(content.slice(boundary)) + redactor.end(),
        "Type '[redacted]' into field\n");
    }
  }
});
test('UTF-8 byte 경계, 짧은 exact secret과 길이 제한 없는 token을 가린다', () => {
  const content = Buffer.from('시작 short private value ' + OTHER + ' 끝');
  for (let step = 1; step <= 23; step++) { const r = createStreamRedactor(['short private value']); let result = ''; for (let n = 0; n < content.length; n += step) result += r.push(content.subarray(n,n+step)); result += r.end(); assert.equal(result, '시작 [redacted] [redacted] 끝'); }
});
test('42자리와 불완전한 마지막 짧은 값은 보존하고 43자리부터 가린다', () => {
  const a = createStreamRedactor(); assert.equal(a.push('x'.repeat(42)) + a.end(), 'x'.repeat(42));
  const b = createStreamRedactor(); assert.equal(b.push('x'.repeat(43)) + b.end(), '[redacted]');
});

test('짧은 공개 가짜 비밀번호의 이스케이프와 이메일을 가린다', () => {
  const password = 'Public"Fake\\Pass!7', email = 'public-fake-account@example.invalid';
  for (const form of [password, JSON.stringify(password).slice(1, -1), encodeURIComponent(password), email]) {
    for (const shown of [form, form.slice(0, 8) + '...', form.slice(0, 8) + '…']) {
      const bytes = Buffer.from(`오류 "${shown}" 끝`);
      for (let n = 0; n <= bytes.length; n++) {
        const redactor = createStreamRedactor([password, email]);
        assert.equal(redactor.push(bytes.subarray(0, n)) + redactor.push(bytes.subarray(n)) + redactor.end(),
          '오류 "[redacted]" 끝');
      }
    }
  }
});

test('typed 계정 입력은 CLI 대신 private plist로만 전달하고 정리한다', async () => {
  const f = await fixture();
  const input = { kind: 'account', email: 'public-fake-account@example.invalid', password: 'Public"Fake\\Pass!7' };
  const x = fake({ inspect: async ({ prepared, args }) => {
    assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_TEST_ACCOUNT_EMAIL, input.email);
    assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_TEST_ACCOUNT_PASSWORD, input.password);
    assert.ok(!JSON.stringify(args).includes(input.email));
    assert.ok(!JSON.stringify(args).includes(input.password));
    assert.ok(!JSON.stringify(x.calls).includes(input.email));
    assert.ok(!JSON.stringify(x.calls).includes(input.password));
  } });
  const flowDefinitions = { 'account-transport-unit': { method: 'testAccountTransportUnit', inputKind: 'account', secret: true, ready: true } };
  const result = await runPhysicalIosFlow({ ...f.options, flow: 'account-transport-unit', privateInput: input,
    allowSecretExecution: true, secretTransportValidated: true }, { ...x, flowDefinitions });
  assert.equal(result.passed, true);
  assert.equal(result.privateRawRemoved, true);
  await gone(x.plist()); await gone(x.bundle());
});

test('계정 공개 canary는 제한된 범위와 제출없는 메서드에만 결속한다', async () => {
  const f = await fixture(), x = fake({ inspect: async ({ prepared, args }) => {
    assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_TEST_ACCOUNT_EMAIL, PUBLIC_ACCOUNT_CANARY.email);
    assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_TEST_ACCOUNT_PASSWORD, PUBLIC_ACCOUNT_CANARY.password);
    assert.ok(!('CYCLEPAIR_SECRET_INPUT_VALIDATED' in prepared.EnvironmentVariables));
    assert.ok(args.includes('-only-testing:CyclePairPhysicalUITests/CyclePairCoordinatedUITests/testAccountInputCanary'));
  }, summary: { testFailures: [], publicEmail: PUBLIC_ACCOUNT_CANARY.email, publicPassword: PUBLIC_ACCOUNT_CANARY.password } });
  const result = await runPhysicalIosFlow({ ...f.options, flow: 'account-input-canary' }, x);
  assert.equal(result.passed, true);
  assert.deepEqual(result.canaryScope, IOS_ACCOUNT_CANARY_SCOPE);
  assert.equal(result.canaryScope.secureFieldEvidence, 'masked-nonempty-only');
  assert.equal(result.canaryScope.passwordExactInputValidated, false);
  assert.equal(result.canaryScope.authenticationSucceeded, false);
  assert.equal(result.canaryScope.submitted, false);
  await gone(x.plist()); await gone(x.bundle());
  const artifacts = await Promise.all((await readdir(f.options.output)).map(file => readFile(path.join(f.options.output, file), 'utf8')));
  for (const value of Object.values(PUBLIC_ACCOUNT_CANARY)) assert.ok(!artifacts.join('').includes(value));
});

test('canary의 실제 입력 제공, 이전 plist 계정값과 공개값 예외를 안전하게 처리한다', async () => {
  const input = { kind: 'account', ...PUBLIC_ACCOUNT_CANARY };
  const first = await fixture(), noSpawn = fake();
  await assert.rejects(runPhysicalIosFlow({ ...first.options, flow: 'account-input-canary', privateInput: input }, noSpawn));
  assert.equal(noSpawn.calls.length, 0);
  for (const key of ['CYCLEPAIR_TEST_ACCOUNT_EMAIL', 'CYCLEPAIR_TEST_ACCOUNT_PASSWORD']) {
    const f = await fixture(), x = fake();
    py("import plistlib,sys; p=sys.argv[1]; d=plistlib.load(open(p,'rb')); d['CyclePairPhysicalUITests']['EnvironmentVariables'][sys.argv[2]]='public-fake-stale'; open(p,'wb').write(plistlib.dumps(d))", [f.base, key]);
    const result = await runPhysicalIosFlow({ ...f.options, flow: 'account-input-canary' }, x);
    assert.equal(result.passed, false); assert.equal(x.calls.length, 0); assert.equal(result.privateRawRemoved, true);
  }
  const f = await fixture(), x = fake({ execute: async () => { throw new Error(
    `public fake failure ${PUBLIC_ACCOUNT_CANARY.email} ${JSON.stringify(PUBLIC_ACCOUNT_CANARY.password)} ${encodeURIComponent(PUBLIC_ACCOUNT_CANARY.password)}`); } });
  const result = await runPhysicalIosFlow({ ...f.options, flow: 'account-input-canary' }, x);
  assert.equal(result.passed, false);
  assert.equal(result.error, 'public fake failure [redacted] "[redacted]" [redacted]');
  assert.equal(result.privateRawRemoved, true);
  await gone(x.plist()); await gone(x.bundle());
});

test('계정 canary 근거는 목적과 소유 계정에 결속하고 인증 성공을 요구하지 않는다', async () => {
  const f = await fixture();
  const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  const receipt = path.join(f.dir, 'account-canary.json');
  const record = { executionMode: 'physical', flow: 'account-input-canary', passed: true,
    testIdentifier: 'CyclePairCoordinatedUITests/testAccountInputCanary', diagnosticOnly: false,
    sourceSha: SHA, requestedCandidateSha: SHA, ownershipManifestSHA256: await hash(f.ownership),
    accountOwnershipSHA256: await hash(f.manifest.accountOwnershipPath), canaryScope: IOS_ACCOUNT_CANARY_SCOPE,
    plistPreparation: baseFingerprint(f.base),
    summaryDeviceMatches: true, ownedXcodebuildGroupCleaned: true, privateRawRemoved: true,
    counts: { totalTestCount: 1, passedTests: 1, failedTests: 0, skippedTests: 0, expectedFailures: 0 } };
  const options = { purpose: 'account', receipt, baseXctestrun: f.base, ownership: f.ownership, candidateSha: SHA, privateRoot: f.dir };
  for (const patch of [{ canaryScope: ACCOUNT_CANARY_SCOPE }, { flow: 'invitation-canary' }, { accountOwnershipSHA256: '0'.repeat(64) },
    ...['submitted', 'authenticationSucceeded', 'passwordExactInputValidated'].map(key => ({ canaryScope: { ...IOS_ACCOUNT_CANARY_SCOPE, [key]: true } }))]) {
    await writeFile(receipt, JSON.stringify({ ...record, ...patch }), { mode: 0o600 });
    await assert.rejects(validateCanaryReceipt(options));
  }
  await writeFile(receipt, JSON.stringify(record), { mode: 0o600 });
  assert.equal(await validateCanaryReceipt(options), true);
  await assert.rejects(validateCanaryReceipt({ ...options, purpose: 'invitation' }));
  const outerInfo = path.join(f.dir, 'Debug-iphoneos/Runner.app/Info.plist');
  await writeFile(outerInfo, 'public outer runner plist change');
  await assert.rejects(validateCanaryReceipt(options), 'outer runner 변경 뒤 이전 canary는 거절해야 함');
  await rm(outerInfo);
  await writeFile(f.manifest.accountOwnershipPath, '{"syntheticOnly":true,"newGuest":true}');
  await assert.rejects(validateCanaryReceipt(options));
});

test('계정용 비공개 UI flow는 같은 후보의 공개 입력 근거가 없으면 실행 전에 거절한다', async () => {
  const f = await fixture();
  // 실제 명령은 시작하지 않는다. 빈 receipt가 경로 검사에서 먼저 거절된다.
  await assert.rejects(runPhysicalIosFlow({ ...f.options, flow: 'account-transport-unit',
    privateInput: { kind: 'account', ...PUBLIC_ACCOUNT_CANARY }, allowSecretExecution: true,
    secretTransportValidated: true, executePhysical: true }, {
    flowDefinitions: { 'account-transport-unit': { method: 'testAccountTransportUnit', inputKind: 'account', secret: true, ready: true } },
  }), /비공개 작업 공간 절대 경로 필요/);
  await gone(f.options.output);
});

test('잘못된 UTF-16 계정값은 임시 자료와 listener를 만들기 전에 거절한다', async () => {
  for (const key of ['email', 'password']) {
    const f = await fixture(), x = fake(), signals = new EventEmitter();
    const input = { kind: 'account', ...PUBLIC_ACCOUNT_CANARY, [key]: 'pa\uD800ss' };
    await assert.rejects(runPhysicalIosFlow({ ...f.options, flow: 'account-transport-unit', privateInput: input,
      allowSecretExecution: true, secretTransportValidated: true }, { ...x, signalSource: signals,
      flowDefinitions: { 'account-transport-unit': { method: 'testAccountTransportUnit', inputKind: 'account', secret: true, ready: true } } }));
    assert.equal(x.calls.length, 0);
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
    await gone(f.options.output);
  }
});
test('승인된 manifest의 물리 iPhone과 외부 근거 디렉터리를 사용한다', async () => {
  const f = await fixture(), x = fake();
  const result = await runPhysicalIosFlow(f.options, x);
  assert.equal(result.passed, true);
  assert.equal(x.calls.length, 2);
  await safeArtifacts(f.options.output);
});
test('명령 진입점은 iPhone을 Maestro로 대체하지 않고 signed XCTest 인수를 요구한다', async () => {
  const f = await fixture();
  await assert.rejects(exec(process.execPath, ['scripts/run-native-e2e.mjs', '--backend', 'emulator',
    '--scope', 'solo', '--authoring', '--flow', 'cold-home', '--ownership', f.ownership,
    '--output', f.options.output]), error => error.stderr.includes('requires --ios-xctestrun'));
});
test('혼합 연결의 사용자 순서가 다르면 기기 명령 전에 중단한다', async () => {
  const f = await fixture();
  f.manifest.runtimes.push({...f.manifest.runtimes[0], platform: 'android', deviceId: 'synthetic-android', appId: 'com.seorilabs.cyclepair.qa'});
  f.manifest.adb = path.join(f.dir, 'no-device-tool');
  await writeFile(f.ownership, JSON.stringify(f.manifest));
  await assert.rejects(exec(process.execPath, ['scripts/run-native-e2e.mjs', '--backend', 'emulator',
    '--scope', 'pair', '--authoring', '--flow', 'pair', '--ownership', f.ownership,
    '--output', f.options.output, '--ios-xctestrun', f.base, '--maestro', 'no-maestro']),
    error => error.stderr.includes('Android actor 0 to iPhone actor 1'));
});
test('고정 기기, Simulator 거절, default destination 거절과 후보 일치를 확인한다', async () => {
  const f = await fixture(), x = fake();
  for (const patch of [{ deviceId: undefined }, { deviceId: 'FEFA834A-E534-4A27-A7BB-356087B8633B' }, { deviceId: '11111111-1111111111111111' }, { destination: 'generic/platform=iOS' }, { candidateSha: undefined }, { candidateSha: '2'.repeat(40) }]) await assert.rejects(runPhysicalIosFlow({ ...f.options, ...patch }, x));
  assert.equal(x.calls.length, 0);
});
test('명시한 service backend와 소유 합성 설치가 일치할 때만 서비스 흐름을 실행한다', async () => {
  const f = await fixture(), x = fake();
  f.manifest.backend = 'service';
  await writeFile(f.ownership, JSON.stringify(f.manifest));
  const result = await runPhysicalIosFlow({ ...f.options, backend: 'service' }, x);
  assert.equal(result.passed, true);
  await safeArtifacts(f.options.output);
});
test('소유 합성자료, reset 금지, authorized physical과 로컬 backend를 확인한다', async () => {
  for (const mutate of [m=>m.backend='service',m=>m.runtimes[0].kind='simulator',m=>m.runtimes[0].authorized=false,m=>m.runtimes[0].appData='user',m=>m.runtimes[0].allowAppDataReset=true]) {
    const f=await fixture(),x=fake(); mutate(f.manifest); await writeFile(f.ownership,JSON.stringify(f.manifest)); await assert.rejects(runPhysicalIosFlow(f.options,x)); assert.equal(x.calls.length,0);
  }
});
test('실제 초대는 helper 준비와 공개 canary 검증 전 차단한다', async () => {
  const f=await fixture(),x=fake(),options={...f.options,flow:'invitation-accept',privateInput:{kind:'invitation',code:CANARY}};
  await assert.rejects(runPhysicalIosFlow(options,x)); await assert.rejects(runPhysicalIosFlow(options,{...x,flowDefinitions:fakeFlows})); assert.equal(x.calls.length,0);
});
test('공개 입력 근거의 후보, 설치와 signed helper가 같아야 초대 입력을 허용한다', async () => {
  const f = await fixture();
  const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  const original = { executionMode: 'physical', flow: 'invitation-canary', passed: true,
    testIdentifier: 'CyclePairCoordinatedUITests/testInvitationInputCanary', diagnosticOnly: false,
    sourceSha: SHA, requestedCandidateSha: SHA, ownershipManifestSHA256: await hash(f.ownership),
    plistPreparation: baseFingerprint(f.base), summaryDeviceMatches: true,
    ownedXcodebuildGroupCleaned: true, privateRawRemoved: true,
    counts: { totalTestCount: 1, passedTests: 1, failedTests: 0, skippedTests: 0, expectedFailures: 0 } };
  const receipt = path.join(f.dir, 'canary.json');
  const options = { purpose: 'invitation', receipt, baseXctestrun: f.base, ownership: f.ownership, candidateSha: SHA, privateRoot: f.dir };
  for (const patch of [{testIdentifier: 'CyclePairCoordinatedUITests/testPublicInputMethodComparison'},
    {testIdentifier: undefined}, {diagnosticOnly: true}, {diagnosticOnly: undefined},
    {executionMode: 'injected-fake'}, {passed: false}, {sourceSha: '2'.repeat(40)},
    {ownershipManifestSHA256: '3'.repeat(64)}, {plistPreparation: {sourceSHA256: '4'.repeat(64)}},
    {privateRawRemoved: false}, {ownedXcodebuildGroupCleaned: false}, {counts: {...original.counts, skippedTests: 1}}]) {
    await writeFile(receipt, JSON.stringify({...original, ...patch}), {mode: 0o600});
    await assert.rejects(validateCanaryReceipt(options));
  }
  await writeFile(receipt, JSON.stringify(original), {mode: 0o600});
  assert.equal(await validateCanaryReceipt(options), true);
  // The plist stays byte-identical while a reused build cache replaces the helper.
  await writeFile(f.helper, 'different synthetic UI helper binary');
  await assert.rejects(validateCanaryReceipt(options));
});
for (const binary of [false,true]) test(`${binary?'binary':'XML'} 형식과 원본, TESTROOT 해석을 보존한다`, async()=>{
  const f=await fixture(binary),original=await readFile(f.base);
  const x=fake({inspect:async({prepared,plistPath})=>{
    assert.equal(prepared.TestHostPath,path.join(f.dir,'Debug-iphoneos/Runner.app')); assert.equal(prepared.TestBundlePath,'__TESTHOST__/PlugIns/Test.xctest'); assert.equal(prepared.EnvironmentVariables.NORMAL,'preserve');
    assert.equal((await readFile(plistPath)).subarray(0,8).toString()==='bplist00',binary);
    assert.equal(py("import plistlib,sys,datetime;d=plistlib.load(open(sys.argv[1],'rb'))['CyclePairPhysicalUITests'];assert d['UnknownData']==b'abc';assert d['UnknownDate']==datetime.datetime(2026,10,23);print('ok')",[plistPath]).trim(),'ok');
  }});
  const result=await runPhysicalIosFlow(f.options,x); assert.equal(result.passed,true); assert.equal(result.executionMode,'injected-fake'); assert.deepEqual(await readFile(f.base),original); assert.equal(result.formalUIRounds,0); assert.equal(result.fullL3,false); await gone(x.plist()); await gone(x.bundle()); await safeArtifacts(f.options.output);
});
test('가짜 비밀은 private plist로만 전달하고 원시 xcresult를 제거한다',async()=>{
 const f=await fixture(),x=fake({secret:true}); const r=await runPhysicalIosFlow({...f.options,flow:'invitation-accept',privateInput:{kind:'invitation',code:CANARY},allowSecretExecution:true,secretTransportValidated:true},{...x,flowDefinitions:fakeFlows}); assert.equal(r.passed,true);assert.equal(r.privateRawRemoved,true);assert.equal(r.rawBundleHash.files,1);await safeArtifacts(f.options.output);
});
for(const [name,override] of [['0개실행',{summary:{totalTestCount:0,passedTests:0}}],['두개실행',{summary:{totalTestCount:2,passedTests:2}}],['skip',{summary:{skippedTests:1}}],['fail',{summary:{failedTests:1}}],['expectedFailure',{summary:{expectedFailures:1}}],['다른기기',{summary:{devicesAndConfigurations:[{device:{deviceId:'other',platform:'iOS'}}]}}],['Simulator',{summary:{devicesAndConfigurations:[{device:{deviceId:APPROVED_DEVICE_ID,platform:'iOS Simulator'}}]}}],['오류종료',{code:65}],['timeout',{timedOut:true}],['잘못된요약',{invalid:true}],['요약오류',{summaryCode:1}]]) test(`${name}는 실패이며 원시파일을 정리한다`,async()=>{
 const f=await fixture(),x=fake(override),r=await runPhysicalIosFlow(f.options,x);assert.equal(r.passed,false);assert.equal(r.privateRawRemoved,true);await gone(x.plist());await gone(x.bundle());await safeArtifacts(f.options.output);
});
test('예외 메시지의 가짜 비밀도 가리고 실패 hash와 정리 결과를 남긴다',async()=>{
 const f=await fixture(),x=fake({secret:true,execute:async()=>{throw new Error('synthetic failure '+CANARY);}});const r=await runPhysicalIosFlow({...f.options,flow:'invitation-accept',privateInput:{kind:'invitation',code:CANARY},allowSecretExecution:true,secretTransportValidated:true},{...x,flowDefinitions:fakeFlows});assert.equal(r.passed,false);assert.equal(r.error,'synthetic failure [redacted]');assert.equal(r.privateRawRemoved,true);await safeArtifacts(f.options.output);
});
test('SIGINT는 해당 실행 AbortSignal만 중단하고 원시파일과 listener를 정리한다',async()=>{
 const f=await fixture(),signals=new EventEmitter();let observed=false;const x=fake({execute:async options=>{options.signal.addEventListener('abort',()=>{observed=true;});signals.emit('SIGINT');return{code:130,signal:'SIGINT'};}});const r=await runPhysicalIosFlow(f.options,{...x,signalSource:signals});assert.equal(observed,true);assert.equal(r.status,'cancelled');assert.equal(r.privateRawRemoved,true);assert.equal(x.calls.length,1);assert.equal(signals.listenerCount('SIGINT'),0);await safeArtifacts(f.options.output);
});
test('산출물 저장 실패에도 private plist와 xcresult는 삭제한다',async()=>{
 const f=await fixture(),x=fake({inspect:async()=>mkdir(path.join(f.options.output,'summary.redacted.json'))});const r=await runPhysicalIosFlow(f.options,x);assert.equal(r.passed,false);assert.equal(r.artifactWriteFailed,true);assert.equal(r.privateRawRemoved,true);await gone(x.plist());await gone(x.bundle());
});
test('중단은 spawn 성공한 전용 PGID에만 보내며 다른 그룹을 건드리지 않는다',async()=>{
 const controller=new AbortController(),calls=[];let alive=true;
 const spawnImpl=(command,args,options)=>{assert.equal(command,'fake-owned');assert.equal(options.shell,false);assert.equal(options.detached,true);const child=new EventEmitter();child.pid=991231;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();queueMicrotask(()=>child.emit('spawn'));return child;};
 let close;const wrap=(...args)=>{const child=spawnImpl(...args);close=()=>child.emit('close',130,'SIGINT');return child;};
 const killImpl=(pid,signal)=>{calls.push([pid,signal]);assert.equal(pid,-991231);if(!alive){const e=new Error('gone');e.code='ESRCH';throw e;}if(signal==='SIGINT'){alive=false;queueMicrotask(close);}return true;};
 const pending=runOwnedCommand('fake-owned',[],{spawnImpl:wrap,killImpl,signal:controller.signal,pauseImpl:async()=>{}});controller.abort();const result=await pending;assert.equal(result.ownedGroupCleaned,true);assert.ok(calls.some(([,signal])=>signal==='SIGINT'));assert.ok(calls.every(([pid])=>pid===-991231));
});
test('leader 종료 뒤 잔류한 소유 그룹만 SIGKILL하고 정리 완료를 기다린다',async()=>{
 let alive=true;const calls=[];const spawnImpl=()=>{const child=new EventEmitter();child.pid=991232;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();queueMicrotask(()=>{child.emit('spawn');child.emit('close',0,null);});return child;};
 const killImpl=(pid,signal)=>{calls.push([pid,signal]);assert.equal(pid,-991232);if(!alive){const e=new Error('gone');e.code='ESRCH';throw e;}if(signal==='SIGKILL')alive=false;return true;};
 const result=await runOwnedCommand('fake-owned',[],{spawnImpl,killImpl,pauseImpl:async()=>{}});assert.equal(result.ownedGroupCleaned,true);assert.ok(calls.some(([,signal])=>signal==='SIGKILL'));assert.ok(calls.every(([pid])=>pid===-991232));
});
test('spawn 실패 전후 확인되지 않은 PID에는 신호를 보내지 않는다',async()=>{
 const calls=[];const spawnImpl=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();queueMicrotask(()=>{const e=new Error('spawn failed');e.code='ENOENT';child.emit('error',e);});return child;};
 await assert.rejects(runOwnedCommand('fake-missing',[],{spawnImpl,killImpl:(...args)=>calls.push(args)}));assert.deepEqual(calls,[]);
});
test.after(async()=>rm(root,{recursive:true,force:true}));

test('공개 canary도 같은 exact 값 가림 경로를 쓰고 지정한 coordinated 메서드 하나를 선택한다',async()=>{
 const f=await fixture(),x=fake({publicCanary:true,inspect:async({prepared,args})=>{assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_TEST_FLOW,'invitation-canary');assert.deepEqual(prepared.OnlyTestIdentifiers,['CyclePairCoordinatedUITests/testInvitationInputCanary']);assert.ok(args.includes('-only-testing:CyclePairPhysicalUITests/CyclePairCoordinatedUITests/testInvitationInputCanary'));}});const r=await runPhysicalIosFlow({...f.options,flow:'invitation-canary'},x);assert.equal(r.passed,true);assert.ok(!(await readFile(path.join(f.options.output,'xcodebuild.redacted.log'),'utf8')).includes('cyclepair-canary-20261023'));await safeArtifacts(f.options.output);
});

for (const [flow, method] of [
  ['diagnostics-consent', 'testDiagnosticsConsentSurvivesColdRestart'],
  ['privacy-read', 'testPrivacyNoticeCanBeReadAndClosed'],
]) test(`${flow}는 홈 시험으로 대체하지 않고 해당 화면 메서드만 실행한다`, async () => {
  const f = await fixture(), x = fake({ inspect: async ({ prepared, args }) => {
    assert.deepEqual(prepared.OnlyTestIdentifiers, [`CyclePairPhysicalUITests/${method}`]);
    assert.ok(args.includes(`-only-testing:CyclePairPhysicalUITests/CyclePairPhysicalUITests/${method}`));
  } });
  const result = await runPhysicalIosFlow({ ...f.options, flow }, x);
  assert.equal(result.passed, true);
  assert.equal(result.testIdentifier, `CyclePairPhysicalUITests/${method}`);
  assert.equal(result.diagnosticOnly, false);
  assert.equal(result.privateRawRemoved, true);
  await safeArtifacts(f.options.output);
});

 test('진단 selector로 바꾼 흐름은 엄격 입력 성공 근거가 될 수 없다', async () => {
  const f = await fixture(), x = fake();
  const result = await runPhysicalIosFlow({ ...f.options, flow: 'invitation-canary' }, {
    ...x, flowDefinitions: { ...DEFAULT_FLOWS, 'invitation-canary': {
      ...DEFAULT_FLOWS['invitation-canary'], method: 'testPublicInputMethodComparison' } }
  });
  assert.equal(result.passed, true, '진단 자체의 완료 결과는 보존한다');
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.testIdentifier, 'CyclePairCoordinatedUITests/testPublicInputMethodComparison');
 });

for (const [flow, method] of [
  ['account-upgrade', 'testAccountUpgrade'],
  ['account-logout', 'testAccountLogout'],
  ['account-login', 'testAccountLogin'],
  ['account-reauthenticate', 'testAccountReauthenticate'],
]) test(`${flow}는 계정 입력을 보호하고 단일 정상 UI 메서드만 실행한다`, async () => {
  const f = await fixture();
  const input = { kind: 'account', email: 'public-auth-flow@example.invalid', password: 'Public-Auth-Flow!7' };
  const x = fake({ inspect: async ({ prepared, args }) => {
    assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_TEST_ACCOUNT_EMAIL, input.email);
    assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_TEST_ACCOUNT_PASSWORD, input.password);
    assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_SECRET_INPUT_VALIDATED, '1');
    assert.ok(args.includes(`-only-testing:CyclePairPhysicalUITests/CyclePairCoordinatedUITests/${method}`));
    assert.ok(!JSON.stringify(x.calls).includes(input.email));
    assert.ok(!JSON.stringify(x.calls).includes(input.password));
  }, execute: async options => {
    options.onStdout(Buffer.from(`type ${input.email} ${input.password}`));
    return { code: 0, signal: null };
  } });
  const result = await runPhysicalIosFlow({ ...f.options, flow, privateInput: input,
    allowSecretExecution: true, secretTransportValidated: true }, x);
  assert.equal(result.passed, true);
  assert.equal(result.testIdentifier, `CyclePairCoordinatedUITests/${method}`);
  assert.equal(result.privateRawRemoved, true);
  await gone(x.plist()); await gone(x.bundle());
  for (const file of await readdir(f.options.output)) {
    const value = await readFile(path.join(f.options.output, file), 'utf8');
    assert.ok(!value.includes(input.email)); assert.ok(!value.includes(input.password));
  }
});


const lifecycleMethods = {
  'email-verification-request': 'testEmailVerificationRequested',
  'email-verification-refresh': 'testEmailVerificationRefreshed',
  'password-reset-request': 'testPasswordResetRequested',
  'password-reset-old-rejected': 'testPasswordResetOldPasswordRejected',
  'password-reset-login': 'testPasswordResetLogin',
};
test('계정 수명주기는 고정한 앱 UI 메서드와 기존 account receipt만 사용한다', () => {
  for (const [name, method] of Object.entries(lifecycleMethods)) {
    const flow = DEFAULT_FLOWS[name];
    assert.equal(flow?.method, method);
    assert.equal(flow.className, 'CyclePairCoordinatedUITests');
    assert.equal(flow.ready, true);
    if (name.startsWith('email-')) {
      assert.equal(flow.requiresAccountCanary, true);
      assert.equal(flow.secret, false);
      assert.deepEqual(resolvePrivateInput(flow, undefined).values, {});
    } else assert.equal(flow.inputKind, 'account');
  }
});
test('reset 요청은 기존 strict 계정 객체를 검증하되 helper에 비밀번호를 전달하지 않는다', () => {
  const input = { kind: 'account', email: 'lifecycle-public@example.invalid', password: 'Public-Lifecycle!7' };
  const resolved = resolvePrivateInput({ inputKind: 'account' }, input);
  assert.deepEqual(privateInputEnvironment(resolved, 'ios', 'password-reset-request'), {
    CYCLEPAIR_TEST_ACCOUNT_EMAIL: input.email,
  });
  for (const flow of ['password-reset-old-rejected', 'password-reset-login'])
    assert.deepEqual(privateInputEnvironment(resolved, 'ios', flow), {
      CYCLEPAIR_TEST_ACCOUNT_EMAIL: input.email, CYCLEPAIR_TEST_ACCOUNT_PASSWORD: input.password,
    });
  for (const invalid of [{ kind: 'account', email: input.email }, { ...input, purpose: 'reset' }])
    assert.throws(() => resolvePrivateInput({ inputKind: 'account' }, invalid));
});
for (const [flow, method] of Object.entries(lifecycleMethods)) test(`${flow}는 필요한 env만 private plist에 넣고 입력 원문을 지운다`, async () => {
  const f = await fixture();
  const email = 'lifecycle-public@example.invalid', password = 'Public-Lifecycle!7';
  const verification = flow.startsWith('email-');
  const input = verification ? undefined : { kind: 'account', email, password };
  const x = fake({ inspect: async ({ prepared, args }) => {
    const env = prepared.EnvironmentVariables;
    assert.equal(env.CYCLEPAIR_SECRET_INPUT_VALIDATED, '1');
    assert.equal(env.CYCLEPAIR_TEST_ACCOUNT_EMAIL, verification ? undefined : email);
    assert.equal(env.CYCLEPAIR_TEST_ACCOUNT_PASSWORD,
      verification || flow === 'password-reset-request' ? undefined : password);
    assert.ok(args.includes(`-only-testing:CyclePairPhysicalUITests/CyclePairCoordinatedUITests/${method}`));
    assert.ok(!JSON.stringify(x.calls).includes(email));
    assert.ok(!JSON.stringify(x.calls).includes(password));
    assert.ok(!JSON.stringify(env).includes('host-only-public-redaction'));
  }, execute: async options => {
    options.onStdout(Buffer.from(`host-only-public-redaction ${email} ${password} lifecycle-pub...`));
    return { code: 0, signal: null };
  } });
  const result = await runPhysicalIosFlow({ ...f.options, flow, privateInput: input,
    allowSecretExecution: true, secretTransportValidated: true,
    redactionValues: [email, password, 'host-only-public-redaction'] }, x);
  assert.equal(result.passed, true);
  assert.equal(result.privateRawRemoved, true);
  assert.equal(result.diagnosticOnly, false);
  await gone(x.plist()); await gone(x.bundle());
  for (const file of await readdir(f.options.output)) {
    const text = await readFile(path.join(f.options.output, file), 'utf8');
    for (const secret of [email, password, 'host-only-public-redaction', 'lifecycle-pub...']) assert.ok(!text.includes(secret));
  }
});
test('입력이 없는 이메일 흐름도 account canary 없이 실제 Xcode를 시작하지 않는다', async () => {
  for (const flow of ['email-verification-request', 'email-verification-refresh']) {
    const f = await fixture();
    await assert.rejects(runPhysicalIosFlow({ ...f.options, flow, executePhysical: true,
      redactionValues: ['lifecycle-public@example.invalid'] }), /비공개 작업 공간 절대 경로 필요/);
    await gone(f.options.output);
  }
});
test('host-only 가림값은 올바른 문자열 배열이어야 하며 UI 입력으로 바뀌지 않는다', async () => {
  for (const redactionValues of [null, 'public', [null], [''], ['\ud800']]) {
    const f = await fixture(), x = fake();
    await assert.rejects(runPhysicalIosFlow({ ...f.options, redactionValues }, x));
    assert.equal(x.calls.length, 0);
    await gone(f.options.output);
  }
});


const publicAction = 'http://192.168.1.24:9399/emulator/action?mode=verifyEmail&oobCode=public_oob_20261023&apiKey=public-api-key&lang=ko';
test('인증 URL은 고정 action-link 필드와 해당 flow mode만 허용한다', () => {
  const flow = { inputKind: 'action-link', actionMode: 'verifyEmail' };
  const input = resolvePrivateInput(flow, { kind: 'action-link', url: publicAction });
  assert.deepEqual(privateInputEnvironment(input, 'ios'), { CYCLEPAIR_TEST_ACTION_URL: publicAction });
  assert.ok(input.secrets.includes(publicAction));
  assert.ok(input.secrets.includes('public_oob_20261023'));
  for (const url of [publicAction.replace('verifyEmail', 'resetPassword'),
    publicAction + '&continueUrl=https://other.invalid', publicAction + '&mode=verifyEmail',
    publicAction + '#private', publicAction.replace('192.168.1.24', 'user:pass@192.168.1.24'),
    publicAction.replace('public_oob_20261023', 'bad%20code'), publicAction.replace('lang=ko', 'lang=fr')])
    assert.throws(() => resolvePrivateInput(flow, { kind: 'action-link', url }));
  assert.throws(() => resolvePrivateInput(flow, { kind: 'action-link', url: publicAction, mode: 'verifyEmail' }));
});
test('action URL과 코드의 URL 인코딩 및 줄임 prefix도 모든 chunk에서 가린다', () => {
  const input = resolvePrivateInput({ inputKind: 'action-link', actionMode: 'verifyEmail' }, { kind: 'action-link', url: publicAction });
  for (const value of [publicAction, encodeURIComponent(publicAction), 'public_oob_20261023']) {
    for (const shown of [value, value.slice(0, 12) + '...', value.slice(0, 12) + '…']) {
      for (let boundary = 0; boundary <= shown.length; boundary++) {
        const r = createStreamRedactor(input.secrets);
        assert.equal(r.push(shown.slice(0, boundary)) + r.push(shown.slice(boundary)) + r.end(), '[redacted]');
      }
    }
  }
});
test('미관찰 Safari 흐름은 실행 준비 완료가 아니며 삭제에는 별도 실행 승인이 필요하다', async () => {
  assert.equal(DEFAULT_FLOWS['email-verification-browser']?.ready, false);
  assert.equal(DEFAULT_FLOWS['account-delete']?.destructive, true);
  const f = await fixture(), x = fake();
  await assert.rejects(runPhysicalIosFlow({ ...f.options, flow: 'account-delete',
    privateInput: { kind: 'account', ...PUBLIC_ACCOUNT_CANARY }, allowSecretExecution: true,
    secretTransportValidated: true }, x));
  assert.equal(x.calls.length, 0);
});
for (const [backend, origin, projectId, validUrl] of [
  ['emulator', 'http://192.168.1.24:9399', undefined, publicAction],
  ['service', 'https://cyclepair-public.firebaseapp.com', 'cyclepair-public',
    'https://cyclepair-public.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=public_oob_20261023&apiKey=public-api-key&lang=en'],
]) test(`${backend} action은 receipt에 묶인 manifest origin과 고정 경로로만 전달된다`, async () => {
  const f = await fixture();
  const manifest = { ...f.manifest, backend, authActionOrigin: origin, authActionApiKey: 'public-api-key', firebaseProjectId: projectId };
  await writeFile(f.options.ownership, JSON.stringify(manifest), { mode: 0o600 });
  const x = fake({ inspect: async ({ prepared, args }) => {
    assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_TEST_ACTION_URL, validUrl);
    assert.ok(!('CYCLEPAIR_TEST_ACCOUNT_EMAIL' in prepared.EnvironmentVariables));
    assert.ok(!('CYCLEPAIR_TEST_ACCOUNT_PASSWORD' in prepared.EnvironmentVariables));
    assert.ok(!JSON.stringify(x.calls).includes(validUrl));
    assert.ok(args.includes('-only-testing:CyclePairPhysicalUITests/CyclePairCoordinatedUITests/testEmailVerificationBrowserAction'));
  } });
  const flowDefinitions = { ...DEFAULT_FLOWS, 'email-verification-browser': {
    ...DEFAULT_FLOWS['email-verification-browser'], ready: true } };
  const result = await runPhysicalIosFlow({ ...f.options, backend, flow: 'email-verification-browser',
    privateInput: { kind: 'action-link', url: validUrl }, allowSecretExecution: true,
    secretTransportValidated: true, redactionValues: ['public-owner@example.invalid'] }, { ...x, flowDefinitions });
  assert.equal(result.passed, true);
  assert.equal(result.diagnosticOnly, true);
  await gone(x.plist()); await gone(x.bundle());
  for (const badUrl of [validUrl.replace(new URL(validUrl).hostname, 'other.invalid'),
    validUrl.replace(new URL(validUrl).pathname, '/other/action'), validUrl.replace('public-api-key', 'other-api-key')]) {
    const b = await fixture();
    await writeFile(b.options.ownership, JSON.stringify({ ...b.manifest, backend, authActionOrigin: origin, authActionApiKey: 'public-api-key', firebaseProjectId: projectId }));
    const noSpawn = fake();
    await assert.rejects(runPhysicalIosFlow({ ...b.options, backend, flow: 'email-verification-browser',
      privateInput: { kind: 'action-link', url: badUrl }, allowSecretExecution: true,
      secretTransportValidated: true, redactionValues: ['public-owner@example.invalid'] }, { ...noSpawn, flowDefinitions }));
    assert.equal(noSpawn.calls.length, 0);
  }
});

test('삭제 승인과 새 action 입력은 실행별로만 전달하고 stale base URL은 거절한다', async () => {
  const f = await fixture(), x = fake({ inspect: async ({ prepared }) => {
    assert.equal(prepared.EnvironmentVariables.CYCLEPAIR_ACCOUNT_DELETION_APPROVED, '1');
    assert.ok(!('CYCLEPAIR_TEST_ACTION_URL' in prepared.EnvironmentVariables));
  } });
  const result = await runPhysicalIosFlow({ ...f.options, flow: 'account-delete',
    privateInput: { kind: 'account', ...PUBLIC_ACCOUNT_CANARY }, allowAccountDeletion: true,
    allowSecretExecution: true, secretTransportValidated: true }, x);
  assert.equal(result.passed, true); assert.equal(result.privateRawRemoved, true);
  const b = await fixture(), noSpawn = fake();
  py("import plistlib,sys;p=sys.argv[1];d=plistlib.load(open(p,'rb'));d['CyclePairPhysicalUITests']['EnvironmentVariables']['CYCLEPAIR_TEST_ACTION_URL']='public-stale-action';open(p,'wb').write(plistlib.dumps(d))", [b.base]);
  const rejected = await runPhysicalIosFlow(b.options, noSpawn);
  assert.equal(rejected.passed, false); assert.equal(noSpawn.calls.length, 0); assert.equal(rejected.privateRawRemoved, true);
});
