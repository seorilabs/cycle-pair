import { createPlatformFirebaseGuestClient } from './PlatformFirebaseGuestClient';

const credential = {
  firebaseCustomToken: 'firebase-custom-token',
  appUserId: 'pb_01K1J9ZVJ7AJ0DQRMA4RYB4R7P',
};

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
  };
}

function requestHeaders(fetchImpl: jest.Mock): Record<string, string> {
  const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
  return calls[0]![1].headers as Record<string, string>;
}

/**
 * 기본 클라이언트가 번들의 `__DEV__`를 따르는지 보려면 상수를 새로 평가해야
 * 한다. 모듈 캐시를 격리하고 끝나면 jest preset의 값으로 되돌린다.
 */
function createDefaultClientWithDevFlag(
  developmentBundle: boolean,
  fetchImpl: jest.Mock,
) {
  const global = globalThis as { __DEV__?: boolean };
  const previous = global.__DEV__;
  let client: ReturnType<typeof createPlatformFirebaseGuestClient> | undefined;
  try {
    global.__DEV__ = developmentBundle;
    jest.isolateModules(() => {
      const isolated =
        require('./PlatformFirebaseGuestClient') as typeof import('./PlatformFirebaseGuestClient');
      client = isolated.createPlatformFirebaseGuestClient(fetchImpl);
    });
  } finally {
    global.__DEV__ = previous;
  }
  return client!;
}

describe('PlatformFirebaseGuestClient', () => {
  it('requests a one-time credential without an authorization token', async () => {
    const fetchImpl = jest.fn(async () =>
      response(200, { ok: true, result: credential }),
    );
    const client = createPlatformFirebaseGuestClient(fetchImpl);

    await expect(client.createCredential()).resolves.toEqual(credential);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://platform-api-306278488979.asia-northeast3.run.app/v1/auth/firebase-custom-token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Seori-App': 'cycle-pair' }),
        body: JSON.stringify({ appId: 'cycle-pair' }),
      }),
    );
    const calls = fetchImpl.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    const headers = calls[0]![1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('marks a development build so Platform keeps it out of operational metrics', async () => {
    // QA 기기의 개발용 빌드가 게스트를 만들 때마다 신규 가입 알림과 사용자
    // 수에 섞이지 않도록 Platform이 가르는 신호다.
    const fetchImpl = jest.fn(async () =>
      response(200, { ok: true, result: credential }),
    );

    await createPlatformFirebaseGuestClient(fetchImpl, {
      debugBuild: true,
    }).createCredential();

    expect(requestHeaders(fetchImpl)['X-Seori-Build']).toBe('debug');
  });

  it('never sends the development build mark from a release build', async () => {
    const fetchImpl = jest.fn(async () =>
      response(200, { ok: true, result: credential }),
    );

    await createPlatformFirebaseGuestClient(fetchImpl, {
      debugBuild: false,
    }).createCredential();

    expect(requestHeaders(fetchImpl)).not.toHaveProperty('X-Seori-Build');
  });

  it('follows the bundle __DEV__ flag when the build kind is omitted', async () => {
    // QA마다 누군가 켜야 하는 값이면 결국 빠진다. 번들러가 정한 값을 그대로 쓴다.
    const debugFetch = jest.fn(async () =>
      response(200, { ok: true, result: credential }),
    );
    const releaseFetch = jest.fn(async () =>
      response(200, { ok: true, result: credential }),
    );

    await createDefaultClientWithDevFlag(true, debugFetch).createCredential();
    await createDefaultClientWithDevFlag(
      false,
      releaseFetch,
    ).createCredential();

    expect(requestHeaders(debugFetch)['X-Seori-Build']).toBe('debug');
    expect(requestHeaders(releaseFetch)).not.toHaveProperty('X-Seori-Build');
  });

  it('fails closed on a malformed success response', async () => {
    const fetchImpl = jest.fn(async () =>
      response(200, {
        ok: true,
        result: { ...credential, appUserId: 'client-selected-uid' },
      }),
    );

    await expect(
      createPlatformFirebaseGuestClient(fetchImpl).createCredential(),
    ).rejects.toMatchObject({
      code: 'account/platform-guest-invalid-response',
    });
  });

  it('does not retry an ambiguous server failure', async () => {
    const fetchImpl = jest.fn(async () =>
      response(503, {
        ok: false,
        error: { code: 'config_unavailable', message: 'unavailable' },
      }),
    );

    await expect(
      createPlatformFirebaseGuestClient(fetchImpl).createCredential(),
    ).rejects.toMatchObject({
      code: 'account/platform-guest-unavailable',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
