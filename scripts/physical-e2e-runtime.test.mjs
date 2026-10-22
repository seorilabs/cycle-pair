import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePhysicalRuntime, assertPhysicalAndroidState} from './physical-e2e-runtime.mjs';

const owned = {createdFor: 'cycle-pair-native-launch', kind: 'physical', appData: 'synthetic', authorized: true, platform: 'android', deviceId: 'synthetic-connected-android', appId: 'com.seorilabs.cyclepair.qa'};
test('permits only the approved physical synthetic installation', () => {
  validatePhysicalRuntime(owned);
  for (const change of [{authorized: false}, {appData: 'existing-user'}, {kind: 'simulator'}, {createdFor: 'another-task'}, {deviceId: ''}, {deviceId: 'emulator-5580'}, {allowAppDataReset: true}, {appId: 'unrelated.app'}])
    assert.throws(() => validatePhysicalRuntime({...owned, ...change}));
});
test('rejects an emulator or an unavailable physical connection', () => {
  assertPhysicalAndroidState('device\n', '\n');
  assertPhysicalAndroidState('device\n', '0\n');
  assert.throws(() => assertPhysicalAndroidState('device', '1'));
  assert.throws(() => assertPhysicalAndroidState('offline', '0'));
  assert.throws(() => assertPhysicalAndroidState('unauthorized', ''));
});
