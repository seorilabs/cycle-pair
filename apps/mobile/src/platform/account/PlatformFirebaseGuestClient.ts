import { AccountOperationError } from '../../domain/account/AccountPort';

const PLATFORM_API_BASE_URL =
  'https://platform-api-306278488979.asia-northeast3.run.app';
const PLATFORM_APP_ID = 'cycle-pair';
const APP_USER_ID_PATTERN = /^pb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export interface PlatformFirebaseGuestCredential {
  readonly firebaseCustomToken: string;
  readonly appUserId: string;
}

export interface PlatformFirebaseGuestClient {
  createCredential(): Promise<PlatformFirebaseGuestCredential>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseCredential(value: unknown): PlatformFirebaseGuestCredential {
  const credential = asRecord(value);
  if (
    typeof credential?.firebaseCustomToken !== 'string' ||
    credential.firebaseCustomToken.length === 0 ||
    credential.firebaseCustomToken.length > 4096 ||
    typeof credential.appUserId !== 'string' ||
    !APP_USER_ID_PATTERN.test(credential.appUserId)
  ) {
    throw new AccountOperationError('account/platform-guest-invalid-response');
  }
  return credential as unknown as PlatformFirebaseGuestCredential;
}

export function createPlatformFirebaseGuestClient(
  fetchImpl: FetchLike = fetch,
): PlatformFirebaseGuestClient {
  return {
    async createCredential() {
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetchImpl(
          `${PLATFORM_API_BASE_URL}/v1/auth/firebase-custom-token`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Seori-App': PLATFORM_APP_ID,
              'X-Seori-Runtime': 'rn-native',
              'X-Seori-Sdk': 'cycle-pair/0.1.9',
            },
            body: JSON.stringify({ appId: PLATFORM_APP_ID }),
          },
        );
      } catch {
        throw new AccountOperationError(
          'account/platform-guest-network-unavailable',
        );
      }

      let envelope: Record<string, unknown> | null;
      try {
        envelope = asRecord(await response.json());
      } catch {
        throw new AccountOperationError(
          'account/platform-guest-invalid-response',
        );
      }
      if (!response.ok || envelope?.ok !== true) {
        const error = asRecord(envelope?.error);
        if (response.status === 429 || error?.code === 'rate_limited') {
          throw new AccountOperationError(
            'account/platform-guest-too-many-requests',
          );
        }
        throw new AccountOperationError('account/platform-guest-unavailable');
      }
      return parseCredential(envelope.result);
    },
  };
}

export const platformFirebaseGuestClient = createPlatformFirebaseGuestClient();
