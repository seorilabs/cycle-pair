const mockAuthState: { currentUser: Record<string, unknown> | null } = {
  currentUser: null,
};
const mockCredential = jest.fn((email: string, password: string) => ({
  email,
  password,
}));
const mockGetIdToken = jest.fn(
  async (_user: unknown, _forceRefresh?: boolean) => 'fresh-id-token',
);
const mockLinkWithCredential = jest.fn(
  async (_user: unknown, _credential: unknown) => ({
    user: mockAuthState.currentUser,
  }),
);
const mockOnAuthStateChanged = jest.fn(
  (_auth: unknown, _listener: unknown, _error?: unknown) => jest.fn(),
);
const mockReauthenticate = jest.fn(
  async (_user: unknown, _credential: unknown) => ({
    user: mockAuthState.currentUser,
  }),
);
const mockReload = jest.fn(async (_user: unknown) => undefined);
const mockSendVerification = jest.fn(async (_user: unknown) => undefined);
const mockSendReset = jest.fn(
  async (_auth: unknown, _email: string) => undefined,
);
const mockSignInAnonymously = jest.fn(
  async (_auth: unknown): Promise<{ user: Record<string, unknown> }> => ({
    user: mockAuthState.currentUser ?? user(),
  }),
);
const mockSignInWithEmail = jest.fn(
  async (_auth: unknown, _email: string, _password: string) => undefined,
);
const mockSignOut = jest.fn(async (_auth: unknown) => undefined);
const mockCallableInvoke = jest.fn();

jest.mock('react-native-keychain', () => ({
  __esModule: true,
  ACCESSIBLE: {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
      'AccessibleAfterFirstUnlockThisDeviceOnly',
  },
  STORAGE_TYPE: {AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth'},
  getAllGenericPasswordServices: jest.fn(async () => []),
  resetGenericPassword: jest.fn(async () => true),
}));

jest.mock('@react-native-firebase/app', () => ({
  getApp: jest.fn(() => ({ name: '[DEFAULT]' })),
}));

jest.mock('@react-native-firebase/auth', () => ({
  EmailAuthProvider: {
    credential: (email: string, password: string) =>
      mockCredential(email, password),
  },
  getAuth: jest.fn(() => mockAuthState),
  getIdToken: (firebaseUser: unknown, forceRefresh?: boolean) =>
    mockGetIdToken(firebaseUser, forceRefresh),
  linkWithCredential: (firebaseUser: unknown, credential: unknown) =>
    mockLinkWithCredential(firebaseUser, credential),
  onAuthStateChanged: (auth: unknown, listener: unknown, error?: unknown) =>
    mockOnAuthStateChanged(auth, listener, error),
  reauthenticateWithCredential: (firebaseUser: unknown, credential: unknown) =>
    mockReauthenticate(firebaseUser, credential),
  reload: (firebaseUser: unknown) => mockReload(firebaseUser),
  sendEmailVerification: (firebaseUser: unknown) =>
    mockSendVerification(firebaseUser),
  sendPasswordResetEmail: (auth: unknown, email: string) =>
    mockSendReset(auth, email),
  signInAnonymously: (auth: unknown) => mockSignInAnonymously(auth),
  signInWithEmailAndPassword: (
    auth: unknown,
    email: string,
    password: string,
  ) => mockSignInWithEmail(auth, email, password),
  signOut: (auth: unknown) => mockSignOut(auth),
}));

jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: jest.fn(() => ({ region: 'asia-northeast3' })),
  httpsCallable: jest.fn(() => mockCallableInvoke),
}));

import { firebaseAccountAdapter } from './FirebaseAccountAdapter';
import { EmailAuthProvider } from '@react-native-firebase/auth';

function user(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'stable-uid',
    email: null,
    isAnonymous: true,
    emailVerified: false,
    ...overrides,
  };
}

describe('FirebaseAccountAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.currentUser = user();
  });

  it('reuses the native persisted user during initialization', async () => {
    expect(typeof EmailAuthProvider.credential).toBe('function');
    await expect(firebaseAccountAdapter.initialize()).resolves.toEqual({
      uid: 'stable-uid',
      email: null,
      isAnonymous: true,
      emailVerified: false,
    });
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it('starts a new anonymous identity without reusing a persisted account', async () => {
    const persisted = user({
      email: 'user@example.com',
      isAnonymous: false,
      emailVerified: true,
    });
    const guest = user({ uid: 'fresh-guest-uid' });
    mockAuthState.currentUser = persisted;
    mockSignInAnonymously.mockResolvedValueOnce({ user: guest });

    await expect(firebaseAccountAdapter.startGuest()).resolves.toEqual({
      uid: 'fresh-guest-uid',
      email: null,
      isAnonymous: true,
      emailVerified: false,
    });
    expect(mockSignOut).toHaveBeenCalledWith(mockAuthState);
    expect(mockSignInAnonymously).toHaveBeenCalledWith(mockAuthState);
  });

  it('links email credentials to the anonymous user while preserving its uid', async () => {
    const linked = user({
      email: 'user@example.com',
      isAnonymous: false,
    });
    mockAuthState.currentUser = user();
    mockLinkWithCredential.mockResolvedValueOnce({ user: linked });

    await expect(
      firebaseAccountAdapter.upgradeAnonymous(
        'user@example.com',
        'password-123',
      ),
    ).resolves.toEqual({
      uid: 'stable-uid',
      email: 'user@example.com',
      isAnonymous: false,
      emailVerified: false,
    });
    expect(mockCredential).toHaveBeenCalledWith(
      'user@example.com',
      'password-123',
    );
    expect(mockLinkWithCredential).toHaveBeenCalledWith(
      mockAuthState.currentUser,
      { email: 'user@example.com', password: 'password-123' },
    );
  });

  it('fails closed if an account link unexpectedly changes the uid', async () => {
    mockLinkWithCredential.mockResolvedValueOnce({
      user: user({
        uid: 'different-uid',
        email: 'user@example.com',
        isAnonymous: false,
      }),
    });

    await expect(
      firebaseAccountAdapter.upgradeAnonymous(
        'user@example.com',
        'password-123',
      ),
    ).rejects.toMatchObject({ code: 'account/uid-changed' });
  });

  it('uses the durable account email for password reauthentication', async () => {
    const durable = user({
      email: 'user@example.com',
      isAnonymous: false,
      emailVerified: true,
    });
    mockAuthState.currentUser = durable;

    await firebaseAccountAdapter.reauthenticateWithPassword('current-password');
    expect(mockCredential).toHaveBeenCalledWith(
      'user@example.com',
      'current-password',
    );
    expect(mockReauthenticate).toHaveBeenCalledWith(durable, {
      email: 'user@example.com',
      password: 'current-password',
    });
    expect(mockGetIdToken).toHaveBeenCalledWith(durable, true);
  });

  it('validates account export and deletion callable responses', async () => {
    mockAuthState.currentUser = user({
      email: 'user@example.com',
      isAnonymous: false,
    });
    mockCallableInvoke
      .mockResolvedValueOnce({
        data: {
          schemaVersion: 1,
          exportSubjectUid: 'stable-uid',
          expiresAt: '2026-07-14T00:05:00.000Z',
          filename: 'cycle-pair-data-export-2026-07-14.json',
          singleUse: true,
          downloadUrl:
            'https://asia-northeast3-demo.cloudfunctions.net/downloadAccountDataExport#token=' +
            'a'.repeat(43),
        },
      })
      .mockResolvedValueOnce({
        data: {
          schemaVersion: 1,
          deletionSubjectUid: 'stable-uid',
          recoveryReceipt: 'r'.repeat(43),
        },
      })
      .mockResolvedValueOnce({
        data: {
          schemaVersion: 1,
          status: 'pending',
        },
      })
      .mockResolvedValueOnce({
        data: {
          schemaVersion: 1,
          deleted: true,
          completedAt: '2026-07-14T00:01:00.000Z',
        },
      });

    await expect(
      firebaseAccountAdapter.requestDataExport(),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      exportSubjectUid: 'stable-uid',
      singleUse: true,
    });
    await expect(firebaseAccountAdapter.beginAccountDeletion()).resolves.toEqual({
      schemaVersion: 1,
      deletionSubjectUid: 'stable-uid',
      recoveryReceipt: 'r'.repeat(43),
    });
    await expect(
      firebaseAccountAdapter.getAccountDeletionStatus(
        'stable-uid',
        'r'.repeat(43),
      ),
    ).resolves.toEqual({ schemaVersion: 1, status: 'pending' });
    await expect(
      firebaseAccountAdapter.deleteMyAccount('r'.repeat(43)),
    ).resolves.toEqual({
      schemaVersion: 1,
      deleted: true,
      completedAt: '2026-07-14T00:01:00.000Z',
    });
    await firebaseAccountAdapter.purgeLocalPrivateData('stable-uid');
    expect(mockCallableInvoke).toHaveBeenNthCalledWith(1, {
      uid: 'stable-uid',
    });
    expect(mockCallableInvoke).toHaveBeenNthCalledWith(2, {
      uid: 'stable-uid',
    });
    expect(mockCallableInvoke).toHaveBeenNthCalledWith(3, {
      uid: 'stable-uid',
      recoveryReceipt: 'r'.repeat(43),
    });
    expect(mockCallableInvoke).toHaveBeenNthCalledWith(4, {
      uid: 'stable-uid',
      recoveryReceipt: 'r'.repeat(43),
    });
  });
});
