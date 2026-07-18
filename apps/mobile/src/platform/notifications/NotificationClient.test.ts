import {
  createNotificationClient,
  parseNeutralNotificationPayload,
  type NotificationDelegate,
} from './NotificationClient';

function delegate(permission: 'authorized' | 'denied' = 'authorized') {
  const value: NotificationDelegate = {
    requestPermission: jest.fn(async () => permission),
    getToken: jest.fn(async () => 'opaque-fcm-token'),
    register: jest.fn(async () => undefined),
    unregister: jest.fn(async () => undefined),
    deleteLocalToken: jest.fn(async () => undefined),
  };
  return value;
}

const preferences = {
  platform: 'ios' as const,
  locale: 'ko-KR',
  quietHours: {
    start: '22:00',
    end: '08:00',
    timeZone: 'Asia/Seoul',
  },
};

describe('privacy-safe notification client', () => {
  it('registers only after explicit native permission', async () => {
    const native = delegate();
    const client = createNotificationClient(native);

    await expect(client.enable(preferences)).resolves.toBe('authorized');
    expect(native.register).toHaveBeenCalledWith({
      token: 'opaque-fcm-token',
      ...preferences,
    });
  });

  it('does not request a token when permission is denied', async () => {
    const native = delegate('denied');
    const client = createNotificationClient(native);

    await expect(client.enable(preferences)).resolves.toBe('denied');
    expect(native.getToken).not.toHaveBeenCalled();
    expect(native.register).not.toHaveBeenCalled();
  });

  it('revokes the server registration and local token', async () => {
    const native = delegate();
    const client = createNotificationClient(native);
    await client.enable(preferences);

    await client.disable();

    expect(native.unregister).toHaveBeenCalledWith('opaque-fcm-token');
    expect(native.deleteLocalToken).toHaveBeenCalled();
  });

  it('keeps the local token when account-exit unregister fails, then retries in order', async () => {
    let tokenListener: ((token: string) => void) | undefined;
    const native = delegate();
    native.onTokenRefresh = listener => {
      tokenListener = listener;
      return jest.fn();
    };
    const client = createNotificationClient(native);
    await client.enable(preferences);
    client.watchTokenRefresh(preferences, error => {
      throw error;
    });
    (native.unregister as jest.Mock)
      .mockRejectedValueOnce(new Error('server unavailable'))
      .mockResolvedValueOnce(undefined);

    await expect(client.disableForAccountExit()).rejects.toThrow(
      'server unavailable',
    );
    expect(native.deleteLocalToken).not.toHaveBeenCalled();

    tokenListener?.('token-after-aborted-logout');
    await new Promise<void>(resolve => setImmediate(() => resolve()));
    expect(native.register).toHaveBeenLastCalledWith(
      expect.objectContaining({ token: 'token-after-aborted-logout' }),
    );

    await expect(client.disableForAccountExit()).resolves.toBeUndefined();
    expect(native.unregister).toHaveBeenCalledTimes(3);
    expect(native.unregister).toHaveBeenLastCalledWith(
      'token-after-aborted-logout',
    );
    expect(native.deleteLocalToken).toHaveBeenCalledTimes(1);
    expect(
      (native.unregister as jest.Mock).mock.invocationCallOrder[2],
    ).toBeLessThan(
      (native.deleteLocalToken as jest.Mock).mock.invocationCallOrder[0],
    );

    await client.disableForAccountExit();
    expect(native.getToken).toHaveBeenCalledTimes(1);
    expect(native.unregister).toHaveBeenCalledTimes(3);
  });

  it('accepts only neutral allowlisted notification payload keys', () => {
    expect(parseNeutralNotificationPayload({
      schemaVersion: '1',
      type: 'pair-update',
      destination: 'home',
    })).toEqual({
      schemaVersion: '1',
      type: 'pair-update',
      destination: 'home',
    });
    expect(parseNeutralNotificationPayload({
      schemaVersion: '1',
      type: 'pair-update',
      destination: 'home',
      note: '민감한 자유 텍스트',
    })).toBeNull();
  });

  it('re-registers a refreshed token and removes the previous registration', async () => {
    let tokenListener: ((token: string) => void) | undefined;
    const native = delegate();
    native.onTokenRefresh = listener => {
      tokenListener = listener;
      return jest.fn();
    };
    const client = createNotificationClient(native);
    await client.enable(preferences);
    const stop = client.watchTokenRefresh(preferences, error => {
      throw error;
    });

    tokenListener?.('token-two');
    await new Promise<void>(resolve => setImmediate(() => resolve()));

    expect(native.register).toHaveBeenLastCalledWith(
      expect.objectContaining({ token: 'token-two' }),
    );
    expect(native.unregister).toHaveBeenCalledWith('opaque-fcm-token');
    stop();
  });

  it('ignores token refresh before permission is authorized', async () => {
    let tokenListener: ((token: string) => void) | undefined;
    const native = delegate('denied');
    native.onTokenRefresh = listener => {
      tokenListener = listener;
      return jest.fn();
    };
    const client = createNotificationClient(native);
    client.watchTokenRefresh(preferences, error => {
      throw error;
    });

    tokenListener?.('token-before-permission');
    await expect(client.enable(preferences)).resolves.toBe('denied');
    tokenListener?.('token-after-denial');
    await new Promise<void>(resolve => setImmediate(() => resolve()));

    expect(native.register).not.toHaveBeenCalled();
  });

  it('compensates a refreshed registration that finishes after opt-out', async () => {
    let tokenListener: ((token: string) => void) | undefined;
    let finishRefreshRegistration: (() => void) | undefined;
    const native = delegate();
    native.onTokenRefresh = listener => {
      tokenListener = listener;
      return jest.fn();
    };
    const client = createNotificationClient(native);
    await client.enable(preferences);
    (native.register as jest.Mock).mockImplementationOnce(
      () => new Promise<void>(resolve => {
        finishRefreshRegistration = resolve;
      }),
    );
    client.watchTokenRefresh(preferences, error => {
      throw error;
    });

    tokenListener?.('token-raced-with-disable');
    await client.disable();
    finishRefreshRegistration?.();
    await new Promise<void>(resolve => setImmediate(() => resolve()));

    expect(native.unregister).toHaveBeenCalledWith('opaque-fcm-token');
    expect(native.unregister).toHaveBeenCalledWith('token-raced-with-disable');
    expect(native.deleteLocalToken).toHaveBeenCalledTimes(1);
  });

  it('delivers only allowlisted notification-open destinations', async () => {
    let openedListener: ((payload: unknown) => void) | undefined;
    const native = delegate();
    native.getInitialOpenedPayload = jest.fn(async () => ({
      schemaVersion: '1',
      type: 'pair-update',
      destination: 'home',
    }));
    native.onOpenedPayload = listener => {
      openedListener = listener;
      return jest.fn();
    };
    const client = createNotificationClient(native);
    const onOpen = jest.fn();
    client.watchOpened(onOpen, error => {
      throw error;
    });
    await new Promise<void>(resolve => setImmediate(() => resolve()));
    openedListener?.({
      schemaVersion: '1',
      type: 'shared-event-update',
      destination: 'calendar',
    });
    openedListener?.({
      schemaVersion: '1',
      type: 'pair-update',
      destination: 'home',
      uid: 'forbidden',
    });

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ destination: 'calendar' }),
    );
  });
});
