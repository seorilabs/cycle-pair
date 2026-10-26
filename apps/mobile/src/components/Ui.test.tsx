import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  type KeyboardEvent,
} from 'react-native';
import { BottomTabs, Screen } from './Ui';
import type { MainTab } from '../app/CyclePairStore';

it('moves the selected tab state together with navigation through all four tabs', async () => {
  const changed = jest.fn();
  function Navigation() {
    const [tab, setTab] = React.useState<MainTab>('home');
    return (
      <BottomTabs
        value={tab}
        onChange={next => {
          changed(next);
          setTab(next);
        }}
      />
    );
  }
  const view = await render(<Navigation />);
  for (const key of ['calendar', 'partner', 'settings', 'home'] as const) {
    await fireEvent.press(view.getByTestId(`tab-${key}`));
    expect(changed).toHaveBeenLastCalledWith(key);
    for (const other of ['home', 'calendar', 'partner', 'settings']) {
      expect(
        view.getByTestId(`tab-${other}`).props.accessibilityState.selected,
      ).toBe(other === key);
    }
  }
});

describe('Screen keyboard behavior', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the Android content viewport above the keyboard and restores it when hidden', async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    const listeners = new Map<string, Array<(event: KeyboardEvent) => void>>();
    jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation((event, listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof Keyboard.addListener
        >;
      });
    try {
      const view = await render(
        <Screen>
          <Text>Note</Text>
        </Screen>,
      );
      const viewport = () => view.root!;
      await act(async () => {
        await viewport().props.onLayout({
          persist: jest.fn(),
          nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 800 } },
        });
      });
      const event = {
        duration: 0,
        easing: 'keyboard',
        endCoordinates: { height: 300, screenY: 500, width: 360, screenX: 0 },
      } as KeyboardEvent;
      await act(async () => {
        for (const listener of listeners.get('keyboardDidShow') ?? [])
          listener(event);
      });
      expect(StyleSheet.flatten(viewport().props.style).height).toBe(500);
      await act(async () => {
        for (const listener of listeners.get('keyboardDidHide') ?? [])
          listener(event);
      });
      expect(StyleSheet.flatten(viewport().props.style).height).toBeUndefined();
    } finally {
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: originalPlatform,
      });
    }
  });

  it('offers a working close button while the iOS keyboard is visible', async () => {
    const listeners = new Map<string, Array<(event: KeyboardEvent) => void>>();
    jest
      .spyOn(Keyboard, 'addListener')
      .mockImplementation((event, listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof Keyboard.addListener
        >;
      });
    const dismiss = jest
      .spyOn(Keyboard, 'dismiss')
      .mockImplementation(() => {});
    const view = await render(
      <Screen>
        <Text>내용</Text>
      </Screen>,
    );
    expect(view.queryByTestId('keyboard-done')).toBeNull();
    const event = {
      duration: 0,
      easing: 'keyboard',
      endCoordinates: { height: 300, screenY: 400, width: 375, screenX: 0 },
    } as KeyboardEvent;
    await act(async () => {
      for (const listener of listeners.get('keyboardWillShow') ?? [])
        listener(event);
    });
    await fireEvent.press(view.getByTestId('keyboard-done'));
    expect(dismiss).toHaveBeenCalledTimes(1);
    await act(async () => {
      for (const listener of listeners.get('keyboardWillHide') ?? [])
        listener(event);
    });
    expect(view.queryByTestId('keyboard-done')).toBeNull();
  });
});
