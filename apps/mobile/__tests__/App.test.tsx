import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { BackHandler } from 'react-native';
import App from '../App';
import { previewCyclePairBackend } from '../src/platform/backend/PreviewCyclePairBackend';

function installHardwareBackMock() {
  const handlers = new Set<Parameters<typeof BackHandler.addEventListener>[1]>();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
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
      expect(view.getByText('Cycle Pair')).toBeTruthy();
      expect(view.getByText(/말하지 않아도/)).toBeTruthy();
      expect(view.getByText('건너뛰기')).toBeTruthy();
    });
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
    const saveShareSettings = jest.fn(async () => undefined);
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
    await waitFor(() => expect(view.getByText('파트너 연결 완료')).toBeTruthy());
    expect(view.getByText(/연결은 유지돼요/)).toBeTruthy();
    expect(saveShareSettings).not.toHaveBeenCalled();

    await fireEvent.press(view.getByText('닫기'));
    await waitFor(() => expect(view.getByText('공유 설정 계속하기')).toBeTruthy());
    expect(saveShareSettings).not.toHaveBeenCalled();

    await fireEvent.press(view.getByText('설정'));
    await waitFor(() => expect(view.getByText('공유 설정을 완료해 주세요')).toBeTruthy());
    expect(view.queryByText('현재 주기 국면')).toBeNull();
    await fireEvent.press(view.getByText('공유 설정 계속하기'));
    await waitFor(() => expect(view.getByText('추천 설정 적용')).toBeTruthy());
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
    const backend = {
      ...previewCyclePairBackend,
      async loadPrivateSetup() {
        return {
          recordsCycle: true,
          consentAcceptedAt: '2026-07-13T00:00:00.000Z',
          cycle: {
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
  });

  it('completes the MVP setup and records a daily check-in', async () => {
    const view = await render(<App backend={previewCyclePairBackend} />);
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
    await fireEvent.press(view.getByText('기록하기'));
    await fireEvent.press(view.getByText('괜찮아요'));
    await fireEvent.press(view.getByText('피로'));
    await fireEvent.press(view.getByText('그냥 들어줘요'));
    await fireEvent.press(view.getByText('안전하게 저장하기'));

    await waitFor(() => expect(view.getByText('오늘 기록을 남겼어요')).toBeTruthy());
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
});
