import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@cyclepair/app-state/v1';

export interface CyclePairStateStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

export const asyncStorageCyclePairStateStorage: CyclePairStateStorage = {
  read: () => AsyncStorage.getItem(STORAGE_KEY),
  write: value => AsyncStorage.setItem(STORAGE_KEY, value),
  clear: () => AsyncStorage.removeItem(STORAGE_KEY),
};
