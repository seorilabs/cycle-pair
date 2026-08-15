import { act, render } from '@testing-library/react-native';
import React from 'react';
import { Keyboard, Text, type KeyboardEvent } from 'react-native';
import { useKeyboardVisibility } from './useKeyboardVisibility';

function KeyboardProbe() {
  const visible = useKeyboardVisibility();
  return <Text>{visible ? '키보드 표시' : '키보드 숨김'}</Text>;
}

describe('useKeyboardVisibility', () => {
  it('tracks iOS keyboard transitions and removes native listeners', async () => {
    const listeners = new Map<string, (event: KeyboardEvent) => void>();
    const remove = jest.fn();
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event, listener) => {
      listeners.set(event, listener);
      return { remove } as unknown as ReturnType<typeof Keyboard.addListener>;
    });
    const view = await render(<KeyboardProbe />);

    expect(view.getByText('키보드 숨김')).toBeTruthy();
    await act(async () => {
      listeners.get('keyboardWillShow')?.({} as KeyboardEvent);
    });
    expect(view.getByText('키보드 표시')).toBeTruthy();
    await act(async () => {
      listeners.get('keyboardWillHide')?.({} as KeyboardEvent);
    });
    expect(view.getByText('키보드 숨김')).toBeTruthy();

    await act(async () => view.unmount());
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
