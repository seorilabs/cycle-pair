import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

const mockReadConditionShareDraft = jest.fn();
const mockWriteConditionShareDraft = jest.fn();
const mockClearConditionShareDraft = jest.fn();
const mockGetLocalDateKey = jest.fn();
const mockOpenShareSheet = jest.fn();

jest.mock('@granite-js/react-native', () => ({
  createRoute: (_path: string, options: unknown) => options,
}));

jest.mock('../condition-storage', () => ({
  readConditionShareDraft: (...args: unknown[]) => mockReadConditionShareDraft(...args),
  writeConditionShareDraft: (...args: unknown[]) => mockWriteConditionShareDraft(...args),
  clearConditionShareDraft: (...args: unknown[]) => mockClearConditionShareDraft(...args),
  getLocalDateKey: () => mockGetLocalDateKey(),
}));

jest.mock('../open-share-sheet', () => ({
  openShareSheet: (...args: unknown[]) => mockOpenShareSheet(...args),
}));

import { ConditionSharePage } from './index';

const COMPLETE_DRAFT = {
  condition: 'tired' as const,
  helpPreference: 'listen' as const,
};

describe('AppsInToss condition share date boundary', () => {
  let localDate: string;
  let appStateListener: ((state: AppStateStatus) => void) | null;

  beforeEach(() => {
    localDate = '2026-08-02';
    appStateListener = null;
    jest.clearAllMocks();
    mockGetLocalDateKey.mockImplementation(() => localDate);
    mockReadConditionShareDraft.mockResolvedValue(COMPLETE_DRAFT);
    mockWriteConditionShareDraft.mockResolvedValue(undefined);
    mockClearConditionShareDraft.mockResolvedValue(undefined);
    mockOpenShareSheet.mockResolvedValue('opened');
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it(
    'clears a mounted draft when the app becomes active on the next day',
    async () => {
      const screen = render(<ConditionSharePage />);
      await waitFor(() => expect(screen.getByText(/오늘 내 컨디션은/)).toBeTruthy());

      localDate = '2026-08-03';
      await act(async () => {
        appStateListener?.('active');
      });

      await waitFor(() => expect(mockClearConditionShareDraft).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/오늘 내 컨디션은/)).toBeNull();
      expect(screen.getByText('날짜가 바뀌어 이전 선택을 비웠어요.')).toBeTruthy();
    },
    15_000,
  );

  it('rechecks the date and refuses to share a stale mounted draft', async () => {
    const screen = render(<ConditionSharePage />);
    await waitFor(() => expect(screen.getByText(/오늘 내 컨디션은/)).toBeTruthy());

    localDate = '2026-08-03';
    fireEvent.press(screen.getByText('컨디션 공유하기'));

    await waitFor(() => expect(mockClearConditionShareDraft).toHaveBeenCalledTimes(1));
    expect(mockOpenShareSheet).not.toHaveBeenCalled();
    expect(screen.queryByText(/오늘 내 컨디션은/)).toBeNull();
  });
});
