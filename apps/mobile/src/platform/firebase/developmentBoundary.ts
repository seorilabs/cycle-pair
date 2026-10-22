import AsyncStorage from '@react-native-async-storage/async-storage';
const KEY = 'cyclepair.development-backend.v1';
export async function assertDevelopmentBoundary(
  mode: 'emulator' | 'service',
  hasIdentity: boolean,
) {
  const previous = await AsyncStorage.getItem(KEY);
  if (
    (previous !== null && previous !== mode) ||
    (mode === 'emulator' && previous === null && hasIdentity)
  ) {
    // Keep all credentials, encrypted caches and pending writes intact. A
    // developer must use a fresh, isolated test installation for the other backend.
    throw new Error(
      'Development backend conflict: use an isolated test installation',
    );
  }
  if (previous === null) await AsyncStorage.setItem(KEY, mode);
}
