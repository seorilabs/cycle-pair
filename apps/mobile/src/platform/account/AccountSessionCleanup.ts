import type { AccountSessionCleanup } from '../../domain/account/AccountSessionCleanup';
import type { CyclePairBackend } from '../backend/CyclePairBackend';
import type { CyclePairStateStorage } from '../local/CyclePairStateStorage';
import type { NotificationClient } from '../notifications/NotificationClient';
import type { ProductAnalytics } from '../observability/ProductAnalytics';
import type { SafeCrashReporter } from '../observability/SafeCrashReporter';
import {AccountOperationError} from '../../domain/account/AccountPort';
import { SHELL_PREFERENCES_SCHEMA_VERSION } from '../../app/shellPreferencesSchema';

interface ShellPreferenceSnapshot {
  readonly neutralNotifications: boolean;
}

/**
 * 신원이 바뀌기 전에 이전 계정의 푸시 등록을 해제할지 판정한다.
 *
 * 원칙은 하나다 — **알 수 없으면 해제 쪽**이다. 알림 opt-in 이 꺼져 있었다고
 * 증명하지 못하면 해제를 시도한다. 저장된 것이 아예 없을 때만 해제할 것도
 * 없다고 본다.
 *
 * 예전에는 파싱 실패는 해제 쪽으로 넘기면서, 파싱은 됐는데 버전을 모르는
 * 경우는 건너뛰기 쪽으로 넘겼다. 같은 "알 수 없음"을 반대로 처리한 것이다.
 * 구버전에서 올라온 기기는 서버 등록이 살아 있는데 로컬 선호만 off 라,
 * 로그아웃해도 이전 계정의 알림이 계속 갔다.
 */
function readShellPreferenceSnapshot(raw: string | null): ShellPreferenceSnapshot {
  // 저장된 선호가 없다. 해제할 등록도 없다.
  if (raw === null) return { neutralNotifications: false };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.schemaVersion !== SHELL_PREFERENCES_SCHEMA_VERSION) {
      // 구버전이거나 미래 버전이다. 이 문서의 opt-in 표현을 신뢰할 수 없다.
      return { neutralNotifications: true };
    }
    return { neutralNotifications: value.neutralNotifications === true };
  } catch {
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
