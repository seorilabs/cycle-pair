import AsyncStorage from '@react-native-async-storage/async-storage';
import { addEventListener as addNetworkListener } from '@react-native-community/netinfo';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, BackHandler } from 'react-native';
import App from '../App';
import { SENSITIVE_HEALTH_CONSENT_VERSION } from '../src/domain/privacy/SensitiveHealthConsent';
import type { CyclePairBackend } from '../src/platform/backend/CyclePairBackend';
import { previewCyclePairBackend } from '../src/platform/backend/PreviewCyclePairBackend';
import { createPlatformPresenceClient } from '../src/platform/presence/PlatformPresenceClient';

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
      expect(view.getByText(/∞ 사이클 페어/)).toBeTruthy();
      expect(view.getByText('내 기록, 내가 정하는 공유')).toBeTruthy();
      expect(view.getByText('시작하기')).toBeTruthy();
    });
    expect(addNetworkListener).toHaveBeenCalledTimes(1);
  });

  it('Presence Edge가 죽어 있어도 온보딩과 첫 진입이 그대로 뜬다', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND edge.vzyx.xyz');
    });
    const presenceClient = createPlatformPresenceClient({
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const view = await render(
      <App backend={previewCyclePairBackend} presenceClient={presenceClient} />,
    );

    await waitFor(() => {
      expect(view.getByText(/∞ 사이클 페어/)).toBeTruthy();
      expect(view.getByText('시작하기')).toBeTruthy();
    });
    fireEvent.press(view.getByText('시작하기'));
    await waitFor(() => {
      expect(view.queryByText('시작하기')).toBeNull();
    });

    // heartbeat는 시도됐고, 그 실패가 화면 흐름을 막지 않았다.
    expect(fetchImpl).toHaveBeenCalled();
    presenceClient.stop();
  });

  it('첫 안내 한 화면에서 설정으로 이동하고 Android 뒤로가기를 정리한다', async () => {
    const hardwareBack = installHardwareBackMock();
    const view = await render(<App backend={previewCyclePairBackend} />);
    await waitFor(() =>
      expect(view.getByText('내 기록, 내가 정하는 공유')).toBeTruthy(),
    );
    expect(view.getByText('예시')).toBeTruthy();
    expect(view.queryByText('건너뛰기')).toBeNull();
    await expect(hardwareBack.press()).resolves.toBe(false);
    await fireEvent.press(view.getByTestId('onboarding-next'));
    expect(view.getByText('시작 설정')).toBeTruthy();
    expect(view.getByText('주기·컨디션 정보 이용에 동의해요')).toBeTruthy();
    await fireEvent(
      view.getByLabelText('다음 생리일 미리 보기'),
      'valueChange',
      true,
    );
    expect(view.getByTestId('last-period-start-date-picker')).toBeTruthy();
    await expect(hardwareBack.press()).resolves.toBe(true);
    expect(view.getByText('내 기록, 내가 정하는 공유')).toBeTruthy();
    await act(async () => {
      view.unmount();
    });
    expect(hardwareBack.handlers.size).toBe(0);
  });

  it('혼자 시작하고 초대에서 돌아와도 연결을 보존하며 선택한 항목만 저장한다', async () => {
    const hardwareBack = installHardwareBackMock();
    const saveShareSettings = jest.fn(
      async (_uid: string, _pairId: string, _settings: unknown) => ({
        status: 'queued' as const,
        mutationId: 'test-share-settings',
      }),
    );
    const backend = { ...previewCyclePairBackend, saveShareSettings };
    const view = await render(<App backend={backend} />);
    await waitFor(() => expect(view.getByText('시작하기')).toBeTruthy());
    await fireEvent.press(view.getByText('시작하기'));
    await fireEvent.press(view.getByText('컨디션만 기록'));
    await fireEvent.press(view.getByText('주기·컨디션 정보 이용에 동의해요'));
    await fireEvent.press(view.getByText('저장하고 시작'));
    await waitFor(() => expect(view.getByText('나의 오늘')).toBeTruthy());
    expect(view.getByText('혼자 기록 중')).toBeTruthy();
    expect(view.queryByText('나의 주기')).toBeNull();
    await fireEvent.press(view.getByLabelText('파트너'));
    await fireEvent.press(view.getByText('파트너 연결'));
    expect(view.getByText('초대 보내기')).toBeTruthy();
    expect(view.getByText('초대 받기')).toBeTruthy();
    await expect(hardwareBack.press()).resolves.toBe(true);
    await fireEvent.press(view.getByText('파트너 연결'));
    await fireEvent.press(view.getByText('초대 보내기'));
    await fireEvent.press(view.getByText('연결하기'));
    await waitFor(() =>
      expect(view.getByText('공유 항목을 선택하지 않았어요')).toBeTruthy(),
    );
    expect(saveShareSettings).not.toHaveBeenCalled();
    await expect(hardwareBack.press()).resolves.toBe(true);
    await waitFor(() => expect(view.getByText('연결됨')).toBeTruthy());
    await fireEvent.press(view.getByText('닫기'));
    await fireEvent.press(view.getByLabelText('설정'));
    expect(view.queryByText('구독')).toBeNull();
    expect(view.queryByText('구매 복원')).toBeNull();
    await fireEvent.press(view.getByText('공유 범위'));
    await fireEvent.press(view.getByText('공유 항목 선택'));
    await fireEvent(view.getByLabelText('지금 마음'), 'valueChange', true);
    await fireEvent.press(view.getByText('공유 설정 저장'));
    await waitFor(() => expect(saveShareSettings).toHaveBeenCalledTimes(1));
    expect(saveShareSettings.mock.calls[0]?.[2]).toMatchObject({
      emotionTags: true,
      symptomTags: false,
      note: false,
    });
  });

  it('AC-B2: 설정에서 이전 화면을 다녀와도 미저장 입력을 보존한다', async () => {
    const hardwareBack = installHardwareBackMock();
    const savePrivateSetup = jest.fn(previewCyclePairBackend.savePrivateSetup);
    const view = await render(
      <App backend={{ ...previewCyclePairBackend, savePrivateSetup }} />,
    );
    await waitFor(() =>
      expect(view.getByTestId('onboarding-next')).toBeTruthy(),
    );
    await fireEvent.press(view.getByTestId('onboarding-next'));
    await fireEvent(
      view.getByLabelText('다음 생리일 미리 보기'),
      'valueChange',
      true,
    );
    const selectedDate = new Date();
    selectedDate.setDate(selectedDate.getDate() - 6);
    selectedDate.setHours(12, 0, 0, 0);
    await fireEvent(
      view.getByTestId('last-period-start-date-picker'),
      'change',
      {
        nativeEvent: { timestamp: selectedDate.getTime() },
      },
    );
    await fireEvent.press(view.getByLabelText('다음 생리까지 보통 늘리기'));
    await fireEvent.press(view.getByLabelText('생리가 보통 늘리기'));
    await fireEvent.press(view.getByTestId('setup-consent'));
    await fireEvent.press(view.getByText('이전'));
    await fireEvent.press(view.getByTestId('onboarding-next'));
    expect(view.getByLabelText('다음 생리일 미리 보기').props.value).toBe(true);
    expect(view.getByTestId('last-period-start-date-picker').props.date).toBe(
      selectedDate.getTime(),
    );
    expect(view.getByText('29일')).toBeTruthy();
    expect(view.getByText('6일')).toBeTruthy();
    expect(
      view.getByTestId('setup-consent').props.accessibilityState.checked,
    ).toBe(true);
    await fireEvent.press(view.getByText('컨디션만 기록'));
    await expect(hardwareBack.press()).resolves.toBe(true);
    await fireEvent.press(view.getByTestId('onboarding-next'));
    expect(view.getAllByRole('radio')[1].props.accessibilityState.checked).toBe(
      true,
    );
    expect(savePrivateSetup).not.toHaveBeenCalled();
    await fireEvent.press(view.getByTestId('setup-save'));
    await waitFor(() =>
      expect(savePrivateSetup).toHaveBeenCalledWith(
        'preview-self',
        false,
        expect.any(String),
        SENSITIVE_HEALTH_CONSENT_VERSION,
        undefined,
      ),
    );
  });

  it('AC-B4: 앱 트리가 종료되면 미저장 설정 초안을 새 실행에 넘기지 않는다', async () => {
    const view = await render(<App backend={previewCyclePairBackend} />);
    await waitFor(() =>
      expect(view.getByTestId('onboarding-next')).toBeTruthy(),
    );
    await fireEvent.press(view.getByTestId('onboarding-next'));
    await fireEvent.press(view.getByText('컨디션만 기록'));
    await fireEvent.press(view.getByTestId('setup-consent'));
    await act(async () => view.unmount());
    const reopened = await render(<App backend={previewCyclePairBackend} />);
    await waitFor(() => expect(reopened.getByText('시작 설정')).toBeTruthy());
    expect(
      reopened.getAllByRole('radio')[0].props.accessibilityState.checked,
    ).toBe(true);
    expect(
      reopened.getByTestId('setup-consent').props.accessibilityState.checked,
    ).toBe(false);
  });

  it('AC-B1: 저장 중 시스템 이전을 차단하고 실패한 초안을 유지한다', async () => {
    const hardwareBack = installHardwareBackMock();
    let rejectSave: ((error: Error) => void) | undefined;
    const saveDailyLog = jest.fn(
      () =>
        new Promise<Awaited<ReturnType<CyclePairBackend['saveDailyLog']>>>(
          (_resolve, reject) => {
            rejectSave = reject;
          },
        ),
    );
    const backend: CyclePairBackend = {
      ...previewCyclePairBackend,
      loadCachedDailyLogs: async () => [],
      syncDailyLogs: async () => [],
      saveDailyLog,
    };
    const view = await render(<App backend={backend} />);
    await waitFor(() =>
      expect(view.getByTestId('onboarding-next')).toBeTruthy(),
    );
    await fireEvent.press(view.getByTestId('onboarding-next'));
    await fireEvent.press(view.getByText('컨디션만 기록'));
    await fireEvent.press(view.getByTestId('setup-consent'));
    await fireEvent.press(view.getByTestId('setup-save'));
    await waitFor(() => expect(view.getByTestId('home-record')).toBeTruthy());
    await fireEvent.press(view.getByTestId('home-record'));
    await fireEvent.press(view.getByTestId('record-details'));
    await fireEvent.changeText(
      view.getByTestId('record-note'),
      '저장 실패 후에도 유지할 시험 메모',
    );
    await fireEvent.press(view.getByTestId('record-save'));
    await waitFor(() => expect(saveDailyLog).toHaveBeenCalledTimes(1));
    try {
      await expect(hardwareBack.press()).resolves.toBe(true);
      expect(
        view.getByTestId('record-save').props.accessibilityState.disabled,
      ).toBe(true);
      expect(
        view.getByRole('button', { name: '취소' }).props.accessibilityState
          .disabled,
      ).toBe(true);
    } finally {
      await act(async () => rejectSave?.(new Error('test-save-failed')));
    }
    await waitFor(() =>
      expect(
        view.getByTestId('record-save').props.accessibilityState.disabled,
      ).toBe(false),
    );
    await expect(hardwareBack.press()).resolves.toBe(true);
    await fireEvent.press(view.getByTestId('home-record'));
    await fireEvent.press(view.getByTestId('record-details'));
    expect(view.getByTestId('record-note').props.value).toBe(
      '저장 실패 후에도 유지할 시험 메모',
    );
    expect(saveDailyLog).toHaveBeenCalledTimes(1);
  });

  it.each(['초대 보내기', '초대 받기'])(
    'AC-B3: %s에서 시스템 이전은 방향 선택으로 돌아간다',
    async direction => {
      const hardwareBack = installHardwareBackMock();
      const view = await render(<App backend={previewCyclePairBackend} />);
      await waitFor(() =>
        expect(view.getByTestId('onboarding-next')).toBeTruthy(),
      );
      await fireEvent.press(view.getByTestId('onboarding-next'));
      await fireEvent.press(view.getByText('컨디션만 기록'));
      await fireEvent.press(view.getByTestId('setup-consent'));
      await fireEvent.press(view.getByTestId('setup-save'));
      await waitFor(() => expect(view.getByLabelText('파트너')).toBeTruthy());
      await fireEvent.press(view.getByLabelText('파트너'));
      await fireEvent.press(view.getByText('파트너 연결'));
      await fireEvent.press(view.getByText(direction));
      await expect(hardwareBack.press()).resolves.toBe(true);
      expect(view.getByText('초대 보내기')).toBeTruthy();
      expect(view.getByText('초대 받기')).toBeTruthy();
      expect(view.queryByText('연결하기')).toBeNull();
      await expect(hardwareBack.press()).resolves.toBe(true);
      expect(view.getByText('파트너 연결')).toBeTruthy();
    },
  );

  it('AC-B3: 받은 초대 코드는 하위 단계 이전에서 유지하고 전체 종료 시 버린다', async () => {
    const hardwareBack = installHardwareBackMock();
    const backend: CyclePairBackend = {
      ...previewCyclePairBackend,
      kind: 'firebase',
    };
    const view = await render(<App backend={backend} />);
    await waitFor(() =>
      expect(view.getByTestId('onboarding-next')).toBeTruthy(),
    );
    await fireEvent.press(view.getByTestId('onboarding-next'));
    await fireEvent.press(view.getByText('컨디션만 기록'));
    await fireEvent.press(view.getByTestId('setup-consent'));
    await fireEvent.press(view.getByTestId('setup-save'));
    await waitFor(() => expect(view.getByLabelText('파트너')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('파트너'));
    await fireEvent.press(view.getByText('파트너 연결'));
    await fireEvent.press(view.getByText('초대 받기'));
    await fireEvent.changeText(
      view.getByTestId('invite-input'),
      'synthetic-invite-code',
    );
    await expect(hardwareBack.press()).resolves.toBe(true);
    await fireEvent.press(view.getByText('초대 받기'));
    expect(view.getByTestId('invite-input').props.value).toBe(
      'synthetic-invite-code',
    );
    await fireEvent.press(view.getByText('뒤로'));
    await fireEvent.press(view.getByText('초대 받기'));
    expect(view.getByTestId('invite-input').props.value).toBe(
      'synthetic-invite-code',
    );
    await fireEvent.press(view.getByText('닫기'));
    await fireEvent.press(view.getByText('파트너 연결'));
    await fireEvent.press(view.getByText('초대 받기'));
    expect(view.getByTestId('invite-input').props.value).toBe('');
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

    await waitFor(() => expect(view.getByText('나의 오늘')).toBeTruthy());
    expect(view.getByText('혼자 기록 중')).toBeTruthy();
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
            record: { emotionTags: ['anxious'], note: '캐시에서 즉시 복원' },
          },
        ];
      },
      syncDailyLogs,
    };

    const view = await render(<App backend={backend} />);

    await waitFor(() => expect(view.getByText('나의 오늘')).toBeTruthy());
    expect(syncDailyLogs).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByLabelText('달력'));
    await fireEvent.press(view.getByText('기록 보기'));
    await waitFor(() =>
      expect(view.getByText('캐시에서 즉시 복원')).toBeTruthy(),
    );

    await act(async () => {
      resolveDailyLogs?.([
        {
          localDate: deviceLocalDate(),
          record: { emotionTags: ['anxious'], note: '원격 증분 복원' },
        },
      ]);
    });
    await waitFor(() => expect(view.getByText('원격 증분 복원')).toBeTruthy());
  });

  it('keeps record editing closed until the existing daily cache has restored', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: false,
        diagnosticsEnabled: false,
      }),
    );
    let restoreCache:
      | ((
          logs: Awaited<ReturnType<CyclePairBackend['loadCachedDailyLogs']>>,
        ) => void)
      | undefined;
    const backend: CyclePairBackend = {
      ...previewCyclePairBackend,
      async loadPrivateSetup() {
        return {
          recordsCycle: false,
          consentAcceptedAt: '2026-08-09T00:00:00.000Z',
          consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
        };
      },
      loadCachedDailyLogs() {
        return new Promise(resolve => {
          restoreCache = resolve;
        });
      },
      syncDailyLogs() {
        return new Promise(() => {});
      },
    };
    const view = await render(<App backend={backend} />);
    await waitFor(() => expect(view.getByText('나의 오늘')).toBeTruthy());
    expect(view.queryByTestId('home-record')).toBeNull();
    expect(
      view.getByTestId('home-record-loading').props.accessibilityState.disabled,
    ).toBe(true);
    await act(async () =>
      restoreCache?.([
        {
          localDate: deviceLocalDate(),
          record: { emotionTags: ['anxious'], note: '복원 전 덮지 않을 원문' },
        },
      ]),
    );
    await waitFor(() => expect(view.getByTestId('home-record')).toBeTruthy());
    await fireEvent.press(view.getByTestId('home-record'));
    expect(view.getByText('불안 ›')).toBeTruthy();
    await fireEvent.press(view.getByTestId('record-details'));
    expect(view.getByTestId('record-note').props.value).toBe(
      '복원 전 덮지 않을 원문',
    );
  });

  it('waits for remote records when the local cache has no entry for today', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: false,
        diagnosticsEnabled: false,
      }),
    );
    let restoreRemote:
      | ((logs: Awaited<ReturnType<CyclePairBackend['syncDailyLogs']>>) => void)
      | undefined;
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
        return [];
      },
      syncDailyLogs() {
        return new Promise(resolve => {
          restoreRemote = resolve;
        });
      },
    };
    const view = await render(<App backend={backend} />);
    await waitFor(() => expect(restoreRemote).toBeDefined());
    expect(view.queryByTestId('home-record')).toBeNull();
    await act(async () =>
      restoreRemote?.([
        {
          localDate: deviceLocalDate(),
          record: { emotionTags: ['anxious'], note: '서버 원문' },
        },
      ]),
    );
    await waitFor(() => expect(view.getByTestId('home-record')).toBeTruthy());
    await fireEvent.press(view.getByTestId('home-record'));
    await fireEvent.press(view.getByTestId('record-details'));
    expect(view.getByTestId('record-note').props.value).toBe('서버 원문');
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

    await waitFor(() => expect(view.getByText('혼자 기록 중')).toBeTruthy());
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
    await waitFor(() => expect(view.getByText('공유 설정 저장')).toBeTruthy());

    await act(async () => {
      emitTombstones?.([{ id: 'tombstone-race', pairId: 'revoked-pair' }]);
    });

    await waitFor(() => expect(view.getByText('파트너 연결')).toBeTruthy());
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

  it.each([2, 3])(
    'v%i 선호를 복원하면 서버 등록도 한 번 해제한다',
    async schemaVersion => {
      // 구버전은 OS 권한 없이 알림을 기본 on 으로 뒀다. 마이그레이션이 로컬
      // 선호만 끄면 서버 등록이 살아남아, 로그아웃 뒤에도 이전 계정 알림이
      // 이 기기로 온다.
      await AsyncStorage.setItem(
        '@cyclepair/app-state/v1',
        JSON.stringify({
          schemaVersion,
          onboardingComplete: true,
          neutralNotifications: true,
        }),
      );
      const notificationClient = {
        enable: jest.fn(async () => 'authorized' as const),
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

      await waitFor(() =>
        expect(notificationClient.disable).toHaveBeenCalledTimes(1),
      );
      // 선호는 off 로 남는다. 알림 배선이 켜지지 않는다.
      expect(notificationClient.enable).not.toHaveBeenCalled();
    },
  );

  it('v4 선호를 복원할 때는 서버 등록을 해제하지 않는다', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 4,
        onboardingComplete: true,
        neutralNotifications: false,
      }),
    );
    const notificationClient = {
      enable: jest.fn(async () => 'authorized' as const),
      disable: jest.fn(async () => undefined),
      disableForAccountExit: jest.fn(async () => undefined),
      watchTokenRefresh: jest.fn(() => jest.fn()),
      watchOpened: jest.fn(() => jest.fn()),
    };

    const view = await render(
      <App
        backend={previewCyclePairBackend}
        notificationClient={notificationClient}
      />,
    );

    await waitFor(() => expect(view.queryByText('시작하기')).toBeNull());
    expect(notificationClient.disable).not.toHaveBeenCalled();
  });

  it('마이그레이션 해제가 실패해도 앱이 죽지 않고 선호는 off 로 남는다', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({
        schemaVersion: 3,
        onboardingComplete: true,
        neutralNotifications: true,
      }),
    );
    const notificationClient = {
      enable: jest.fn(async () => 'authorized' as const),
      disable: jest.fn(async () => {
        throw new Error('unregister failed');
      }),
      disableForAccountExit: jest.fn(async () => undefined),
      watchTokenRefresh: jest.fn(() => jest.fn()),
      watchOpened: jest.fn(() => jest.fn()),
    };
    const crashReporter = {
      setEnabled: jest.fn(async () => undefined),
      recordFailure: jest.fn(async () => undefined),
    };

    const view = await render(
      <App
        backend={previewCyclePairBackend}
        crashReporter={crashReporter}
        notificationClient={notificationClient}
      />,
    );

    await waitFor(() => expect(notificationClient.disable).toHaveBeenCalled());
    await waitFor(() =>
      expect(crashReporter.recordFailure).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ operation: 'unregister-device' }),
      ),
    );
    // 실패해도 화면은 계속 뜬다.
    await waitFor(() => expect(view.queryByText('시작하기')).toBeNull());
    expect(notificationClient.enable).not.toHaveBeenCalled();
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
    await waitFor(() => expect(view.getByText('시작하기')).toBeTruthy());

    await fireEvent.press(view.getByText('시작하기'));
    const persistedBeforeConsent = String(
      (AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)?.[1] ?? '',
    );
    expect(persistedBeforeConsent).not.toContain('lastPeriodStart');
    expect(persistedBeforeConsent).not.toContain('checkIn');
    await fireEvent.press(view.getByText('주기·컨디션 정보 이용에 동의해요'));
    await fireEvent.press(view.getByText('저장하고 시작'));

    await waitFor(() => expect(view.getByText('나의 오늘')).toBeTruthy());
    expect(view.getByText('혼자 기록 중')).toBeTruthy();
    expect(view.getByText('아직 주기 기록이 없어요')).toBeTruthy();
    expect(view.getByText('오프라인 저장')).toBeTruthy();
    expect(savePrivateSetup).toHaveBeenCalledWith(
      'preview-self',
      true,
      expect.any(String),
      SENSITIVE_HEALTH_CONSENT_VERSION,
      undefined,
    );
    await fireEvent.press(view.getByText('기록하기'));
    expect(view.queryByText('피로')).toBeNull();
    await fireEvent.press(view.getByTestId('record-emotions'));
    // 감정은 다중 선택이고 상한은 3개다. 상한에 닿으면 나머지가 잠긴다.
    await fireEvent.press(view.getByText('평온'));
    await fireEvent.press(view.getByText('애정'));
    await fireEvent.press(view.getByText('불안'));
    // 넷째를 눌러도 담기지 않아야 한다. 표시만 잠그고 동작이 열려 있으면
    // 상한이 지켜지지 않으므로 눌러 본 결과로 확인한다.
    await fireEvent.press(view.getByText('외로움'));
    expect(
      view.getByRole('checkbox', { name: '외로움' }).props.accessibilityState,
    ).toMatchObject({ checked: false });
    // 이미 고른 것은 눌러서 뺄 수 있어야 한다.
    await fireEvent.press(view.getByText('불안'));
    expect(
      view.getByRole('checkbox', { name: '불안' }).props.accessibilityState,
    ).toMatchObject({ checked: false });
    // 자리가 나면 다시 담긴다.
    await fireEvent.press(view.getByText('외로움'));
    expect(
      view.getByRole('checkbox', { name: '외로움' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
    await fireEvent.press(view.getByText('완료'));
    await fireEvent.press(view.getByTestId('record-help'));
    await fireEvent.press(view.getByText('그냥 들어줘요'));
    await fireEvent.press(view.getByText('완료'));
    await fireEvent.press(view.getByTestId('record-details'));
    await fireEvent.press(view.getByText('피로'));
    await fireEvent.press(view.getByText('기록 저장'));

    await waitFor(() => expect(view.getByText('✓ 기록 완료')).toBeTruthy());
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
            record: { emotionTags: ['anxious'], note: '삭제할 기록' },
          },
        ];
      },
      async syncDailyLogs() {
        return [
          {
            localDate: today,
            record: { emotionTags: ['anxious'], note: '삭제할 기록' },
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

    await waitFor(() => expect(view.getByText('나의 오늘')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('달력'));
    await fireEvent.press(view.getByText('기록 보기'));
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

    await waitFor(() => expect(view.getByText('나의 오늘')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('설정'));
    expect(view.queryByLabelText('최근 생리 시작일')).toBeNull();
    expect(view.queryByLabelText('조용한 시간 시작')).toBeNull();

    await fireEvent.press(view.getByText('내 주기'));
    await fireEvent.press(view.getByText('수정'));
    await fireEvent.changeText(
      view.getByLabelText('최근 생리 시작일'),
      '2026-08-02',
    );
    await fireEvent.press(view.getByText('뒤로'));
    await fireEvent.press(view.getByText('알림과 개인정보'));
    expect(view.queryByLabelText('최근 생리 시작일')).toBeNull();
    await fireEvent.changeText(
      view.getByLabelText('조용한 시간 시작'),
      '21:30',
    );

    await fireEvent.press(view.getByText('뒤로'));
    await fireEvent.press(view.getByText('앱 안내'));
    expect(view.queryByLabelText('조용한 시간 시작')).toBeNull();
    await fireEvent.press(view.getByText('뒤로'));
    await fireEvent.press(view.getByText('내 주기'));
    await fireEvent.press(view.getByText('수정'));
    expect(view.getByLabelText('최근 생리 시작일').props.value).toBe(
      '2026-08-01',
    );

    await fireEvent.press(view.getByText('뒤로'));
    await fireEvent.press(view.getByText('알림과 개인정보'));
    expect(view.getByLabelText('조용한 시간 시작').props.value).toBe('22:00');
  });

  it.each(['알림과 개인정보', '앱 안내'])(
    '개인정보 안내는 %s의 같은 창에서 열고 안전영역과 돌아갈 화면을 보존한다',
    async entrypoint => {
      const insetMock = jest.requireMock('react-native-safe-area-context')
        .useSafeAreaInsets as jest.Mock;
      const originalInsets = insetMock.getMockImplementation();
      insetMock.mockReturnValue({ top: 44, bottom: 34, left: 7, right: 11 });
      try {
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
              recordsCycle: false,
              consentAcceptedAt: '2026-08-14T00:00:00.000Z',
              consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
            };
          },
        };
        const view = await render(<App backend={backend} />);
        const visibleModals = () =>
          view.container.queryAll(
            node => node.type === 'Modal' && node.props.visible,
          );
        await waitFor(() => expect(view.getByText('나의 오늘')).toBeTruthy());
        await fireEvent.press(view.getByLabelText('설정'));
        await fireEvent.press(view.getByText(entrypoint));
        expect(visibleModals()).toHaveLength(1);
        if (entrypoint === '알림과 개인정보')
          await fireEvent.changeText(
            view.getByLabelText('조용한 시간 시작'),
            '21:30',
          );
        await fireEvent.press(
          entrypoint === '알림과 개인정보'
            ? view.getByTestId('privacy-open')
            : view.getByText('개인정보 안내 보기'),
        );
        expect(visibleModals()).toHaveLength(1);
        expect(view.getByText('내 기록과 공유를 직접 통제해요')).toBeTruthy();
        expect(view.getByTestId('privacy-center')).toHaveStyle({
          paddingTop: 44,
          paddingBottom: 34,
          paddingLeft: 7,
          paddingRight: 11,
        });
        expect(
          view.getByText(new RegExp(SENSITIVE_HEALTH_CONSENT_VERSION)),
        ).toBeTruthy();
        await fireEvent(visibleModals()[0], 'requestClose');
        expect(view.queryByTestId('privacy-center')).toBeNull();
        if (entrypoint === '알림과 개인정보')
          expect(view.getByLabelText('조용한 시간 시작').props.value).toBe(
            '21:30',
          );
        else expect(view.getByText('건강 정보 이용 안내')).toBeTruthy();
        if (entrypoint === '알림과 개인정보')
          expect(view.getByTestId('diagnostics-toggle').props.value).toBe(
            false,
          );
        await fireEvent.press(
          entrypoint === '알림과 개인정보'
            ? view.getByTestId('privacy-open')
            : view.getByText('개인정보 안내 보기'),
        );
        await fireEvent.press(view.getByTestId('privacy-close'));
        expect(view.queryByTestId('privacy-center')).toBeNull();
        expect(visibleModals()).toHaveLength(1);
        if (entrypoint === '알림과 개인정보')
          expect(view.getByLabelText('조용한 시간 시작').props.value).toBe(
            '21:30',
          );
        else expect(view.getByText('건강 정보 이용 안내')).toBeTruthy();
      } finally {
        insetMock.mockImplementation(originalInsets);
      }
    },
  );

  it.each(['projection', 'settings', 'events', 'nudges'] as const)(
    '해제된 Pair의 %s 오류를 숨기고 현재 Pair의 실제 오류는 표시한다',
    async watcher => {
      await AsyncStorage.setItem(
        '@cyclepair/app-state/v1',
        JSON.stringify({ schemaVersion: 4, onboardingComplete: true }),
      );
      let emitMembership:
        | Parameters<CyclePairBackend['watchActivePair']>[1]
        | undefined;
      const errors: Partial<Record<typeof watcher, (error: unknown) => void>> =
        {};
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
          emitMembership = onValue;
          onValue({ pairId: 'pair-before-revoke', partnerUid: 'partner-a' });
          return () => undefined;
        },
        watchPartnerProjection(_membership, _onValue, onError) {
          errors.projection = onError;
          return () => undefined;
        },
        watchShareSettings(_uid, _pairId, _onValue, onError) {
          errors.settings = onError;
          return () => undefined;
        },
        watchPairEvents(_membership, _onValue, onError) {
          errors.events = onError;
          return () => undefined;
        },
        watchPartnerNudgeState(_uid, _membership, _onValue, onError) {
          errors.nudges = onError;
          return () => undefined;
        },
      };
      const view = await render(<App backend={backend} />);
      await waitFor(() => expect(errors[watcher]).toBeDefined());
      await fireEvent.press(view.getByTestId('sharing-save'));
      await fireEvent.press(view.getByTestId('tab-settings'));
      const oldError = errors[watcher]!;
      const denied = { code: 'firestore/permission-denied' };
      await act(async () => oldError(denied));
      expect(view.getByText('현재 계정으로 접근할 수 없습니다.')).toBeTruthy();
      await act(async () => emitMembership?.(null));
      await fireEvent.press(view.getByTestId('tab-settings'));
      expect(view.queryByText('현재 계정으로 접근할 수 없습니다.')).toBeNull();
      await act(async () => oldError(denied));
      expect(view.queryByText('현재 계정으로 접근할 수 없습니다.')).toBeNull();
      await act(async () =>
        emitMembership?.({
          pairId: 'pair-after-reconnect',
          partnerUid: 'partner-b',
        }),
      );
      await fireEvent.press(view.getByTestId('sharing-save'));
      await fireEvent.press(view.getByTestId('tab-settings'));
      await act(async () => oldError(denied));
      expect(view.queryByText('현재 계정으로 접근할 수 없습니다.')).toBeNull();
      await act(async () => errors[watcher]!(denied));
      expect(view.getByText('현재 계정으로 접근할 수 없습니다.')).toBeTruthy();
    },
  );

  it('Pair가 해제되어도 본인 자료의 실제 권한 오류는 숨기지 않는다', async () => {
    await AsyncStorage.setItem(
      '@cyclepair/app-state/v1',
      JSON.stringify({ schemaVersion: 4, onboardingComplete: true }),
    );
    let emitMembership:
      | Parameters<CyclePairBackend['watchActivePair']>[1]
      | undefined;
    let ownError:
      | Parameters<CyclePairBackend['watchPendingTombstones']>[2]
      | undefined;
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
        emitMembership = onValue;
        onValue({ pairId: 'pair-private-error', partnerUid: 'partner-a' });
        return () => undefined;
      },
      watchPendingTombstones(_uid, _onValue, onError) {
        ownError = onError;
        return () => undefined;
      },
    };
    const view = await render(<App backend={backend} />);
    await waitFor(() => expect(ownError).toBeDefined());
    await fireEvent.press(view.getByTestId('sharing-save'));
    await fireEvent.press(view.getByTestId('tab-settings'));
    await act(async () => ownError?.({ code: 'firestore/permission-denied' }));
    await act(async () => emitMembership?.(null));
    await fireEvent.press(view.getByTestId('tab-settings'));
    expect(view.getByText('현재 계정으로 접근할 수 없습니다.')).toBeTruthy();
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
      emotionTags: ['anxious'],
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
          emotionTags: true,
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

    await waitFor(() => expect(view.getByText('나의 오늘')).toBeTruthy());
    expect(view.queryByText(/주기 예측과 케어 힌트는/)).toBeNull();
    const homeTree = JSON.stringify(view.toJSON());
    expect(homeTree.indexOf('home-record')).toBeLessThan(
      homeTree.indexOf('파트너 보기'),
    );
    expect(view.queryByLabelText('오늘 어때요?')).toBeNull();
    await fireEvent.press(view.getByLabelText('파트너'));
    expect(view.getByText('가임 가능성이 높은 시기예요')).toBeTruthy();
    expect(view.queryByLabelText('오늘 어때요?')).toBeNull();
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

    await fireEvent.press(view.getByLabelText('확인했어요, 챙겨볼게요'));
    await waitFor(() =>
      expect(sendPartnerNudge).toHaveBeenCalledWith(
        'preview-self',
        'pair-a',
        'care-acknowledgement',
        expect.stringMatching(/^nudge-/),
      ),
    );
    expect(view.getByText('파트너에게 넛지를 남겼어요.')).toBeTruthy();
    expect(
      view.getByLabelText('확인했어요, 챙겨볼게요').props.accessibilityState
        .disabled,
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
        emotionTags: ['calm'],
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
      expect(view.getByText('오늘 공유된 정보')).toBeTruthy(),
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
