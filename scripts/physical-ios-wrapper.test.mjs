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
const APPROVED_DEVICE_ID = '00000000-0000000000000000';
// 아래 값은 공개된 고정 가짜 값이며 실제 초대를 생성하지 않는다.
const CANARY = 'C'.repeat(43), OTHER = 'Z'.repeat(500), RUN = 'cp-20261023010000000-abcdef', SHA = '1'.repeat(40);
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'cyclepair-ios-wrapper-unit-')));
const fakeFlows = { ...DEFAULT_FLOWS, 'invitation-accept': { ...DEFAULT_FLOWS['invitation-accept'], ready: true } };
let index = 0;
const py = (script, args = []) => execFileSync('/usr/bin/python3', ['-c', script, ...args], { encoding: 'utf8' });
const exec = promisify(execFile);
async function fixture(binary = false) {
  const dir = path.join(root, `case-${index++}`); await mkdir(dir, { mode: 0o700 });
  const base = path.join(dir, 'base.xctestrun');
  py(`import plistlib,sys,pathlib,datetime
p=pathlib.Path(sys.argv[1]); d={'CyclePairPhysicalUITests':{'IsUITestBundle':True,'TestHostPath':'__TESTROOT__/Debug-iphoneos/Runner.app','TestBundlePath':'__TESTHOST__/PlugIns/Test.xctest','EnvironmentVariables':{'NORMAL':'preserve','CYCLEPAIR_TEST_RUN_ID':'stale'},'SystemAttachmentLifetime':'keepAlways','UserAttachmentLifetime':'keepAlways','UnknownData':b'abc','UnknownDate':datetime.datetime(2026,10,23)},'__xctestrun_metadata__':{'FormatVersion':1}}; p.write_bytes(plistlib.dumps(d,fmt=plistlib.FMT_BINARY if sys.argv[2]=='true' else plistlib.FMT_XML,sort_keys=False))`, [base, String(binary)]);
  await chmod(base, 0o600);
  const account = path.join(dir, 'owned-account.json'); await writeFile(account, '{"syntheticOnly":true}', { mode: 0o600 });
  const manifest = { app: 'cycle-pair', backend: 'emulator', installedSourceSha: SHA, accountOwnershipPath: account,
    runtimes: [{ platform: 'ios', kind: 'physical', deviceId: APPROVED_DEVICE_ID, appId: 'com.seorilabs.cyclepair', createdFor: 'cycle-pair-native-launch', authorized: true, appData: 'synthetic', allowAppDataReset: false }] };
  const ownership = path.join(dir, 'owned.json'); await writeFile(ownership, JSON.stringify(manifest), { mode: 0o600 });
  return { dir, base, manifest, ownership, options: { privateRoot: dir, backend: 'emulator', baseXctestrun: base, ownership, deviceId: APPROVED_DEVICE_ID, flow: 'cold-home', runId: RUN, output: path.join(dir, 'output'), candidateSha: SHA } };
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
  const f=await fixture(),x=fake(),options={...f.options,flow:'invitation-accept',invitation:CANARY};
  await assert.rejects(runPhysicalIosFlow(options,x)); await assert.rejects(runPhysicalIosFlow(options,{...x,flowDefinitions:fakeFlows})); assert.equal(x.calls.length,0);
});
test('공개 입력 근거의 후보, 설치와 signed helper가 같아야 초대 입력을 허용한다', async () => {
  const f = await fixture();
  const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  const original = { executionMode: 'physical', flow: 'invitation-canary', passed: true,
    sourceSha: SHA, requestedCandidateSha: SHA, ownershipManifestSHA256: await hash(f.ownership),
    plistPreparation: { sourceSHA256: await hash(f.base) }, summaryDeviceMatches: true,
    ownedXcodebuildGroupCleaned: true, privateRawRemoved: true,
    counts: { totalTestCount: 1, passedTests: 1, failedTests: 0, skippedTests: 0, expectedFailures: 0 } };
  const receipt = path.join(f.dir, 'canary.json');
  const options = { receipt, baseXctestrun: f.base, ownership: f.ownership, candidateSha: SHA, privateRoot: f.dir };
  for (const patch of [{executionMode: 'injected-fake'}, {passed: false}, {sourceSha: '2'.repeat(40)},
    {ownershipManifestSHA256: '3'.repeat(64)}, {plistPreparation: {sourceSHA256: '4'.repeat(64)}},
    {privateRawRemoved: false}, {ownedXcodebuildGroupCleaned: false}, {counts: {...original.counts, skippedTests: 1}}]) {
    await writeFile(receipt, JSON.stringify({...original, ...patch}), {mode: 0o600});
    await assert.rejects(validateCanaryReceipt(options));
  }
  await writeFile(receipt, JSON.stringify(original), {mode: 0o600});
  assert.equal(await validateCanaryReceipt(options), true);
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
 const f=await fixture(),x=fake({secret:true}); const r=await runPhysicalIosFlow({...f.options,flow:'invitation-accept',invitation:CANARY,allowSecretExecution:true,secretTransportValidated:true},{...x,flowDefinitions:fakeFlows}); assert.equal(r.passed,true);assert.equal(r.privateRawRemoved,true);assert.equal(r.rawBundleHash.files,1);await safeArtifacts(f.options.output);
});
for(const [name,override] of [['0개실행',{summary:{totalTestCount:0,passedTests:0}}],['두개실행',{summary:{totalTestCount:2,passedTests:2}}],['skip',{summary:{skippedTests:1}}],['fail',{summary:{failedTests:1}}],['expectedFailure',{summary:{expectedFailures:1}}],['다른기기',{summary:{devicesAndConfigurations:[{device:{deviceId:'other',platform:'iOS'}}]}}],['Simulator',{summary:{devicesAndConfigurations:[{device:{deviceId:APPROVED_DEVICE_ID,platform:'iOS Simulator'}}]}}],['오류종료',{code:65}],['timeout',{timedOut:true}],['잘못된요약',{invalid:true}],['요약오류',{summaryCode:1}]]) test(`${name}는 실패이며 원시파일을 정리한다`,async()=>{
 const f=await fixture(),x=fake(override),r=await runPhysicalIosFlow(f.options,x);assert.equal(r.passed,false);assert.equal(r.privateRawRemoved,true);await gone(x.plist());await gone(x.bundle());await safeArtifacts(f.options.output);
});
test('예외 메시지의 가짜 비밀도 가리고 실패 hash와 정리 결과를 남긴다',async()=>{
 const f=await fixture(),x=fake({secret:true,execute:async()=>{throw new Error('synthetic failure '+CANARY);}});const r=await runPhysicalIosFlow({...f.options,flow:'invitation-accept',invitation:CANARY,allowSecretExecution:true,secretTransportValidated:true},{...x,flowDefinitions:fakeFlows});assert.equal(r.passed,false);assert.equal(r.error,'synthetic failure [redacted]');assert.equal(r.privateRawRemoved,true);await safeArtifacts(f.options.output);
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
