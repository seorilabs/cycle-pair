import AsyncStorage from '@react-native-async-storage/async-storage';
import { assertDevelopmentBoundary } from './developmentBoundary';
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
test('a fresh isolated installation can keep using its selected backend', async () => {
  await assertDevelopmentBoundary('emulator', false);
  await expect(
    assertDevelopmentBoundary('emulator', true),
  ).resolves.toBeUndefined();
});
test('a backend switch fails without deleting any saved records or queued writes', async () => {
  await assertDevelopmentBoundary('emulator', false);
  await expect(assertDevelopmentBoundary('service', true)).rejects.toThrow(
    'isolated',
  );
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  expect(AsyncStorage.clear).not.toHaveBeenCalled();
});
test('an existing account can upgrade the service build, but cannot silently enter the emulator', async () => {
  await expect(assertDevelopmentBoundary('emulator', true)).rejects.toThrow(
    'isolated',
  );
  await expect(
    assertDevelopmentBoundary('service', true),
  ).resolves.toBeUndefined();
});
