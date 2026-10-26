import React from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render } from '@testing-library/react-native';
import { createInitialState, useCyclePair } from '../app/CyclePairStore';
import { I18nProvider } from '../i18n/I18nProvider';
import { CalendarScreen } from './CalendarScreen';

jest.mock('../app/CyclePairStore', () => ({
  ...jest.requireActual('../app/CyclePairStore'),
  useCyclePair: jest.fn(),
}));
it.each([
  ['en', 'Has a record, Has a shared event'],
  ['ko', '기록 있음, 공동 일정 있음'],
] as const)(
  'reads record and shared-event date markers in %s',
  async (locale, markers) => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem('cyclepair.language.v1', locale);
    const state = createInitialState();
    const date = state.currentLocalDate;
    jest.mocked(useCyclePair).mockReturnValue({
      state: {
        ...state,
        paired: true,
        sharingCompleted: true,
        sharingPairId: 'owned-pair',
        dailyHistory: [
          {
            localDate: date,
            checkIn: {
              emotions: ['calm'],
              symptoms: [],
              periodStarted: false,
              periodEnded: false,
            },
          },
        ],
        sharedEvents: [
          {
            id: 'owned-event',
            pairId: 'owned-pair',
            createdBy: 'self',
            updatedBy: 'self',
            mutationId: 'owned-event',
            date,
            title: 'A quiet walk',
          },
        ],
      },
      backendBusy: false,
      backendError: null,
      dailyHistoryStatus: 'ready',
      retryDailyHistory: jest.fn(),
      deleteDailyLog: jest.fn(),
      upsertPairEvent: jest.fn(),
      deletePairEvent: jest.fn(),
    } as unknown as ReturnType<typeof useCyclePair>);
    const view = await render(
      <I18nProvider>
        <CalendarScreen onOpenRecord={jest.fn()} />
      </I18nProvider>,
    );
    expect(
      view.getByRole('button', { name: new RegExp(`^${date}, .*${markers}$`) }),
    ).toBeTruthy();
    if (locale === 'en')
      expect(view.queryByLabelText(/기록 있음|공동 일정 있음/)).toBeNull();
    const weekday = view.getByLabelText(locale === 'en' ? 'Sun' : '일');
    expect(weekday.props.children).toBe(locale === 'en' ? 'S' : '일');
  },
);
it('shows older recorded periods without filling an unknown end and opens a date-specific editor', async () => {
  const { fireEvent } = require('@testing-library/react-native');
  await AsyncStorage.clear();
  await AsyncStorage.setItem('cyclepair.language.v1', 'en');
  const state = createInitialState(),
    savePeriodBoundary = jest.fn(async () => true),
    onOpenRecord = jest.fn();
  jest.mocked(useCyclePair).mockReturnValue({
    state: {
      ...state,
      isLogger: true,
      hasCycleSeed: false,
      dailyHistory: [
        {
          localDate: '2026-10-01',
          checkIn: { symptoms: [], periodStarted: true, periodEnded: false },
        },
      ],
    },
    backendBusy: false,
    backendError: null,
    dailyHistoryStatus: 'ready',
    savePeriodBoundary,
    recoverDailyDraft: jest.fn(async () => null),
  } as unknown as ReturnType<typeof useCyclePair>);
  const view = await render(
    <I18nProvider>
      <CalendarScreen onOpenRecord={onOpenRecord} />
    </I18nProvider>,
  );
  expect(view.getByText(/End not recorded/)).toBeTruthy();
  await fireEvent.press(view.getByTestId('period-history-0'));
  await fireEvent.press(view.getByTestId('calendar-log-period'));
  expect(view.getByTestId('period-start').props.value).toBe(true);
  expect(view.getByTestId('period-end').props.value).toBe(false);
  await fireEvent(view.getByTestId('period-end'), 'valueChange', true);
  await fireEvent.press(view.getByTestId('period-save'));
  expect(savePeriodBoundary).toHaveBeenCalledWith('2026-10-01', {
    periodStarted: true,
    periodEnded: true,
  });
  await fireEvent.press(view.getByTestId('calendar-today'));
  expect(
    view.getByRole('button', {
      name: new RegExp(`^${state.currentLocalDate},`),
    }).props.accessibilityState.selected,
  ).toBe(true);
});
it('opens the selected record in condition mode without offering period controls', async () => {
  const { fireEvent } = require('@testing-library/react-native');
  await AsyncStorage.clear();
  await AsyncStorage.setItem('cyclepair.language.v1', 'en');
  const state = createInitialState(),
    onOpenRecord = jest.fn();
  jest.mocked(useCyclePair).mockReturnValue({
    state: { ...state, isLogger: false },
    backendBusy: false,
    backendError: null,
    dailyHistoryStatus: 'ready',
  } as unknown as ReturnType<typeof useCyclePair>);
  const view = await render(
    <I18nProvider>
      <CalendarScreen onOpenRecord={onOpenRecord} />
    </I18nProvider>,
  );
  expect(view.queryByText('Period history')).toBeNull();
  await fireEvent.press(view.getByTestId('calendar-log-period'));
  expect(onOpenRecord).toHaveBeenCalledWith(state.currentLocalDate);
  expect(view.queryByTestId('period-start')).toBeNull();
});
it('shows reload inside the record view after a stale deletion is refused', async () => {
  const { fireEvent } = require('@testing-library/react-native');
  await AsyncStorage.clear();
  await AsyncStorage.setItem('cyclepair.language.v1', 'en');
  const state = createInitialState(),
    reloadPrivateHistory = jest.fn(async () => {});
  jest.mocked(useCyclePair).mockReturnValue({
    state: {
      ...state,
      isLogger: false,
      dailyHistory: [
        {
          localDate: state.currentLocalDate,
          checkIn: {
            symptoms: [],
            emotions: ['calm'],
            note: 'server record',
            periodStarted: false,
            periodEnded: false,
          },
        },
      ],
    },
    backendBusy: false,
    backendError:
      '저장된 기록이 바뀌었어요. 최신 기록을 불러온 뒤 다시 저장해 주세요.',
    dailyHistoryStatus: 'ready',
    reloadPrivateHistory,
    deleteDailyLog: jest.fn(async () => false),
  } as unknown as ReturnType<typeof useCyclePair>);
  const alert = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons) => {
      buttons?.find(button => button.style === 'destructive')?.onPress?.();
    });
  try {
    const view = await render(
      <I18nProvider>
        <CalendarScreen onOpenRecord={jest.fn()} />
      </I18nProvider>,
    );
    await fireEvent.press(view.getByText('View record'));
    await fireEvent.press(view.getByText('Delete record'));
    await fireEvent.press(view.getByTestId('calendar-delete-reload'));
    expect(reloadPrivateHistory).toHaveBeenCalledTimes(1);
  } finally {
    alert.mockRestore();
  }
});
it('makes a queued change visible after the period editor is closed', async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('cyclepair.language.v1', 'en');
  const state = createInitialState();
  jest.mocked(useCyclePair).mockReturnValue({
    state: { ...state, isLogger: true, syncStatus: 'queued' },
    backendBusy: false,
    backendError: null,
    dailyHistoryStatus: 'ready',
  } as unknown as ReturnType<typeof useCyclePair>);
  const view = await render(
    <I18nProvider>
      <CalendarScreen onOpenRecord={jest.fn()} />
    </I18nProvider>,
  );
  expect(view.getByTestId('calendar-sync-status').props.children).toBe(
    'Saved here. Waiting to sync.',
  );
});
it('keeps small recorded-period day numbers readable against their rendered fill', async () => {
  const { within } = require('@testing-library/react-native');
  const { StyleSheet } = require('react-native');
  await AsyncStorage.clear();
  await AsyncStorage.setItem('cyclepair.language.v1', 'en');
  const state = createInitialState();
  jest
    .mocked(useCyclePair)
    .mockReturnValue({
      state: {
        ...state,
        isLogger: true,
        dailyHistory: [
          {
            localDate: state.currentLocalDate,
            checkIn: { symptoms: [], periodStarted: true, periodEnded: true },
          },
        ],
      },
      backendBusy: false,
      backendError: null,
      dailyHistoryStatus: 'ready',
    } as unknown as ReturnType<typeof useCyclePair>);
  const view = await render(
    <I18nProvider>
      <CalendarScreen onOpenRecord={jest.fn()} />
    </I18nProvider>,
  );
  const day = view.getByRole('button', {
    name: new RegExp(`^${state.currentLocalDate},`),
  });
  const number = within(day).getByText(
    String(Number(state.currentLocalDate.slice(-2))),
  );
  const foreground = StyleSheet.flatten(number.props.style).color;
  let parent = number.parent,
    background;
  while (parent && !background) {
    background = StyleSheet.flatten(parent.props.style)?.backgroundColor;
    parent = parent.parent;
  }
  function luminance(color: string) {
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    const channels = [1, 3, 5]
      .map(i => parseInt(color.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return (
      channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
    );
  }
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => a - b,
  );
  expect((values[1]! + 0.05) / (values[0]! + 0.05)).toBeGreaterThanOrEqual(4.5);
});
