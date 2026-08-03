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
