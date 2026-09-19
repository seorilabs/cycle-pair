import { createPlatformPresenceClient } from './PlatformPresenceClient';

type FetchCall = [string, RequestInit];

function envelope(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function edgeResponse(status: number) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => '',
  } as unknown as Response;
}

const bootstrap = envelope(200, {
  ok: true,
  result: {
    enabled: true,
    token: 'presence-token',
    edgeUrl: 'https://edge.example',
    expiresIn: 3600,
    heartbeatIntervalSeconds: 60,
  },
});

/** Presence는 어떤 것도 await하게 두지 않으므로 microtask로만 진행시킨다. */
async function settle() {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
  }
}

function calls(fetchImpl: jest.Mock): FetchCall[] {
  return fetchImpl.mock.calls as FetchCall[];
}

describe('PlatformPresenceClient', () => {
  it('기본 opt-in이 꺼져 있어 네트워크 호출을 하지 않는다', async () => {
    const fetchImpl = jest.fn(async () => bootstrap);
    const presence = createPlatformPresenceClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    presence.start();
    presence.resume();
    await settle();
    presence.stop();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('활성화하면 안정된 appId와 버전만 보내고 식별자를 싣지 않는다', async () => {
    const fetchImpl = jest.fn(async () => bootstrap);
    const presence = createPlatformPresenceClient({
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    presence.start();
    await settle();
    presence.stop();

    const [url, init] = calls(fetchImpl)[0]!;
    expect(url).toBe(
      'https://platform-api-306278488979.asia-northeast3.run.app/v1/presence/token',
    );
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'appVersion',
      'platform',
      'sessionId',
    ]);
    expect(body.appVersion).toBe('1.0.4');
    expect(body.platform).toBe('ios');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Seori-App']).toBe('cycle-pair');
    expect(JSON.stringify({ url, init })).not.toMatch(
      /uid|userId|deviceId|advertisingId|email/i,
    );
  });

  it('Edge 중단으로 token 요청이 실패해도 예외를 전파하지 않는다', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND edge.vzyx.xyz');
    });
    const presence = createPlatformPresenceClient({
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(() => presence.start()).not.toThrow();
    await settle();
    expect(() => presence.stop()).not.toThrow();

    expect(fetchImpl).toHaveBeenCalled();
  });

  it('heartbeat가 5xx여도 예외를 전파하지 않고 재전송 큐를 만들지 않는다', async () => {
    const fetchImpl = jest.fn(async (input: string) =>
      input.includes('/v1/presence/token') ? bootstrap : edgeResponse(503),
    );
    const presence = createPlatformPresenceClient({
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    presence.start();
    await settle();
    presence.stop();

    const urls = calls(fetchImpl).map(([url]) => url);
    expect(urls).toContain('https://edge.example/v1/presence/heartbeat');
    // 실패한 heartbeat를 같은 흐름에서 다시 보내지 않는다.
    expect(urls.filter(url => url.endsWith('/heartbeat'))).toHaveLength(1);
  });

  it('token 응답이 깨져 있어도 조용히 넘어간다', async () => {
    const fetchImpl = jest.fn(async () => envelope(200, { nonsense: true }));
    const presence = createPlatformPresenceClient({
      enabled: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    presence.start();
    await settle();
    expect(() => presence.stop()).not.toThrow();
  });
});
