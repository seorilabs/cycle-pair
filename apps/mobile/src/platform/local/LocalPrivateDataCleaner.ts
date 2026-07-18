import {secureCyclePairCache} from './SecureCyclePairCache';
import {secureOfflineMutationQueue} from './SecureOfflineMutationQueue';
import {secureUserDataFence} from './SecureUserDataFence';

export interface LocalPrivateDataCleaner {
  purgeUser(uid: string): Promise<void>;
}

export const localPrivateDataCleaner: LocalPrivateDataCleaner = {
  async purgeUser(uid) {
    // Keep the UID blocked after purge. A successful logout may reuse the same
    // process, and a deleted account's cached ID token can outlive Auth deletion.
    await secureUserDataFence.blockAndDrain(uid);
    await Promise.all([
      secureOfflineMutationQueue.clearUser(uid),
      secureCyclePairCache.clearUser(uid),
    ]);
  },
};
