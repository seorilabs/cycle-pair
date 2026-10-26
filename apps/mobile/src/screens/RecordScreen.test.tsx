import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render } from '@testing-library/react-native';
import { createInitialState, useCyclePair } from '../app/CyclePairStore';
import { I18nProvider } from '../i18n/I18nProvider';
import { RecordScreen } from './RecordScreen';

jest.mock('../app/CyclePairStore', () => ({
  ...jest.requireActual('../app/CyclePairStore'),
  useCyclePair: jest.fn(),
}));

it.each([
  ['en', false, false, 'Note sharing is off. Only you can see this note.'],
  ['en', true, false, 'Note sharing is off. Only you can see this note.'],
  [
    'en',
    true,
    true,
    'Note sharing is on. Saved notes are shared with your partner.',
  ],
  [
    'en',
    false,
    true,
    'Note sharing is on. Connect a partner to share saved notes.',
  ],
  ['ko', true, false, '메모 공유가 꺼져 있어요. 이 메모는 나만 봐요.'],
  [
    'ko',
    true,
    true,
    '메모 공유가 켜져 있어요. 저장한 메모도 파트너에게 공유돼요.',
  ],
] as const)(
  'shows the actual note-sharing state in %s when paired=%s, sharing=%s',
  async (locale, paired, noteSharing, expected) => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem('cyclepair.language.v1', locale);
    const state = createInitialState();
    jest.mocked(useCyclePair).mockReturnValue({
      state: {
        ...state,
        paired,
        shareSettings: { ...state.shareSettings, note: noteSharing },
      },
      backendBusy: false,
      backendError: null,
      saveCheckIn: jest.fn(),
    } as unknown as ReturnType<typeof useCyclePair>);
    const view = await render(
      <I18nProvider>
        <RecordScreen onDone={jest.fn()} onCancel={jest.fn()} />
      </I18nProvider>,
    );
    expect(view.getByText(expected)).toBeTruthy();
    expect(view.queryByText('This note is only for you.')).toBeNull();
  },
);

it('saves a past one-day period without requiring an emotion and keeps the selected date', async () => {
  const { fireEvent } = require('@testing-library/react-native');
  await AsyncStorage.clear();
  await AsyncStorage.setItem('cyclepair.language.v1', 'en');
  const saveCheckIn = jest.fn(async () => true),
    done = jest.fn();
  jest
    .mocked(useCyclePair)
    .mockReturnValue({
      state: { ...createInitialState(), isLogger: true },
      backendBusy: false,
      backendError: null,
      saveCheckIn,
      recoverDailyDraft: jest.fn(async () => null),
    } as unknown as ReturnType<typeof useCyclePair>);
  const view = await render(
    <I18nProvider>
      <RecordScreen
        localDate="2026-10-01"
        initialDraft={{ symptoms: [], periodStarted: true, periodEnded: true }}
        onDone={done}
        onCancel={jest.fn()}
      />
    </I18nProvider>,
  );
  fireEvent.press(view.getByTestId('record-save'));
  await require('@testing-library/react-native').waitFor(() =>
    expect(saveCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ periodStarted: true, periodEnded: true }),
      { localDate: '2026-10-01', preservePeriod: true },
    ),
  );
  expect(done).toHaveBeenCalled();
});
