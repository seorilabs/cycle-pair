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

jest.mock('@apps-in-toss/framework', () => ({
  eventLog: jest.fn(async () => undefined),
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
import { createAitAnalytics, type AitAnalytics } from '../analytics';

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

describe('AppsInToss condition share analytics', () => {
  let analytics: AitAnalytics;
  let track: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLocalDateKey.mockReturnValue('2026-08-02');
    mockReadConditionShareDraft.mockResolvedValue(COMPLETE_DRAFT);
    mockWriteConditionShareDraft.mockResolvedValue(undefined);
    mockClearConditionShareDraft.mockResolvedValue(undefined);
    mockOpenShareSheet.mockResolvedValue('opened');
    jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() });
    track = jest.fn();
    analytics = { track };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('tracks restored drafts, condition/help selection, and clearing', async () => {
    const screen = render(<ConditionSharePage analytics={analytics} />);
    await waitFor(() =>
      expect(screen.getByText(/오늘 내 컨디션은/)).toBeTruthy(),
    );

    expect(track).toHaveBeenCalledWith({ name: 'cp_ait_draft_restored' });

    fireEvent.press(screen.getByText('편안해요'));
    fireEvent.press(screen.getByText('따뜻하게 챙겨줘요'));
    fireEvent.press(screen.getByText('이 기기의 선택 내용 지우기'));

    expect(track).toHaveBeenCalledWith({
      name: 'cp_ait_condition_select',
      params: { group: 'condition', value: 'comfortable' },
    });
    expect(track).toHaveBeenCalledWith({
      name: 'cp_ait_condition_select',
      params: { group: 'help', value: 'warmth' },
    });
    expect(track).toHaveBeenCalledWith({ name: 'cp_ait_draft_cleared' });
  });

  it.each(['opened', 'unsupported', 'failed'] as const)(
    'tracks the actual %s share outcome',
    async (outcome) => {
      mockOpenShareSheet.mockResolvedValue(outcome);
      const screen = render(<ConditionSharePage analytics={analytics} />);
      await waitFor(() =>
        expect(screen.getByText('컨디션 공유하기')).toBeTruthy(),
      );

      fireEvent.press(screen.getByText('컨디션 공유하기'));

      await waitFor(() => expect(mockOpenShareSheet).toHaveBeenCalledTimes(1));
      expect(track).toHaveBeenCalledWith({ name: 'cp_ait_share_open' });
      await waitFor(() =>
        expect(track).toHaveBeenCalledWith({
          name: 'cp_ait_share_result',
          params: { outcome },
        }),
      );
    },
  );

  it('keeps selection and sharing working when analytics throws', async () => {
    const failingAnalytics = createAitAnalytics({
      log: () => {
        throw new Error('unsupported');
      },
    });
    const screen = render(<ConditionSharePage analytics={failingAnalytics} />);
    await waitFor(() =>
      expect(screen.getByText('컨디션 공유하기')).toBeTruthy(),
    );

    fireEvent.press(screen.getByText('편안해요'));
    expect(mockWriteConditionShareDraft).toHaveBeenCalled();

    fireEvent.press(screen.getByText('컨디션 공유하기'));
    await waitFor(() => expect(mockOpenShareSheet).toHaveBeenCalledTimes(1));
  });
});
