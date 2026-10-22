import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Keyboard, Text, type KeyboardEvent } from 'react-native';
import { Screen } from './Ui';

describe('Screen keyboard behavior', () => {
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
