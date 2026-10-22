export function validatePhysicalRuntime(runtime) {
  if (
    runtime.createdFor !== 'cycle-pair-native-launch' ||
    runtime.kind !== 'physical' ||
    runtime.appData !== 'synthetic' ||
    runtime.authorized !== true
  ) throw new Error('Use an authorized physical Cycle Pair test installation with synthetic data');
  if (!['android', 'ios'].includes(runtime.platform))
    throw new Error('Unknown physical platform');
  if (typeof runtime.deviceId !== 'string' || !runtime.deviceId.trim() ||
    runtime.deviceId.startsWith('emulator-'))
    throw new Error('Virtual devices are excluded');
  if (runtime.allowAppDataReset === true)
    throw new Error('App data reset is excluded from connected device testing');
  if (!['com.seorilabs.cyclepair', 'com.seorilabs.cyclepair.qa'].includes(runtime.appId))
    throw new Error('Only Cycle Pair installations may be tested');
}

export function assertPhysicalAndroidState(state, qemu) {
  if (state.trim() !== 'device' || qemu.trim() === '1')
    throw new Error('The selected Android device must be connected and physical');
}
