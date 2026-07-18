import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import React from 'react';
import {Text} from 'react-native';

import {initializeFirebaseAppCheck} from './FirebaseAppCheckBootstrap';
import {FirebaseAppCheckGate} from './FirebaseAppCheckGate';

jest.mock('./FirebaseAppCheckBootstrap', () => ({
  initializeFirebaseAppCheck: jest.fn(),
}));

const mockedInitialize = jest.mocked(initializeFirebaseAppCheck);

describe('FirebaseAppCheckGate', () => {
  beforeEach(() => {
    mockedInitialize.mockReset();
  });

  it('does not mount Firebase-backed children before attestation is ready', async () => {
    let finish: ((succeeded: boolean) => void) | undefined;
    const initialization = new Promise<boolean>(resolve => {
      finish = resolve;
    });
    const view = await render(
      <FirebaseAppCheckGate initialInitialization={initialization}>
        <Text>Firebase backend content</Text>
      </FirebaseAppCheckGate>,
    );

    expect(view.queryByText('Firebase backend content')).toBeNull();
    await act(async () => finish?.(true));
    expect(view.getByText('Firebase backend content')).toBeTruthy();
  });

  it('fails closed and retries without exposing the native error', async () => {
    mockedInitialize.mockResolvedValue(undefined);
    let finish: ((succeeded: boolean) => void) | undefined;
    const initialization = new Promise<boolean>(resolve => {
      finish = resolve;
    });
    const view = await render(
      <FirebaseAppCheckGate initialInitialization={initialization}>
        <Text>Firebase backend content</Text>
      </FirebaseAppCheckGate>,
    );

    await act(async () => finish?.(false));
    await waitFor(() => expect(view.getByText('다시 시도')).toBeTruthy());
    expect(view.queryByText('Firebase backend content')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByText('다시 시도'));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(view.getByText('Firebase backend content')).toBeTruthy(),
    );
    expect(mockedInitialize).toHaveBeenCalledTimes(1);
  });
});
