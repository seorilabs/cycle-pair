import type { AccountSessionCleanup } from '../../domain/account/AccountSessionCleanup';
import type { CyclePairBackend } from '../backend/CyclePairBackend';
import type { CyclePairStateStorage } from '../local/CyclePairStateStorage';
import type { NotificationClient } from '../notifications/NotificationClient';
import type { ProductAnalytics } from '../observability/ProductAnalytics';
import type { SafeCrashReporter } from '../observability/SafeCrashReporter';
import {AccountOperationError} from '../../domain/account/AccountPort';

interface ShellPreferenceSnapshot {
  readonly neutralNotifications: boolean;
}

function readShellPreferenceSnapshot(raw: string | null): ShellPreferenceSnapshot {
  if (raw === null) return { neutralNotifications: false };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      neutralNotifications:
        value.schemaVersion === 4 && value.neutralNotifications === true,
    };
  } catch {
    // A corrupt preference cannot prove that notification opt-in was off.
    // Fail toward unregistering before an identity change.
    return { neutralNotifications: true };
  }
}

export function createAccountSessionCleanup({
  storage,
  backend,
  notificationClient,
  analytics,
  crashReporter,
}: {
  readonly storage: CyclePairStateStorage;
  readonly backend: CyclePairBackend;
  readonly notificationClient?: NotificationClient;
  readonly analytics?: ProductAnalytics;
  readonly crashReporter?: SafeCrashReporter;
}): AccountSessionCleanup {
  const recoverableShellSnapshots = new Map<string, string | null>();
  const disableDiagnostics = () => Promise.all([
    analytics?.setEnabled(false) ?? Promise.resolve(),
    crashReporter?.setEnabled(false) ?? Promise.resolve(),
  ]).then(() => undefined);

  return {
    async prepareForLogout(uid, recoverable) {
      const report = await backend.quiesceSessionForLogout(uid);
      if (report.remaining !== 0) {
        throw new AccountOperationError('account/pending-offline-changes');
      }
      const rawPreferences = await storage.read();
      if (recoverable) {
        recoverableShellSnapshots.set(uid, rawPreferences);
      } else {
        recoverableShellSnapshots.delete(uid);
      }
      const preferences = readShellPreferenceSnapshot(rawPreferences);
      if (preferences.neutralNotifications && notificationClient) {
        // Strict: a failed server unregister leaves Auth and the local token in
        // place, so the user can retry safely.
        await notificationClient.disableForAccountExit();
      }
      await disableDiagnostics();
      await storage.clear();
    },

    completeLogout(uid) {
      recoverableShellSnapshots.delete(uid);
    },

    async recoverFromFailedLogout(uid) {
      if (recoverableShellSnapshots.has(uid)) {
        const snapshot = recoverableShellSnapshots.get(uid) ?? null;
        if (snapshot === null) {
          await storage.clear();
        } else {
          await storage.write(snapshot);
        }
        recoverableShellSnapshots.delete(uid);
      }
      // Remounting the product provider after the shell snapshot is restored
      // re-enables the prior notification and diagnostics opt-ins.
      backend.resumeSession(uid);
    },

    async prepareForAccountDeletion(uid) {
      await backend.quiesceSession(uid);
      try {
        const preferences = readShellPreferenceSnapshot(await storage.read());
        await disableDiagnostics();
        // This must succeed before deleting the account; otherwise a subsequent
        // identity could inherit the previous user's local opt-ins.
        await storage.clear();
        let notificationUnregisterFailed = false;
        if (preferences.neutralNotifications && notificationClient) {
          try {
            // Account deletion recursively removes notificationDevices as the
            // authoritative fallback, so local token deletion can proceed even
            // when this best-effort unregister call fails.
            await notificationClient.disable();
          } catch {
            notificationUnregisterFailed = true;
          }
        }
        return { notificationUnregisterFailed };
      } catch (error) {
        // No deletion callable was started yet, so restoring the session is safe.
        backend.resumeSession(uid);
        throw error;
      }
    },
  };
}
