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

function deviceLocalDateOffset(offset: number): string {
  const now = new Date();
  now.setDate(now.getDate() + offset);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function deviceLocalDate(): string {
  return deviceLocalDateOffset(0);
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
    expect(view.getByText('시작 설정')).toBeTruthy();
    expect(view.getByText(/어떤 기록을/)).toBeTruthy();
    expect(view.getByText('기록 방식')).toBeTruthy();
    expect(view.getByText('다음 생리 예상')).toBeTruthy();
    expect(view.getByText('주기·컨디션 정보 이용에 동의해요')).toBeTruthy();
    expect(view.queryByText(/동의 버전/)).toBeNull();
    await fireEvent(
      view.getByLabelText('다음 생리일 미리 보기'),
      'valueChange',
      true,
    );
    expect(view.getByTestId('last-period-start-date-picker')).toBeTruthy();
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
    await fireEvent.press(view.getByText('컨디션만 기록'));
    await fireEvent.press(view.getByText('주기·컨디션 정보 이용에 동의해요'));
    await fireEvent.press(view.getByText('저장하고 시작'));
    await waitFor(() => expect(view.getByText(/오늘 나의/)).toBeTruthy());
    expect(view.getByText('지금은 혼자 기록하고 있어요')).toBeTruthy();
    expect(view.queryByText('사용하지 않음')).toBeNull();
    expect(view.queryByText('나의 주기')).toBeNull();

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
    await waitFor(() => expect(view.getByText('공유 범위')).toBeTruthy());
    await fireEvent.press(view.getByText('공유 범위'));
    await waitFor(() =>
      expect(view.getByText('공유 설정을 완료해 주세요')).toBeTruthy(),
    );
    expect(view.getByText('구독')).toBeTruthy();
    expect(view.queryByText('현재 Free 플랜')).toBeNull();
    expect(view.queryByText('구매 복원')).toBeNull();
    expect(view.queryByText('현재 주기 국면')).toBeNull();
    await fireEvent.press(view.getByText('공유 설정 계속하기'));
    await waitFor(() => expect(view.getByText('추천 설정 적용')).toBeTruthy());
    await fireEvent.press(view.getByText('7개 항목 공유하고 시작'));
    await waitFor(() => expect(view.getByText('오프라인 저장')).toBeTruthy());
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

  it('원격 증분 동기화를 기다리지 않고 암호화 캐시 기록을 먼저 복원한다', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: false,
        diagnosticsEnabled: false,
      }),
    );
    let resolveDailyLogs:
      | ((
          value: Awaited<ReturnType<CyclePairBackend['syncDailyLogs']>>,
        ) => void)
      | undefined;
    const syncDailyLogs = jest.fn(
      () =>
        new Promise<Awaited<ReturnType<CyclePairBackend['syncDailyLogs']>>>(
          resolve => {
            resolveDailyLogs = resolve;
          },
        ),
    );
    const backend: CyclePairBackend = {
      ...previewCyclePairBackend,
      async loadPrivateSetup() {
        return {
          recordsCycle: false,
          consentAcceptedAt: '2026-08-09T00:00:00.000Z',
          consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
        };
      },
      async loadCachedDailyLogs() {
        return [
          {
            localDate: deviceLocalDate(),
            record: {moodTag: 'good', note: '캐시에서 즉시 복원'},
          },
        ];
      },
      syncDailyLogs,
    };

    const view = await render(<App backend={backend} />);

    await waitFor(() => expect(view.getByText(/오늘 나의/)).toBeTruthy());
    expect(syncDailyLogs).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByLabelText('달력'));
    await waitFor(() => expect(view.getByText('캐시에서 즉시 복원')).toBeTruthy());

    await act(async () => {
      resolveDailyLogs?.([
        {
          localDate: deviceLocalDate(),
          record: { moodTag: 'good', note: '원격 증분 복원' },
        },
      ]);
    });
    await waitFor(() => expect(view.getByText('원격 증분 복원')).toBeTruthy());
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
    expect(clearPendingPairMutations.mock.invocationCallOrder[0]).toBeLessThan(
      acknowledgeCacheTombstone.mock.invocationCallOrder[0],
    );
    expect(acknowledgeCacheTombstone.mock.invocationCallOrder[0]).toBeLessThan(
      flushPendingMutations.mock.invocationCallOrder[0],
    );
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
      expect(view.getByText('한 사람과 선택적으로 공유')).toBeTruthy(),
    );
    expect(view.queryByText('지금은 내 기록만 저장돼요')).toBeNull();
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
        () =>
          new Promise<'authorized'>(resolve => {
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
    await fireEvent.press(view.getByText('주기·컨디션 정보 이용에 동의해요'));
    await fireEvent.press(view.getByText('저장하고 시작'));

    await waitFor(() => expect(view.getByText(/천천히, 내 몸의/)).toBeTruthy());
    expect(view.getByText('지금은 혼자 기록하고 있어요')).toBeTruthy();
    expect(view.getByText('다음 생리 예상 꺼짐')).toBeTruthy();
    expect(view.getByText('오프라인 저장')).toBeTruthy();
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
        '새 주기 시작일로 저장해요. 다음 생리 예상은 설정에서 켤 수 있어요',
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
      async loadCachedDailyLogs() {
        return [
          {
            localDate: today,
            record: { moodTag: 'good', note: '삭제할 기록' },
          },
        ];
      },
      async syncDailyLogs() {
        return [
          {
            localDate: today,
            record: { moodTag: 'good', note: '삭제할 기록' },
          },
        ];
      },
      deleteDailyLog,
    };
    jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons) => {
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
    await waitFor(() => expect(view.queryByText('삭제할 기록')).toBeNull());
    expect(view.queryByText('내 컨디션 기록')).toBeNull();
  });

  it('설정 아코디언은 하나만 열고 닫힌 주기·조용한 시간 초안을 되돌린다', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: true,
        notificationQuietHours: { start: '22:00', end: '08:00' },
        diagnosticsEnabled: false,
      }),
    );
    const backend: CyclePairBackend = {
      ...previewCyclePairBackend,
      async loadPrivateSetup() {
        return {
          recordsCycle: true,
          consentAcceptedAt: '2026-08-14T00:00:00.000Z',
          consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
          cycle: {
            asOfDate: deviceLocalDate(),
            averageCycleLength: 28,
            averagePeriodLength: 5,
            periodDates: { startDate: '2026-08-01' },
          },
        };
      },
    };
    const notificationClient = {
      enable: jest.fn(async () => 'authorized' as const),
      disable: jest.fn(async () => undefined),
      disableForAccountExit: jest.fn(async () => undefined),
      watchTokenRefresh: jest.fn(() => jest.fn()),
      watchOpened: jest.fn(() => jest.fn()),
    };
    const view = await render(
      <App backend={backend} notificationClient={notificationClient} />,
    );

    await waitFor(() => expect(view.getByText(/천천히, 내 몸의/)).toBeTruthy());
    await fireEvent.press(view.getByLabelText('설정'));
    expect(view.queryByLabelText('최근 생리 시작일')).toBeNull();
    expect(view.queryByLabelText('조용한 시간 시작')).toBeNull();

    await fireEvent.press(view.getByText('내 주기'));
    await fireEvent.press(view.getByText('수정'));
    await fireEvent.changeText(
      view.getByLabelText('최근 생리 시작일'),
      '2026-08-02',
    );
    await fireEvent.press(view.getByText('알림과 개인정보'));
    expect(view.queryByLabelText('최근 생리 시작일')).toBeNull();
    await fireEvent.changeText(
      view.getByLabelText('조용한 시간 시작'),
      '21:30',
    );

    await fireEvent.press(view.getByText('앱 안내'));
    expect(view.queryByLabelText('조용한 시간 시작')).toBeNull();
    await fireEvent.press(view.getByText('내 주기'));
    await fireEvent.press(view.getByText('수정'));
    expect(view.getByLabelText('최근 생리 시작일').props.value).toBe(
      '2026-08-01',
    );

    await fireEvent.press(view.getByText('알림과 개인정보'));
    expect(view.getByLabelText('조용한 시간 시작').props.value).toBe('22:00');
  });

  it('초기 동기화는 알리지 않고 상대의 새 공유 기록은 메시지 박스와 토스트로 알린다', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: false,
        diagnosticsEnabled: false,
      }),
    );
    let emitProjection:
      | Parameters<CyclePairBackend['watchPartnerProjection']>[1]
      | undefined;
    let emitNudge:
      | Parameters<CyclePairBackend['watchPartnerNudgeState']>[2]
      | undefined;
    const sendPartnerNudge = jest.fn(
      async (
        _uid: string,
        _pairId: string,
        type: 'check-in-request' | 'care-acknowledgement',
        requestId: string,
      ) => ({
        requestId,
        type,
        sentAt: new Date().toISOString(),
        nextAllowedAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        alreadyApplied: false,
      }),
    );
    const acknowledgePartnerNudge = jest.fn(async () => true);
    const initialProjection = {
      ownerUid: 'partner-a',
      pairId: 'pair-a',
      generatedAt: '2026-08-24T00:00:00.000Z',
      cycleAsOfDate: deviceLocalDate(),
      dailyLogDate: deviceLocalDate(),
      cyclePhase: 'ovulatory',
      cycleStatus: 'fertile-window',
      moodTag: 'neutral',
    } as const;
    const backend: CyclePairBackend = {
      ...previewCyclePairBackend,
      async loadPrivateSetup() {
        return {
          recordsCycle: false,
          consentAcceptedAt: '2026-08-14T00:00:00.000Z',
          consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
        };
      },
      watchActivePair(_uid, onValue) {
        onValue({ pairId: 'pair-a', partnerUid: 'partner-a' });
        return () => undefined;
      },
      watchPartnerProjection(_membership, onValue) {
        emitProjection = onValue;
        onValue(initialProjection);
        return () => undefined;
      },
      watchShareSettings(_uid, _pairId, onValue) {
        onValue({
          cyclePhase: false,
          fertilityStatus: true,
          nextPeriodWindow: false,
          periodDates: false,
          moodTag: true,
          symptomTags: false,
          energyLevel: false,
          conditionCode: false,
          carePreferences: false,
          note: false,
        });
        return () => undefined;
      },
      watchPairEvents(_membership, onValue) {
        onValue([
          {
            id: 'today-event',
            title: '오늘 함께 산책',
            date: deviceLocalDate(),
            pairId: 'pair-a',
            createdBy: 'preview-self',
            updatedBy: 'preview-self',
            mutationId: 'today-event-mutation',
          },
          {
            id: 'tomorrow-event',
            title: '내일 병원 일정',
            date: deviceLocalDateOffset(1),
            pairId: 'pair-a',
            createdBy: 'partner-a',
            updatedBy: 'partner-a',
            mutationId: 'tomorrow-event-mutation',
          },
        ]);
        return () => undefined;
      },
      watchPartnerNudgeState(_uid, _membership, onValue) {
        emitNudge = onValue;
        onValue({ received: null, nextAllowedAt: {} });
        return () => undefined;
      },
      sendPartnerNudge,
      acknowledgePartnerNudge,
    };
    const view = await render(<App backend={backend} />);

    await waitFor(() => expect(view.getByText(/함께, 상대의/)).toBeTruthy());
    expect(view.getByText(/함께, 상대의/).props.numberOfLines).toBe(1);
    expect(view.queryByText(/주기 예측과 케어 힌트는/)).toBeNull();
    expect(view.getByText('가임 가능성이 높은 시기예요')).toBeTruthy();
    expect(view.getByText('오늘의 컨디션')).toBeTruthy();
    expect(view.queryByText('사용하지 않음')).toBeNull();
    expect(view.queryByText('새 소식 1개')).toBeNull();
    const homeTree = JSON.stringify(view.toJSON());
    expect(homeTree.indexOf('파트너 님의 오늘')).toBeLessThan(
      homeTree.indexOf('오늘의 체크인'),
    );
    expect(view.getByLabelText('오늘 어때요?')).toBeTruthy();
    expect(view.getByLabelText('확인했어요, 챙겨볼게요')).toBeTruthy();

    await act(async () => {
      emitNudge?.({
        received: {
          requestId: 'nudge-care-1',
          pairId: 'pair-a',
          senderUid: 'partner-a',
          recipientUid: 'preview-self',
          type: 'care-acknowledgement',
          sentAt: '2026-08-24T00:00:00.000Z',
        },
        nextAllowedAt: {},
      });
    });
    await waitFor(() =>
      expect(
        view.getByText('파트너가 “확인했어요, 챙겨볼게요”라고 전했어요.'),
      ).toBeTruthy(),
    );
    await fireEvent.press(view.getByText('확인'));
    await waitFor(() =>
      expect(acknowledgePartnerNudge).toHaveBeenCalledWith(
        'pair-a',
        'nudge-care-1',
      ),
    );

    await fireEvent.press(view.getByLabelText('오늘 어때요?'));
    await waitFor(() =>
      expect(sendPartnerNudge).toHaveBeenCalledWith(
        'preview-self',
        'pair-a',
        'check-in-request',
        expect.stringMatching(/^nudge-/),
      ),
    );
    expect(view.getByText('파트너에게 넛지를 남겼어요.')).toBeTruthy();
    expect(
      view.getByLabelText('오늘 어때요?').props.accessibilityState.disabled,
    ).toBe(true);

    await fireEvent.press(view.getByLabelText('달력'));
    await waitFor(() => expect(view.getByText('오늘 함께 산책')).toBeTruthy());
    expect(view.queryByText(/가임 가능 시기와 생리 예상 범위는/)).toBeNull();
    await fireEvent.press(
      view.getByLabelText(new RegExp(`^${deviceLocalDateOffset(1)},`)),
    );
    await waitFor(() => expect(view.getByText('내일 병원 일정')).toBeTruthy());
    expect(view.queryByText('오늘 함께 산책')).toBeNull();
    await fireEvent.press(view.getByLabelText('오늘'));

    await act(async () => {
      emitProjection?.({
        ...initialProjection,
        generatedAt: '2026-08-24T00:01:00.000Z',
        moodTag: 'good',
      });
    });

    await waitFor(() =>
      expect(view.getAllByText('파트너가 새 기록을 공유했어요.')).toHaveLength(
        2,
      ),
    );
    expect(view.getByText('새 소식 1개')).toBeTruthy();

    await fireEvent.press(
      view.getByLabelText(
        '새 소식 1개. 파트너가 새 기록을 공유했어요. 확인하기',
      ),
    );
    await waitFor(() =>
      expect(view.getByText('파트너 님의 오늘')).toBeTruthy(),
    );
    expect(view.queryByText('새 소식 1개')).toBeNull();
    expect(view.queryByText('오래된 공유 정보예요')).toBeNull();
    expect(view.queryByText('직접 필요한 것을 물어봐 주세요')).toBeNull();
    expect(view.queryByText('오늘의 케어 힌트')).toBeNull();
    expect(view.queryByText('오늘 챙겨볼게요')).toBeNull();
    expect(
      view.queryByText('보이지 않는 정보가 있는 것이 정상이에요'),
    ).toBeNull();
  });
});
