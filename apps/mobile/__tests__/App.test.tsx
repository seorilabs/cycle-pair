import AsyncStorage from '@react-native-async-storage/async-storage';
import { addEventListener as addNetworkListener } from '@react-native-community/netinfo';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, BackHandler } from 'react-native';
import App from '../App';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../src/domain/privacy/SensitiveHealthConsent';
import type { CyclePairBackend } from '../src/platform/backend/CyclePairBackend';
import { previewCyclePairBackend } from '../src/platform/backend/PreviewCyclePairBackend';

function installHardwareBackMock() {
  const handlers = new Set<
    Parameters<typeof BackHandler.addEventListener>[1]
  >();
  jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation((_event, handler) => {
      handlers.add(handler);
      return {
        remove: () => handlers.delete(handler),
      };
    });
  return {
    handlers,
    async press() {
      let handled = false;
      await act(async () => {
        for (const handler of Array.from(handlers).reverse()) {
          if (handler({ type: 'hardwareBackPress', timeStamp: Date.now() })) {
            handled = true;
            break;
          }
        }
      });
      return handled;
    },
  };
}

function deviceLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe('CyclePair mobile app', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the privacy-first onboarding on a fresh install', async () => {
    const view = await render(<App backend={previewCyclePairBackend} />);

    await waitFor(() => {
      expect(view.getByText('사이클 페어')).toBeTruthy();
      expect(view.getByText(/말하지 않아도/)).toBeTruthy();
      expect(view.getByText('건너뛰기')).toBeTruthy();
    });
    expect(addNetworkListener).toHaveBeenCalledTimes(1);
  });

  it('uses Android back to move through intro pages and cleans up listeners', async () => {
    const hardwareBack = installHardwareBackMock();
    const view = await render(<App backend={previewCyclePairBackend} />);
    await waitFor(() => expect(view.getByText(/말하지 않아도/)).toBeTruthy());

    await expect(hardwareBack.press()).resolves.toBe(false);

    await fireEvent.press(view.getByTestId('onboarding-next'));
    expect(view.getByText(/무엇을 보여줄지는/)).toBeTruthy();
    await expect(hardwareBack.press()).resolves.toBe(true);
    expect(view.getByText(/말하지 않아도/)).toBeTruthy();

    await fireEvent.press(view.getByTestId('onboarding-next'));
    await fireEvent.press(view.getByTestId('onboarding-next'));
    expect(view.getByText(/오늘 필요한 배려를/)).toBeTruthy();
    await expect(hardwareBack.press()).resolves.toBe(true);
    expect(view.getByText(/무엇을 보여줄지는/)).toBeTruthy();

    await fireEvent.press(view.getByText('건너뛰기'));
    expect(view.getByText('기본 설정')).toBeTruthy();
    await expect(hardwareBack.press()).resolves.toBe(true);
    expect(view.getByText(/말하지 않아도/)).toBeTruthy();

    await act(async () => {
      view.unmount();
    });
    expect(hardwareBack.handlers.size).toBe(0);
  });

  it('starts solo, opens optional pairing, and can leave it without losing the Pair', async () => {
    const hardwareBack = installHardwareBackMock();
    const saveShareSettings = jest.fn(async () => ({
      status: 'queued' as const,
      mutationId: 'test-share-settings',
    }));
    const backend = { ...previewCyclePairBackend, saveShareSettings };
    const view = await render(<App backend={backend} />);
    await waitFor(() => expect(view.getByText('건너뛰기')).toBeTruthy());

    await fireEvent.press(view.getByText('건너뛰기'));
    await fireEvent.press(view.getByText('내 주기는 기록하지 않아요'));
    await fireEvent.press(view.getByText('민감정보 처리 원칙을 확인했어요'));
    await fireEvent.press(view.getByText('저장하고 시작'));
    await waitFor(() => expect(view.getByText(/오늘 나의/)).toBeTruthy());
    expect(view.getByText('지금은 혼자 기록하고 있어요')).toBeTruthy();

    await fireEvent.press(view.getByText('함께'));
    await waitFor(() => expect(view.getByText('파트너 연결하기')).toBeTruthy());
    await fireEvent.press(view.getByText('파트너 연결하기'));
    await waitFor(() => expect(view.getByText('연결 상태 확인')).toBeTruthy());

    expect(view.getByText('닫기')).toBeTruthy();
    await expect(hardwareBack.press()).resolves.toBe(true);
    await waitFor(() => expect(view.getByText('파트너 연결하기')).toBeTruthy());

    await fireEvent.press(view.getByText('파트너 연결하기'));
    await waitFor(() => expect(view.getByText('연결 상태 확인')).toBeTruthy());
    await fireEvent.press(view.getByText('연결 상태 확인'));
    await waitFor(() => expect(view.getByText('추천 설정 적용')).toBeTruthy());
    await fireEvent.press(view.getByText('추천 설정 적용'));

    expect(view.getByText('이전')).toBeTruthy();
    await expect(hardwareBack.press()).resolves.toBe(true);
    await waitFor(() =>
      expect(view.getByText('파트너 연결 완료')).toBeTruthy(),
    );
    expect(view.getByText(/연결은 유지돼요/)).toBeTruthy();
    expect(saveShareSettings).not.toHaveBeenCalled();

    await fireEvent.press(view.getByText('닫기'));
    await waitFor(() =>
      expect(view.getByText('공유 설정 계속하기')).toBeTruthy(),
    );
    expect(saveShareSettings).not.toHaveBeenCalled();

    await fireEvent.press(view.getByText('설정'));
    await waitFor(() =>
      expect(view.getByText('공유 설정을 완료해 주세요')).toBeTruthy(),
    );
    expect(view.queryByText('구독')).toBeNull();
    expect(view.queryByText('현재 Free 플랜')).toBeNull();
    expect(view.queryByText('구매 복원')).toBeNull();
    expect(view.queryByText('현재 주기 국면')).toBeNull();
    await fireEvent.press(view.getByText('공유 설정 계속하기'));
    await waitFor(() => expect(view.getByText('추천 설정 적용')).toBeTruthy());
    await fireEvent.press(view.getByText('5개 항목 공유하고 시작'));
    await waitFor(() =>
      expect(
        view.getByText('오프라인 저장됨 · 연결되면 자동 동기화'),
      ).toBeTruthy(),
    );
    expect(saveShareSettings).toHaveBeenCalledTimes(1);
  });

  it('restores a saved private setup directly into solo main', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 3,
        onboardingComplete: true,
        neutralNotifications: true,
      }),
    );
    const savePrivateSetup = jest.fn(async () => ({
      status: 'synced' as const,
      mutationId: 'private-setup-current',
    }));
    const backend: CyclePairBackend = {
      ...previewCyclePairBackend,
      savePrivateSetup,
      async loadPrivateSetup() {
        return {
          recordsCycle: true,
          consentAcceptedAt: '2026-07-13T00:00:00.000Z',
          consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
          cycle: {
            asOfDate: '2026-07-14',
            averageCycleLength: 28,
            averagePeriodLength: 5,
            periodDates: { startDate: '2026-07-10' },
          },
        };
      },
    };

    const view = await render(<App backend={backend} />);

    await waitFor(() => expect(view.getByText(/천천히, 내 몸의/)).toBeTruthy());
    expect(view.getByText('지금은 혼자 기록하고 있어요')).toBeTruthy();
    expect(view.queryByText('연결 상태 확인')).toBeNull();
    await waitFor(() => expect(savePrivateSetup).toHaveBeenCalledTimes(1));
    expect(savePrivateSetup).toHaveBeenCalledWith(
      'preview-self',
      true,
      '2026-07-13T00:00:00.000Z',
      SENSITIVE_HEALTH_CONSENT_VERSION,
      expect.objectContaining({
        asOfDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it('does not hydrate Pair membership or events from device cache on startup', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: false,
        diagnosticsEnabled: false,
      }),
    );
    const loadCachedActivePair = jest.fn(async () => ({
      pairId: 'stale-pair',
      partnerUid: 'former-partner',
    }));
    const loadCachedPairEvents = jest.fn(async () => []);
    const watchActivePair = jest.fn(
      (
        _uid: string,
        onValue: Parameters<CyclePairBackend['watchActivePair']>[1],
      ) => {
        onValue(null);
        return () => undefined;
      },
    );
    const backend: CyclePairBackend = {
      ...previewCyclePairBackend,
      async loadPrivateSetup() {
        return {
          recordsCycle: false,
          consentAcceptedAt: '2026-07-13T00:00:00.000Z',
          consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
        };
      },
      loadCachedActivePair,
      loadCachedPairEvents,
      watchActivePair,
    };

    const view = await render(<App backend={backend} />);
    await waitFor(() => expect(watchActivePair).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(view.getByText('지금은 혼자 기록하고 있어요')).toBeTruthy(),
    );
    expect(loadCachedActivePair).not.toHaveBeenCalled();
    expect(loadCachedPairEvents).not.toHaveBeenCalled();
    expect(view.queryByText('공유 설정 계속하기')).toBeNull();
  });

  it('flushes the remaining offline queue immediately after tombstone cleanup', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: false,
        diagnosticsEnabled: false,
      }),
    );
    (addNetworkListener as jest.Mock).mockImplementationOnce(
      () => () => undefined,
    );
    const clearPendingPairMutations = jest.fn(async () => undefined);
    const acknowledgeCacheTombstone = jest.fn(async () => undefined);
    const flushPendingMutations = jest.fn(async () => ({
      flushed: 1,
      remaining: 0,
      failed: 0,
    }));
    const backend: CyclePairBackend = {
      ...previewCyclePairBackend,
      async loadPrivateSetup() {
        return {
          recordsCycle: false,
          consentAcceptedAt: '2026-07-13T00:00:00.000Z',
          consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
        };
      },
      clearPendingPairMutations,
      acknowledgeCacheTombstone,
      flushPendingMutations,
      watchPendingTombstones(_uid, onValue) {
        onValue([{ id: 'tombstone-1', pairId: 'revoked-pair' }]);
        return () => undefined;
      },
    };

    await render(<App backend={backend} />);

    await waitFor(() => expect(flushPendingMutations).toHaveBeenCalledTimes(1));
    expect(clearPendingPairMutations).toHaveBeenCalledWith(
      'preview-self',
      'revoked-pair',
    );
    expect(acknowledgeCacheTombstone).toHaveBeenCalledWith('tombstone-1');
    expect(
      clearPendingPairMutations.mock.invocationCallOrder[0],
    ).toBeLessThan(acknowledgeCacheTombstone.mock.invocationCallOrder[0]);
    expect(
      acknowledgeCacheTombstone.mock.invocationCallOrder[0],
    ).toBeLessThan(flushPendingMutations.mock.invocationCallOrder[0]);
  });

  it('hides a revoked Pair even when strict tombstone cleanup fails', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: false,
        diagnosticsEnabled: false,
      }),
    );
    let emitTombstones:
      | Parameters<CyclePairBackend['watchPendingTombstones']>[1]
      | undefined;
    const clearPendingPairMutations = jest.fn(async () => {
      throw new Error('Keychain unavailable');
    });
    const acknowledgeCacheTombstone = jest.fn(async () => undefined);
    const backend: CyclePairBackend = {
      ...previewCyclePairBackend,
      async loadPrivateSetup() {
        return {
          recordsCycle: false,
          consentAcceptedAt: '2026-07-13T00:00:00.000Z',
          consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
        };
      },
      clearPendingPairMutations,
      acknowledgeCacheTombstone,
      watchActivePair(_uid, onValue) {
        onValue({ pairId: 'revoked-pair', partnerUid: 'former-partner' });
        return () => undefined;
      },
      watchPendingTombstones(_uid, onValue) {
        emitTombstones = onValue;
        onValue([]);
        return () => undefined;
      },
    };
    const view = await render(<App backend={backend} />);
    await waitFor(() => expect(view.getByText('추천 설정 적용')).toBeTruthy());

    await act(async () => {
      emitTombstones?.([{ id: 'tombstone-race', pairId: 'revoked-pair' }]);
    });

    await waitFor(() =>
      expect(view.getByText('지금은 내 기록만 저장돼요')).toBeTruthy(),
    );
    expect(clearPendingPairMutations).toHaveBeenCalledWith(
      'preview-self',
      'revoked-pair',
    );
    expect(acknowledgeCacheTombstone).not.toHaveBeenCalled();
  });

  it('removes an existing notification registration when OS permission is denied', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: true,
      }),
    );
    const notificationClient = {
      enable: jest.fn(async () => 'denied' as const),
      disable: jest.fn(async () => undefined),
      disableForAccountExit: jest.fn(async () => undefined),
      watchTokenRefresh: jest.fn(() => jest.fn()),
      watchOpened: jest.fn(() => jest.fn()),
    };

    await render(
      <App
        backend={previewCyclePairBackend}
        notificationClient={notificationClient}
      />,
    );

    await waitFor(() => expect(notificationClient.enable).toHaveBeenCalled());
    await waitFor(() => expect(notificationClient.disable).toHaveBeenCalled());
    expect(notificationClient.watchTokenRefresh).not.toHaveBeenCalled();
  });

  it('subscribes to token refresh only after notification authorization', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: true,
      }),
    );
    let resolvePermission: ((value: 'authorized') => void) | undefined;
    const notificationClient = {
      enable: jest.fn(
        () => new Promise<'authorized'>(resolve => {
          resolvePermission = resolve;
        }),
      ),
      disable: jest.fn(async () => undefined),
      disableForAccountExit: jest.fn(async () => undefined),
      watchTokenRefresh: jest.fn(() => jest.fn()),
      watchOpened: jest.fn(() => jest.fn()),
    };

    await render(
      <App
        backend={previewCyclePairBackend}
        notificationClient={notificationClient}
      />,
    );
    await waitFor(() => expect(notificationClient.enable).toHaveBeenCalled());
    expect(notificationClient.watchTokenRefresh).not.toHaveBeenCalled();

    await act(async () => {
      resolvePermission?.('authorized');
    });
    await waitFor(() =>
      expect(notificationClient.watchTokenRefresh).toHaveBeenCalledTimes(1),
    );
  });

  it('completes the MVP setup and records a daily check-in', async () => {
    const savePrivateSetup = jest.fn(async () => ({
      status: 'queued' as const,
      mutationId: 'private-setup-current',
    }));
    const backend = { ...previewCyclePairBackend, savePrivateSetup };
    const view = await render(<App backend={backend} />);
    await waitFor(() => expect(view.getByText('건너뛰기')).toBeTruthy());

    await fireEvent.press(view.getByText('건너뛰기'));
    const persistedBeforeConsent = String(
      (AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)?.[1] ?? '',
    );
    expect(persistedBeforeConsent).not.toContain('lastPeriodStart');
    expect(persistedBeforeConsent).not.toContain('checkIn');
    await fireEvent.press(view.getByText('민감정보 처리 원칙을 확인했어요'));
    await fireEvent.press(view.getByText('저장하고 시작'));

    await waitFor(() => expect(view.getByText(/천천히, 내 몸의/)).toBeTruthy());
    expect(view.getByText('지금은 혼자 기록하고 있어요')).toBeTruthy();
    expect(view.getByText('예측 기준 없음')).toBeTruthy();
    expect(
      view.getByText('오프라인 저장됨 · 연결되면 자동 동기화'),
    ).toBeTruthy();
    expect(savePrivateSetup).toHaveBeenCalledWith(
      'preview-self',
      true,
      expect.any(String),
      SENSITIVE_HEALTH_CONSENT_VERSION,
      undefined,
    );
    await fireEvent.press(view.getByText('기록하기'));
    expect(
      view.getByText(
        '새 주기 시작일로 기록해요 · 예측 기준은 설정에서 켤 수 있어요',
      ),
    ).toBeTruthy();
    await fireEvent.press(view.getByText('괜찮아요'));
    await fireEvent.press(view.getByText('피로'));
    await fireEvent.press(view.getByText('그냥 들어줘요'));
    await fireEvent.press(view.getByText('안전하게 저장하기'));

    await waitFor(() =>
      expect(view.getByText('오늘 기록을 남겼어요')).toBeTruthy(),
    );
    expect(view.queryByText('Powered by React Native')).toBeNull();

    for (const call of (AsyncStorage.setItem as jest.Mock).mock.calls) {
      const storedValue = String(call[1] ?? '');
      expect(storedValue).not.toContain('isLogger');
      expect(storedValue).not.toContain('shareSettings');
      expect(storedValue).not.toContain('sensitiveDataConsentAcceptedAt');
      expect(storedValue).not.toContain('lastPeriodStart');
      expect(storedValue).not.toContain('checkIn');
    }
  });

  it('캘린더에서 확인한 내 기록을 재확인 후 삭제한다', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: false,
        diagnosticsEnabled: false,
      }),
    );
    const today = deviceLocalDate();
    const deleteDailyLog = jest.fn(async () => ({
      status: 'synced' as const,
      mutationId: 'daily-delete-test',
    }));
    const backend: CyclePairBackend = {
      ...previewCyclePairBackend,
      async loadPrivateSetup() {
        return {
          recordsCycle: false,
          consentAcceptedAt: '2026-07-13T00:00:00.000Z',
          consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
        };
      },
      async listDailyLogs() {
        return [
          {
            localDate: today,
            record: {moodTag: 'good', note: '삭제할 기록'},
          },
        ];
      },
      deleteDailyLog,
    };
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find(button => button.style === 'destructive')?.onPress?.();
    });
    const view = await render(<App backend={backend} />);

    await waitFor(() => expect(view.getByText(/오늘 나의/)).toBeTruthy());
    await fireEvent.press(view.getByLabelText('달력'));
    await waitFor(() => expect(view.getByText('삭제할 기록')).toBeTruthy());
    await fireEvent.press(view.getByText('기록 삭제'));

    await waitFor(() =>
      expect(deleteDailyLog).toHaveBeenCalledWith(
        'preview-self',
        today,
        expect.stringMatching(/^daily-delete-/),
      ),
    );
    await waitFor(() =>
      expect(view.getByText('이 날짜에 저장된 내 기록이 없어요.')).toBeTruthy(),
    );
  });
});
