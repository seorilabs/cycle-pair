import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@moonmate/app-state/v1';

export interface MoonMateStateStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

export const asyncStorageMoonMateStateStorage: MoonMateStateStorage = {
  read: () => AsyncStorage.getItem(STORAGE_KEY),
  write: value => AsyncStorage.setItem(STORAGE_KEY, value),
  clear: () => AsyncStorage.removeItem(STORAGE_KEY),
};
