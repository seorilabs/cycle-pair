import React from 'react';
import { Pressable, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { I18nProvider, useI18n } from './I18nProvider';

function LanguageExample() {
  const { t, setLanguage } = useI18n();
  return (
    <>
      <Text>{t('My day')}</Text>
      <Text>평온 shared an update</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="English"
        onPress={() => {
          setLanguage('en').catch(() => undefined);
        }}
      />
    </>
  );
}
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});
test('an explicit language persists across provider restarts while user text remains unchanged', async () => {
  const view = await render(
    <I18nProvider>
      <LanguageExample />
    </I18nProvider>,
  );
  await waitFor(() => expect(view.getByText('나의 오늘')).toBeTruthy());
  await act(async () => {
    fireEvent.press(view.getByLabelText('English'));
  });
  await waitFor(() => expect(view.getByText('My day')).toBeTruthy());
  expect(view.getByText('평온 shared an update')).toBeTruthy();
  await view.unmount();
  const restarted = await render(
    <I18nProvider>
      <LanguageExample />
    </I18nProvider>,
  );
  await waitFor(() => expect(restarted.getByText('My day')).toBeTruthy());
  expect(restarted.getByText('평온 shared an update')).toBeTruthy();
});
test('a failed language write preserves the active language', async () => {
  jest
    .mocked(AsyncStorage.setItem)
    .mockRejectedValueOnce(new Error('storage unavailable'));
  const view = await render(
    <I18nProvider>
      <LanguageExample />
    </I18nProvider>,
  );
  await waitFor(() => expect(view.getByText('나의 오늘')).toBeTruthy());
  await act(async () => {
    fireEvent.press(view.getByLabelText('English'));
  });
  await waitFor(() => expect(AsyncStorage.setItem).toHaveBeenCalled());
  expect(view.getByText('나의 오늘')).toBeTruthy();
});
