import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import App from '../App';
import { previewMoonMateBackend } from '../src/platform/backend/PreviewMoonMateBackend';

describe('MoonMate mobile app', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('shows the privacy-first onboarding on a fresh install', async () => {
    const view = await render(<App backend={previewMoonMateBackend} />);

    await waitFor(() => {
      expect(view.getByText('MoonMate')).toBeTruthy();
      expect(view.getByText(/말하지 않아도/)).toBeTruthy();
      expect(view.getByText('건너뛰기')).toBeTruthy();
    });
  });

  it('completes the MVP setup and records a daily check-in', async () => {
    const view = await render(<App backend={previewMoonMateBackend} />);
    await waitFor(() => expect(view.getByText('건너뛰기')).toBeTruthy());

    await fireEvent.press(view.getByText('건너뛰기'));
    const persistedBeforeConsent = String(
      (AsyncStorage.setItem as jest.Mock).mock.calls.at(-1)?.[1] ?? '',
    );
    expect(persistedBeforeConsent).not.toContain('lastPeriodStart');
    expect(persistedBeforeConsent).not.toContain('checkIn');
    await fireEvent.press(view.getByText('민감정보 처리 원칙을 확인했어요'));
    await fireEvent.press(view.getByText('파트너 연결로 계속'));
    await waitFor(() => expect(view.getByText('연결 상태 확인')).toBeTruthy());
    await fireEvent.press(view.getByText('연결 상태 확인'));
    await waitFor(() => expect(view.getByText('추천 설정 적용')).toBeTruthy());
    await fireEvent.press(view.getByText('추천 설정 적용'));
    await fireEvent.press(view.getByText(/개 항목 공유하고 시작/));

    await waitFor(() => expect(view.getByText(/천천히, 내 몸의/)).toBeTruthy());
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
