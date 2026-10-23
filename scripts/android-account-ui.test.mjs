import test from 'node:test';
import assert from 'node:assert/strict';
import { observeAccountInputEmpty } from './android-account-ui.mjs';
import { runOwnedCommand } from './physical-ios-wrapper.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const appId = 'com.seorilabs.cyclepair.qa';
const runtime = { appId, platform: 'android', deviceId: 'public-fake-device', createdFor: 'cycle-pair-native-launch',
  kind: 'physical', appData: 'synthetic', authorized: true };
const ready = { code: 0, timedOut: false, ownedGroupCleaned: true };
const foreground = `topResumedActivity=ActivityRecord{public u0 ${appId}/.MainActivity t1}`;
const node = (text, extra = '') => `<node package="${appId}" resource-id="account-upgrade-email" text="${text}" hintText="name@example.com" ${extra}/>`;
const hierarchy = body => `<?xml version="1.0"?><hierarchy>${body}</hierarchy>\nUI hierchary dumped to: /dev/tty\n`;
function harness({ xml = hierarchy(node('')), before = foreground, after = foreground, fail } = {}) {
  const calls = [];
  let reads = 0;
  return { calls, readUiService: async options => {
    calls.push({ ui: options });
    if (fail) throw Object.assign(new Error('public-sensitive-fake-error'), { stdout: xml });
    reads++;
    return options.hierarchy ? xml : (reads === 1 ? before : after);
  }, runCommand: async (binary, args, options) => {
    calls.push({ binary, args, options });
    if (fail) throw Object.assign(new Error('public-sensitive-fake-error'), { stdout: xml });
    if (binary === '/usr/bin/python3') return runOwnedCommand(binary, args, options);
    throw new Error('실제 adb 실행은 허용하지 않음');
  } };
}
const observe = (dependencies, patch = {}) => observeAccountInputEmpty({ runtime, field: 'email', driverPort: 32457, ...patch }, dependencies);

test('UI 빈값은 hint가 아니라 실제 text로 판정하며 원문은 parser stdin으로만 보낸다', async () => {
  for (const text of ['', 'public-existing-draft', 'name@example.com']) {
    const xml = hierarchy(node(text)), fake = harness({ xml });
    assert.deepEqual(await observe(fake), { empty: text === '' });
    assert.equal(fake.calls.length, 4);
    assert.equal(fake.calls[1].ui.hierarchy, true);
    assert.equal(fake.calls[1].ui.deviceId, runtime.deviceId);
    assert.equal(fake.calls[1].ui.driverPort, 32457);
    assert.equal(fake.calls[3].options.input, xml);
    assert.equal(JSON.stringify(fake.calls.map(call => call.args)).includes(xml), false);
  }
});

test('없는 ID, 중복 ID, 다른 package, 없는 text와 잘못된 XML은 빈값으로 보지 않는다', async () => {
  for (const xml of [hierarchy(''), hierarchy(node('') + node('')),
    hierarchy(node('').replace(`package="${appId}"`, 'package="public.other"')),
    hierarchy(node('').replace('text=""', '')),
    hierarchy(node('')).replace('</hierarchy>', '</broken>'),
    '<!DOCTYPE hierarchy><hierarchy/>']) {
    await assert.rejects(observe(harness({ xml })), { message: 'QA 계정 입력의 빈값을 확인하지 못했습니다' });
  }
  const namespaced = hierarchy(node('').replace('resource-id="account-upgrade-email"', `resource-id="${appId}:id/account-upgrade-email"`));
  assert.deepEqual(await observe(harness({ xml: namespaced })), { empty: true });
});

test('QA 전면을 XML 전후 확인하고 다른 앱, 불명확한 전면과 capture 예외는 원문 없이 거절한다', async () => {
  for (const patch of [{ before: '' }, { before: foreground.replace(appId, 'public.other') },
    { after: foreground.replace(appId, 'public.other') }, { before: foreground + '\nmResumedActivity: ActivityRecord{x u0 public.other/.A}' }, { fail: true }]) {
    await assert.rejects(observe(harness(patch)), error => error.message === 'QA 계정 입력의 빈값을 확인하지 못했습니다' &&
      !('stdout' in error) && !error.message.includes('public-sensitive'));
  }
});

test('원본 앱과 미승인 대상, 알 수 없는 필드는 어떤 command도 실행하지 않는다', async () => {
  for (const patch of [{ driverPort: undefined }, { driverPort: 0 }, { driverPort: '32457' }, { field: 'arbitrary' }, { runtime: { ...runtime, appId: 'com.seorilabs.cyclepair' } },
    { runtime: { ...runtime, authorized: false } }, { runtime: { ...runtime, platform: 'ios' } }]) {
    const fake = harness();
    await assert.rejects(observe(fake, patch));
    assert.equal(fake.calls.length, 0);
  }
});

test('취소와 과도한 capture는 소유 command signal로 중단하고 결과를 반환하지 않는다', async () => {
  const cancelled = AbortSignal.abort();
  await assert.rejects(observe(harness(), { signal: cancelled }));
  const fake = harness();
  fake.runCommand = async (_binary, _args, options) => {
    options.onStdout(Buffer.alloc(4 * 1024 * 1024 + 1, 65));
    assert.equal(options.signal.aborted, true);
    return ready;
  };
  await assert.rejects(observe(fake));
});

test('보호 채널 script는 bool만 반환하고 관찰 오류를 빈칸 성공으로 바꾸지 않는다', async () => {
  const script = await readFile('e2e/scripts/read-account-empty.js', 'utf8');
  for (const empty of [true, false]) {
    const context = { output: {}, ACCOUNT_FIELD: 'email', MAESTRO_CONTROL_URL: 'http://public-fake',
      http: { get: () => ({ status: 200, body: JSON.stringify({ empty }) }) } };
    vm.runInNewContext(script, context);
    assert.equal(context.output.accountInputEmpty, empty);
  }
  for (const response of [{ status: 409, body: 'public-fake-error' }, { status: 200, body: '{}' }])
    assert.throws(() => vm.runInNewContext(script, { output: {}, ACCOUNT_FIELD: 'email',
      MAESTRO_CONTROL_URL: 'http://public-fake', http: { get: () => response } }));
  const runner = await readFile('scripts/run-native-e2e.mjs', 'utf8');
  assert.match(runner, /field && androidAccountInput.inputKind === 'account' && request.method === 'GET'/);
  assert.match(runner, /accountObservation.abort\(\)/);
});

test('Maestro가 UiAutomation을 점유해도 별도 uiautomator를 실행하지 않는다', async () => {
  const xml = hierarchy(node(''));
  const dependencies = {
    readUiService: async ({ hierarchy: readHierarchy }) => readHierarchy ? xml : foreground,
    runCommand: async (binary, args, options) => {
      if (binary === '/usr/bin/python3') return runOwnedCommand(binary, args, options);
      if (args.includes('uiautomator')) {
        options.onStderr(Buffer.from('UiAutomationService already registered!'));
        return { ...ready, code: 1 };
      }
      options.onStdout(Buffer.from(foreground));
      return ready;
    },
  };
  assert.deepEqual(await observe(dependencies), { empty: true });
});

test('로그인과 재인증의 기존 고정 label은 EditText와 secure 속성까지 확인해 빈값만 읽는다', async () => {
  for (const [field, label, secure] of [['login-email', 'Sign-in email', false],
    ['login-password', '로그인 비밀번호', true], ['reauth-password', 'Current password for verification', true]]) {
    const content = `<node package="${appId}" class="android.widget.EditText" content-desc="${label}" password="${secure}" text=""/>`;
    assert.deepEqual(await observe(harness({xml: hierarchy(content)}), {field}), {empty: true});
    for (const bad of [content + content, content.replace('android.widget.EditText', 'android.widget.TextView'),
      content.replace(`password="${secure}"`, `password="${!secure}"`), content.replace(appId, 'public.other')])
      await assert.rejects(observe(harness({xml: hierarchy(bad)}), {field}));
  }
});
