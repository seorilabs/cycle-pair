import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, realpath, mkdir, chmod, symlink, access, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {ANDROID_AUTH_FLOWS, ANDROID_CANARY_STAGES, androidAuthRequested, androidAccountBinding,
  makeAndroidAccountCanaryReceipt, loadAndroidAccountInput, removeAndroidRawAfterGroup} from './physical-android-account.mjs';

const fakeInput = {kind: 'account', email: 'public-fake-account@example.invalid', password: 'Public"Fake\\Password!😀'};
async function fixture() {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'cp-android-auth-fixture-')));
  try {
  const put = async (relative, value, mode = 0o600) => {
    const file = path.join(dir, relative); await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
    await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value), {mode}); return file;
  };
  const sha = 'a'.repeat(40), apk = await put('app.apk', 'public-fake-apk');
  const account = await put('account.json', {app: 'cycle-pair', backend: 'emulator', platform: 'android', syntheticOnly: true,
    appId: 'com.seorilabs.cyclepair.qa', deviceId: 'public-fake-device', uid: 'public-fake-owned-uid'});
  const maestro = await put('tool/bin/maestro', 'public-fake-launcher', 0o700);
  await put('tool/lib/maestro-client.jar', 'public-fake-driver');
  for (const name of ['account-input-canary', ...ANDROID_AUTH_FLOWS]) await put(`e2e/flows/${name}.yaml`, '# public-fake-flow');
  await put('e2e/scripts/read-account-empty.js', '// public-fake-observation');
  const hash = createHash('sha256').update(await readFile(apk)).digest('hex');
  const manifest = {app: 'cycle-pair', backend: 'emulator', candidateSourceSha: sha, nativeArtifactBuildSourceSha: sha,
    installedArtifactReadbackInThisRun: true, artifactPath: apk, artifactSHA256: hash, installedArtifactSHA256: hash, accountOwnershipPath: account,
    runtimes: [{platform: 'android', kind: 'physical', appId: 'com.seorilabs.cyclepair.qa', deviceId: 'public-fake-device',
      createdFor: 'cycle-pair-native-launch', authorized: true, appData: 'synthetic', allowAppDataReset: false}]};
  const ownership = await put('owned.json', manifest), inputFile = await put('input.json', fakeInput);
  const options = {ownership, inputFile, candidateSha: sha, privateRoot: dir, maestro, sourceRoot: dir};
  const binding = await androidAccountBinding(options);
  const receipt = makeAndroidAccountCanaryReceipt(binding, {passed: true, sourceDirty: false, stages: ANDROID_CANARY_STAGES,
    ownedMaestroGroupCleaned: true, privateRawRemoved: true, keyboardSubtypesRestored: true, reversePortsRestored: true});
  options.receipt = await put('receipt.json', receipt);
  return {dir, put, options, receipt, manifest, binding};
  } catch (error) { await rm(dir, {recursive: true, force: true}); throw error; }
}

test('normalAuth4는 실제 공개 canary 근거 없이 ADB까지 진행하지 않는다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cp-android-auth-contract-'));
  try {
    const adb = path.join(dir, 'fake-adb'), touched = path.join(dir, 'device-command');
    await writeFile(adb, `#!/bin/sh\nprintf observed > '${touched}'\nexit 1\n`, {mode: 0o700});
    const ownership = path.join(dir, 'owned.json');
    await writeFile(ownership, JSON.stringify({app: 'cycle-pair', backend: 'emulator', adb,
      runtimes: [{platform: 'android', kind: 'physical', appId: 'com.seorilabs.cyclepair.qa', deviceId: 'public-fake-device',
        createdFor: 'cycle-pair-native-launch', authorized: true, appData: 'synthetic', allowAppDataReset: false}]}), {mode: 0o600});
    await assert.rejects(promisify(execFile)(process.execPath, ['scripts/run-native-e2e.mjs', '--backend', 'emulator',
      '--scope', 'solo', '--authoring', '--flow', 'account-upgrade', '--ownership', ownership,
      '--output', path.join(dir, 'output'), '--maestro', path.join(dir, 'must-not-run-maestro')]),
    error => error.stderr.includes('공개 canary'));
    await assert.rejects(access(touched));
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('Auth4는 로컬 QA SOLO authoring의 순서가 맞는 계정 흐름만 허용한다', () => {
  const good = {flow: ANDROID_AUTH_FLOWS.join(','), backend: 'emulator', scope: 'solo', authoring: true,
    inputFile: '/public-fake-input', receipt: '/public-fake-receipt', runtimes: [{platform: 'android', appId: 'com.seorilabs.cyclepair.qa'}]};
  assert.equal(androidAuthRequested(good), true);
  for (const patch of [{backend: 'service'}, {scope: 'pair'}, {authoring: false}, {flow: 'account-login,record'},
    {flow: 'account-login,account-upgrade'}, {receipt: undefined}, {inputFile: undefined}])
    assert.throws(() => androidAuthRequested({...good, ...patch}), /공개 canary/);
  assert.equal(androidAuthRequested({...good, flow: 'record', inputFile: undefined, receipt: undefined}), false);
});

test('같은 후보와 모든 지문의 모의 PASS 근거를 검증한 뒤에만 typed 파일을 읽는다', async () => {
  const f = await fixture();
  try {
    let reads = 0;
    assert.deepEqual(await loadAndroidAccountInput(f.options, {readInputFile: async (...args) => { reads++; return readFile(...args); }}),
      {inputKind: 'account', privateInput: fakeInput});
    assert.equal(reads, 1);
  } finally { await rm(f.dir, {recursive: true, force: true}); }
});

test('목적, 후보, 실패와 미정리 모의 근거는 private input read 전에 거절한다', async () => {
  const f = await fixture();
  try {
    const changes = [{purpose: 'invitation'}, {flow: 'diagnostics-consent'}, {driver: 'xctest'}, {diagnosticOnly: true},
      {sourceSha: 'b'.repeat(40)}, {passed: false}, {sourceDirty: true}, {accountOwnershipSHA256: 'b'.repeat(64)},
      {ownershipManifestSHA256: 'b'.repeat(64)}, {apkSHA256: 'b'.repeat(64)}, {maestroSHA256: 'b'.repeat(64)}, {flowSHA256: 'b'.repeat(64)},
      {ownedMaestroGroupCleaned: false}, {privateRawRemoved: false}, {keyboardSubtypesRestored: false}, {reversePortsRestored: false},
      {counts: {...f.receipt.counts, skippedTests: 1}}, {completedAt: new Date(Date.now() - 169 * 3600000).toISOString()},
      {canaryScope: {...f.receipt.canaryScope, passwordExactInputValidated: true}}];
    for (const patch of changes) {
      await writeFile(f.options.receipt, JSON.stringify({...f.receipt, ...patch}));
      let reads = 0;
      await assert.rejects(loadAndroidAccountInput(f.options, {readInputFile() { reads++; throw new Error('읽으면 안 됨'); }}), /공개 canary/);
      assert.equal(reads, 0);
    }
  } finally { await rm(f.dir, {recursive: true, force: true}); }
});

test('실제 파일 지문 변경과 가짜 경로, symlink와 공개 권한은 입력 전에 거절한다', async () => {
  for (const relative of ['app.apk', 'tool/lib/maestro-client.jar', 'e2e/flows/account-login.yaml', 'account.json']) {
    const f = await fixture();
    try {
      await writeFile(path.join(f.dir, relative), 'public-fake-modified');
      let reads = 0;
      await assert.rejects(loadAndroidAccountInput(f.options, {readInputFile() { reads++; }}));
      assert.equal(reads, 0);
    } finally { await rm(f.dir, {recursive: true, force: true}); }
  }
  const f = await fixture();
  try {
    for (const patch of [{candidateSha: 'b'.repeat(40)}, {receipt: '/public-fake-outside/receipt.json'}])
      await assert.rejects(loadAndroidAccountInput({...f.options, ...patch}));
    const link = path.join(f.dir, 'receipt-link.json'); await symlink(f.options.receipt, link);
    await assert.rejects(loadAndroidAccountInput({...f.options, receipt: link}));
    await chmod(f.options.inputFile, 0o644);
    let reads = 0;
    await assert.rejects(loadAndroidAccountInput(f.options, {readInputFile() { reads++; }}));
    assert.equal(reads, 0);
  } finally { await rm(f.dir, {recursive: true, force: true}); }
});

test('잘못된 typed 입력과 UTF16, 읽기 예외는 값과 값별 hash 없이 일반 오류만 남긴다', async () => {
  const f = await fixture();
  try {
    for (const input of [{...fakeInput, kind: 'invitation'}, {...fakeInput, extra: 'public-fake'}, {...fakeInput, password: 'public-fake-\uD800'},
      {...fakeInput, email: ''}]) {
      await writeFile(f.options.inputFile, JSON.stringify(input));
      await assert.rejects(loadAndroidAccountInput(f.options), error => !error.message.includes('public-fake') && !error.message.includes(fakeInput.email));
    }
    await assert.rejects(loadAndroidAccountInput(f.options, {readInputFile() { throw new Error(JSON.stringify(fakeInput)); }}),
      error => !error.stack.includes(fakeInput.email) && !error.stack.includes('Password'));
  } finally { await rm(f.dir, {recursive: true, force: true}); }
});

test('실제 canary receipt는 모든 공개 단계와 정리가 끝나야만 PASS가 된다', () => {
  const ready = {passed: true, sourceDirty: false, stages: ANDROID_CANARY_STAGES, ownedMaestroGroupCleaned: true,
    privateRawRemoved: true, keyboardSubtypesRestored: true, reversePortsRestored: true};
  assert.equal(makeAndroidAccountCanaryReceipt({}, ready).passed, true);
  for (const patch of [{stages: []}, {passed: false}, {sourceDirty: true}, {privateRawRemoved: false}, {ownedMaestroGroupCleaned: false}])
    assert.equal(makeAndroidAccountCanaryReceipt({}, {...ready, ...patch}).passed, false);
});

test('소유 그룹 미정리 때는 원시 폴더를 남기고 정리 확인 뒤에만 삭제한다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cp-android-raw-contract-'));
  try {
    const file = path.join(dir, 'public-fake-raw'); await writeFile(file, 'public-fake', {mode: 0o600});
    assert.equal(await removeAndroidRawAfterGroup(dir, false), false); await access(file);
    assert.equal(await removeAndroidRawAfterGroup(dir, true), true); await assert.rejects(access(file));
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('Auth4 YAML은 실제 UI 입력과 완료를 사용하고 캡처와 내부함수 우회를 하지 않는다', async () => {
  for (const name of ANDROID_AUTH_FLOWS) {
    const flow = await readFile(`e2e/flows/${name}.yaml`, 'utf8');
    assert.match(flow, /stopApp/); assert.match(flow, /launchApp/); assert.match(flow, /CP_ACCOUNT_AUTH action=/);
    assert.doesNotMatch(flow, /takeScreenshot|copyTextFrom|pasteText|clearState|clearKeychain|openLink|Firebase|http\./);
    if (name !== 'account-logout') assert.match(flow, /inputText: \$\{MAESTRO_TEST_ACCOUNT_PASSWORD\}/);
  }
  const logout = await readFile('e2e/flows/account-logout.yaml', 'utf8');
  assert.match(logout, /android:id\/button2/); assert.match(logout, /android:id\/button1/); assert.match(logout, /account-login-submit/);
  const reauth = await readFile('e2e/flows/account-reauthenticate.yaml', 'utf8');
  assert.equal([...reauth.matchAll(/ACCOUNT_FIELD: reauth-password/g)].length, 2);
});


test('이메일 selector는 Env 치환 경계와 외부 끝 anchor, JS literal quoting을 보존한다', async () => {
  const email = 'public.fake+tag@example.invalid';
  for (const name of ['account-upgrade', 'account-login']) {
    const flow = await readFile(`e2e/flows/${name}.yaml`, 'utf8');
    const expression = flow.split('\n').find(line => line.includes('text: ${') && line.includes('MAESTRO_TEST_ACCOUNT_EMAIL'));
    assert.ok(expression, name);
    const selector = expression.slice(expression.indexOf('${'));
    // Maestro Env의 ([^$]*)는 표현식 안의 $를 허용하지 않는다.
    const matches = [...selector.matchAll(/\$\{([^$]*)\}/g)];
    assert.equal(matches.length, 1, name);
    assert.equal(matches[0].index, 0, name);
    const suffix = selector.slice(matches[0][0].length);
    assert.equal(suffix, '$', name);
    assert.equal(runInNewContext(matches[0][1], {MAESTRO_TEST_ACCOUNT_EMAIL: email}) + suffix,
      String.raw`^\Q${email}\E$`, name);
  }
});
