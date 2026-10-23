import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as inputs from './private-e2e-input.mjs';
import { androidAccountCanaryOptions } from './maestro-process.mjs';

const preset = { flow: 'account-input-canary', authoring: true, scope: 'solo', backend: 'emulator',
  runtimes: [{ platform: 'android', appId: 'com.seorilabs.cyclepair.qa' }] };

test('Android 공개 canary는 SOLO authoring의 고정 공개 입력만 전달한다', () => {
  const options = androidAccountCanaryOptions(preset);
  assert.deepEqual(options, { inputKind: 'account', privateInput: { kind: 'account', ...inputs.PUBLIC_ACCOUNT_CANARY } });
  assert.deepEqual(androidAccountCanaryOptions({ ...preset, flow: 'cold-home' }), {});
  assert.deepEqual(androidAccountCanaryOptions({ ...preset, runtimes: [{ platform: 'ios' }] }), {});
  for (const patch of [{ authoring: false }, { scope: 'pair' }, { backend: 'service' },
    { runtimes: [{ platform: 'android', appId: 'com.seorilabs.cyclepair' }] },
    { flow: 'account-input-canary,record' }])
    assert.throws(() => androidAccountCanaryOptions({ ...preset, ...patch }), /SOLO/);
});

test('공개 Android canary의 잘못된 대상은 adb와 출력 생성 전에 거절한다', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cp-account-canary-contract-'));
  try {
    const output = path.join(dir, 'output'), ownership = path.join(dir, 'ownership.json');
    await writeFile(ownership, JSON.stringify({ app: 'cycle-pair', backend: 'emulator', adb: path.join(dir, 'must-not-run-adb'),
      runtimes: [{ ...preset.runtimes[0], appId: 'com.seorilabs.cyclepair', deviceId: 'public-fake-device',
        createdFor: 'cycle-pair-native-launch', kind: 'physical', appData: 'synthetic', authorized: true }] }));
    await assert.rejects(promisify(execFile)(process.execPath, ['scripts/run-native-e2e.mjs', '--backend', 'emulator',
      '--ownership', ownership, '--output', output, '--maestro', 'must-not-run-maestro', '--authoring',
      '--scope', 'solo', '--flow', 'account-input-canary']), error => error.stderr.includes('SOLO'));
    await assert.rejects(access(output));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('화면 흐름은 같은 입력 ID의 빈값과 마스킹을 확인하고 제출하지 않는다', async () => {
  const flow = await readFile('e2e/flows/account-input-canary.yaml', 'utf8');
  for (const id of ['account-upgrade-email', 'account-upgrade-password', 'account-upgrade-password-confirm'])
    assert.ok([...flow.matchAll(new RegExp(`^\\s+id: ${id}$`, 'gm'))].length >= 3,
      `${id}: 입력 전, 입력 후, 다시 열기 검사가 필요`);
  assert.match(flow, /MAESTRO_TEST_ACCOUNT_EMAIL === 'cyclepair-public-canary@example\.invalid'/);
  assert.match(flow, /MAESTRO_TEST_ACCOUNT_PASSWORD === 'CyclePair-Public-Canary!2026'/);
  assert.match(flow, /Guest\|게스트/);
  assert.match(flow, /\[•●\*\]/);
  for (const stage of ['initial-email-empty', 'initial-password-empty', 'initial-confirm-empty', 'email-exact',
    'password-masked', 'confirm-masked', 'closed', 'reopened', 'cleared-email', 'cleared-password', 'cleared-confirm', 'closed-again'])
    assert.ok(flow.includes(`CP_ACCOUNT_CANARY stage=${stage}`));
  assert.doesNotMatch(flow, /account-upgrade-submit|takeScreenshot|copyTextFrom|pasteText|clearState|clearKeychain|openLink|runScript/);
  const taps = [...flow.matchAll(/^- tapOn: (.+)$|^- tapOn:\n    id: (.+)$/gm)].map(match => match[1] || match[2]);
  assert.equal(taps.length, [...flow.matchAll(/^- tapOn/gm)].length);
  assert.deepEqual(new Set(taps), new Set(['tab-settings', 'tab-home', 'account-upgrade-email',
    'account-upgrade-password', 'account-upgrade-password-confirm', "'Back|뒤로'", "'.*(Account and recovery|계정과 복구).*'"]));
  const ui = await readFile('apps/mobile/src/components/AccountSettingsCard.tsx', 'utf8');
  for (const id of ['account-upgrade-email', 'account-upgrade-password', 'account-upgrade-password-confirm'])
    assert.ok(ui.includes(`testID="${id}"`));
});
