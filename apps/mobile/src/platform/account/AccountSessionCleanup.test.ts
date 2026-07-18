import type { CyclePairStateStorage } from '../local/CyclePairStateStorage';
import { previewCyclePairBackend } from '../backend/PreviewCyclePairBackend';
import type { NotificationClient } from '../notifications/NotificationClient';
import type { ProductAnalytics } from '../observability/ProductAnalytics';
import type { SafeCrashReporter } from '../observability/SafeCrashReporter';
import { createAccountSessionCleanup } from './AccountSessionCleanup';

function dependencies(notifications = true) {
  const storage: CyclePairStateStorage = {
    read: jest.fn(async () => JSON.stringify({
      schemaVersion: 4,
      neutralNotifications: notifications,
      diagnosticsEnabled: true,
    })),
    write: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  };
  const notificationClient: NotificationClient = {
    enable: jest.fn(async () => 'authorized'),
    disable: jest.fn(async () => undefined),
    disableForAccountExit: jest.fn(async () => undefined),
    watchTokenRefresh: jest.fn(() => jest.fn()),
    watchOpened: jest.fn(() => jest.fn()),
  };
  const analytics: ProductAnalytics = {
    setEnabled: jest.fn(async () => undefined),
    track: jest.fn(async () => undefined),
  };
  const crashReporter: SafeCrashReporter = {
    setEnabled: jest.fn(async () => undefined),
    recordFailure: jest.fn(async () => undefined),
  };
  const backend = {
    ...previewCyclePairBackend,
    quiesceSessionForLogout: jest.fn(async () => ({
      flushed: 0,
      remaining: 0,
      failed: 0,
    })),
    quiesceSession: jest.fn(async () => undefined),
    resumeSession: jest.fn(),
  };
  return { storage, backend, notificationClient, analytics, crashReporter };
}

describe('account session cleanup', () => {
  it('awaits strict notification unregister and resets diagnostics/preferences for logout', async () => {
    const input = dependencies();
    const cleanup = createAccountSessionCleanup(input);

    await cleanup.prepareForLogout('user-a', true);

    expect(input.analytics.setEnabled).toHaveBeenCalledWith(false);
    expect(input.crashReporter.setEnabled).toHaveBeenCalledWith(false);
    expect(input.notificationClient.disableForAccountExit).toHaveBeenCalled();
    expect(input.notificationClient.disable).not.toHaveBeenCalled();
    expect(input.storage.clear).toHaveBeenCalled();
    expect(input.backend.quiesceSessionForLogout).toHaveBeenCalledWith(
      'user-a',
    );
    expect(
      (input.backend.quiesceSessionForLogout as jest.Mock)
        .mock.invocationCallOrder[0],
    ).toBeLessThan(
      (input.notificationClient.disableForAccountExit as jest.Mock)
        .mock.invocationCallOrder[0],
    );
    expect(
      (input.notificationClient.disableForAccountExit as jest.Mock)
        .mock.invocationCallOrder[0],
    ).toBeLessThan(
      (input.analytics.setEnabled as jest.Mock).mock.invocationCallOrder[0],
    );
    expect(
      (input.notificationClient.disableForAccountExit as jest.Mock)
        .mock.invocationCallOrder[0],
    ).toBeLessThan(
      (input.crashReporter.setEnabled as jest.Mock)
        .mock.invocationCallOrder[0],
    );
    expect(
      Math.max(
        (input.analytics.setEnabled as jest.Mock).mock.invocationCallOrder[0],
        (input.crashReporter.setEnabled as jest.Mock)
          .mock.invocationCallOrder[0],
      ),
    ).toBeLessThan(
      (input.storage.clear as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it('restores shell preferences before resuming a failed logout', async () => {
    const input = dependencies();
    const cleanup = createAccountSessionCleanup(input);

    await cleanup.prepareForLogout('user-a', true);
    await cleanup.recoverFromFailedLogout('user-a');

    expect(input.storage.write).toHaveBeenCalledWith(
      expect.stringContaining('"neutralNotifications":true'),
    );
    expect(
      (input.storage.write as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (input.backend.resumeSession as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it('fails logout cleanup without clearing preferences when unregister fails', async () => {
    const input = dependencies();
    (input.notificationClient.disableForAccountExit as jest.Mock)
      .mockRejectedValueOnce(new Error('unregister failed'));
    const cleanup = createAccountSessionCleanup(input);

    await expect(cleanup.prepareForLogout('user-a', true)).rejects.toThrow(
      'unregister failed',
    );
    expect(input.storage.clear).not.toHaveBeenCalled();
    expect(input.backend.resumeSession).not.toHaveBeenCalled();
  });

  it('does not clear local data when an offline mutation cannot be flushed', async () => {
    const input = dependencies();
    (input.backend.quiesceSessionForLogout as jest.Mock).mockResolvedValueOnce({
      flushed: 0,
      remaining: 1,
      failed: 0,
    });
    const cleanup = createAccountSessionCleanup(input);

    await expect(cleanup.prepareForLogout('user-a', true)).rejects.toMatchObject(
      { code: 'account/pending-offline-changes' },
    );
    expect(input.notificationClient.disableForAccountExit).not.toHaveBeenCalled();
    expect(input.storage.clear).not.toHaveBeenCalled();
  });

  it('continues account deletion after best-effort unregister fails but clears opt-ins first', async () => {
    const input = dependencies();
    (input.notificationClient.disable as jest.Mock)
      .mockRejectedValueOnce(new Error('unregister failed'));
    const cleanup = createAccountSessionCleanup(input);

    await expect(cleanup.prepareForAccountDeletion('user-a')).resolves.toEqual({
      notificationUnregisterFailed: true,
    });
    expect(input.storage.clear).toHaveBeenCalled();
    expect(
      (input.storage.clear as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (input.notificationClient.disable as jest.Mock)
        .mock.invocationCallOrder[0],
    );
  });

  it('does not create or fetch an FCM token when the user never opted in', async () => {
    const input = dependencies(false);
    const cleanup = createAccountSessionCleanup(input);

    await cleanup.prepareForLogout('user-a', true);

    expect(input.notificationClient.disableForAccountExit).not.toHaveBeenCalled();
    expect(input.storage.clear).toHaveBeenCalled();
  });

  it('keeps a deletion-quiesced session blocked when logout cleanup fails', async () => {
    const input = dependencies();
    (input.notificationClient.disableForAccountExit as jest.Mock)
      .mockRejectedValueOnce(new Error('unregister failed'));
    const cleanup = createAccountSessionCleanup(input);

    await expect(cleanup.prepareForLogout('user-a', false)).rejects.toThrow(
      'unregister failed',
    );
    expect(input.backend.resumeSession).not.toHaveBeenCalled();
  });

  it('resumes safely when pre-delete local cleanup fails before the callable starts', async () => {
    const input = dependencies();
    (input.storage.clear as jest.Mock).mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    const cleanup = createAccountSessionCleanup(input);

    await expect(
      cleanup.prepareForAccountDeletion('user-a'),
    ).rejects.toThrow('storage unavailable');
    expect(input.backend.resumeSession).toHaveBeenCalledWith('user-a');
  });
});
