import { act, render } from '@testing-library/react-native';
import React from 'react';
import { AppState, type AppStateStatus, Text } from 'react-native';

import type { PresenceClient } from '../platform/presence/PresenceClient';
import { usePresenceLifecycle } from './usePresenceLifecycle';

function PresenceProbe({ presenceClient }: { presenceClient?: PresenceClient }) {
  usePresenceLifecycle(presenceClient);
  return <Text>presence</Text>;
}

function fakePresenceClient(): PresenceClient & {
  start: jest.Mock;
  stop: jest.Mock;
  resume: jest.Mock;
} {
  return { start: jest.fn(), stop: jest.fn(), resume: jest.fn() };
}

function installAppStateSpy() {
  const listeners = new Set<(status: AppStateStatus) => void>();
  const remove = jest.fn();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      listeners.add(listener as (status: AppStateStatus) => void);
      return { remove } as ReturnType<typeof AppState.addEventListener>;
    });
  return {
    remove,
    get size() {
      return listeners.size;
    },
    async send(status: AppStateStatus) {
      await act(async () => {
        for (const listener of listeners) listener(status);
      });
    },
  };
}

describe('usePresenceLifecycle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('마운트에서 시작하고 언마운트에서 구독과 heartbeat를 모두 정리한다', async () => {
    const appState = installAppStateSpy();
    const presenceClient = fakePresenceClient();

    const view = await render(<PresenceProbe presenceClient={presenceClient} />);
    expect(presenceClient.start).toHaveBeenCalledTimes(1);
    expect(appState.size).toBe(1);

    await act(async () => view.unmount());
    expect(appState.remove).toHaveBeenCalledTimes(1);
    expect(presenceClient.stop).toHaveBeenCalledTimes(1);
  });

  it('background에서 멈추고 foreground 복귀에서 다시 시작한다', async () => {
    const appState = installAppStateSpy();
    const presenceClient = fakePresenceClient();

    await render(<PresenceProbe presenceClient={presenceClient} />);

    await appState.send('background');
    expect(presenceClient.stop).toHaveBeenCalledTimes(1);
    expect(presenceClient.resume).not.toHaveBeenCalled();

    await appState.send('active');
    expect(presenceClient.start).toHaveBeenCalledTimes(2);
    expect(presenceClient.resume).toHaveBeenCalledTimes(1);
  });

  it('presenceClient가 없으면 lifecycle을 구독하지 않는다', async () => {
    const appState = installAppStateSpy();

    await render(<PresenceProbe />);

    expect(appState.size).toBe(0);
  });
});
