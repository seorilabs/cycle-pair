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
const mockSetLanguageCode = jest.fn(
  async (_auth: unknown, _locale: string): Promise<void> => undefined,
);
const mockSendVerification = jest.fn(async (_user: unknown) => undefined);
const mockSendReset = jest.fn(
  async (_auth: unknown, _email: string) => undefined,
);
const mockSignInWithCustomToken = jest.fn(
  async (
    _auth: unknown,
    _token: string,
  ): Promise<{ user: Record<string, unknown> }> => ({
    user: mockAuthState.currentUser ?? user(),
  }),
);
const mockCreateGuestCredential = jest.fn();
const mockCreateEmail = jest.fn(
  async (_auth: unknown, _email: string, _password: string) => ({
    user: user({ email: 'new@example.com', isAnonymous: false }),
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
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
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
  createUserWithEmailAndPassword: (
    auth: unknown,
    email: string,
    password: string,
  ) => mockCreateEmail(auth, email, password),
  getIdToken: (firebaseUser: unknown, forceRefresh?: boolean) =>
    mockGetIdToken(firebaseUser, forceRefresh),
  linkWithCredential: (firebaseUser: unknown, credential: unknown) =>
    mockLinkWithCredential(firebaseUser, credential),
  onAuthStateChanged: (auth: unknown, listener: unknown, error?: unknown) =>
    mockOnAuthStateChanged(auth, listener, error),
  reauthenticateWithCredential: (firebaseUser: unknown, credential: unknown) =>
    mockReauthenticate(firebaseUser, credential),
  reload: (firebaseUser: unknown) => mockReload(firebaseUser),
  setLanguageCode: (auth: unknown, locale: string) =>
    mockSetLanguageCode(auth, locale),
  sendEmailVerification: (firebaseUser: unknown) =>
    mockSendVerification(firebaseUser),
  sendPasswordResetEmail: (auth: unknown, email: string) =>
    mockSendReset(auth, email),
  signInWithCustomToken: (auth: unknown, token: string) =>
    mockSignInWithCustomToken(auth, token),
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

import { createFirebaseAccountAdapter } from './FirebaseAccountAdapter';
import { EmailAuthProvider } from '@react-native-firebase/auth';

const PLATFORM_GUEST_UID = 'pb_01K1J9ZVJ7AJ0DQRMA4RYB4R7P';
const firebaseAccountAdapter = createFirebaseAccountAdapter({
  createCredential: () => mockCreateGuestCredential(),
});

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
    mockSetLanguageCode.mockResolvedValue(undefined);
    mockCreateGuestCredential.mockResolvedValue({
      firebaseCustomToken: 'firebase-custom-token',
      appUserId: PLATFORM_GUEST_UID,
    });
  });

  it('creates an email account directly without requesting a platform guest credential', async () => {
    mockAuthState.currentUser = null;
    await expect(
      firebaseAccountAdapter.registerEmail('new@example.com', 'test-password'),
    ).resolves.toMatchObject({ email: 'new@example.com', isAnonymous: false });
    expect(mockCreateEmail).toHaveBeenCalledWith(
      mockAuthState,
      'new@example.com',
      'test-password',
    );
    expect(mockCreateGuestCredential).not.toHaveBeenCalled();
    expect(mockLinkWithCredential).not.toHaveBeenCalled();
  });

  it.each(['ko', 'en'] as const)(
    'awaits %s before sending verification mail',
    async locale => {
      mockAuthState.currentUser = user({
        email: 'user@example.com',
        isAnonymous: false,
      });
      let release!: () => void;
      mockSetLanguageCode.mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            release = resolve;
          }),
      );
      const sending = firebaseAccountAdapter.sendVerificationEmail(locale);
      await Promise.resolve();
      expect(mockSetLanguageCode).toHaveBeenCalledWith(mockAuthState, locale);
      expect(mockSendVerification).not.toHaveBeenCalled();
      release();
      await sending;
      expect(mockSendVerification).toHaveBeenCalledWith(
        mockAuthState.currentUser,
      );
    },
  );

  it.each(['ko', 'en'] as const)(
    'awaits %s before sending password reset mail',
    async locale => {
      let release!: () => void;
      mockSetLanguageCode.mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            release = resolve;
          }),
      );
      const sending = firebaseAccountAdapter.sendPasswordResetEmail(
        'user@example.com',
        locale,
      );
      await Promise.resolve();
      expect(mockSetLanguageCode).toHaveBeenCalledWith(mockAuthState, locale);
      expect(mockSendReset).not.toHaveBeenCalled();
      release();
      await sending;
      expect(mockSendReset).toHaveBeenCalledWith(
        mockAuthState,
        'user@example.com',
      );
    },
  );

  it('does not send mail when setting the selected language fails', async () => {
    mockAuthState.currentUser = user({
      email: 'user@example.com',
      isAnonymous: false,
    });
    mockSetLanguageCode.mockRejectedValueOnce(
      new Error('language-setting-failed'),
    );
    await expect(
      firebaseAccountAdapter.sendVerificationEmail('en'),
    ).rejects.toThrow('language-setting-failed');
    expect(mockSendVerification).not.toHaveBeenCalled();
  });

  it('reuses the native persisted user during initialization', async () => {
    expect(typeof EmailAuthProvider.credential).toBe('function');
    await expect(firebaseAccountAdapter.initialize()).resolves.toEqual({
      uid: 'stable-uid',
      email: null,
      isAnonymous: true,
      emailVerified: false,
    });
    expect(mockSignInWithCustomToken).not.toHaveBeenCalled();
  });

  it('starts a platform guest identity without reusing a persisted account', async () => {
    const persisted = user({
      email: 'user@example.com',
      isAnonymous: false,
      emailVerified: true,
    });
    const guest = user({
      uid: PLATFORM_GUEST_UID,
      isAnonymous: false,
    });
    mockAuthState.currentUser = persisted;
    mockSignInWithCustomToken.mockResolvedValueOnce({ user: guest });

    await expect(firebaseAccountAdapter.startGuest()).resolves.toEqual({
      uid: PLATFORM_GUEST_UID,
      email: null,
      isAnonymous: true,
      emailVerified: false,
    });
    expect(mockSignOut).toHaveBeenCalledWith(mockAuthState);
    expect(mockCreateGuestCredential).toHaveBeenCalledTimes(1);
    expect(mockSignInWithCustomToken).toHaveBeenCalledWith(
      mockAuthState,
      'firebase-custom-token',
    );
  });

  it('creates a platform guest when no persisted Firebase user exists', async () => {
    const guest = user({ uid: PLATFORM_GUEST_UID, isAnonymous: false });
    mockAuthState.currentUser = null;
    mockSignInWithCustomToken.mockResolvedValueOnce({ user: guest });

    await expect(firebaseAccountAdapter.initialize()).resolves.toMatchObject({
      uid: PLATFORM_GUEST_UID,
      isAnonymous: true,
    });
  });

  it('signs out and fails closed when Firebase returns a different uid', async () => {
    mockAuthState.currentUser = null;
    mockSignInWithCustomToken.mockResolvedValueOnce({
      user: user({ uid: 'unexpected-uid', isAnonymous: false }),
    });

    await expect(firebaseAccountAdapter.initialize()).rejects.toMatchObject({
      code: 'account/uid-changed',
    });
    expect(mockSignOut).toHaveBeenCalledWith(mockAuthState);
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
      firebaseAccountAdapter.requestDataExport('ko'),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      exportSubjectUid: 'stable-uid',
      singleUse: true,
    });
    await expect(
      firebaseAccountAdapter.beginAccountDeletion(),
    ).resolves.toEqual({
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
      locale: 'ko',
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

  it('sends the export locale and permits only the public language query', async () => {
    mockAuthState.currentUser = user({
      email: 'user@example.com',
      isAnonymous: false,
    });
    const ticket = {
      schemaVersion: 1,
      exportSubjectUid: 'stable-uid',
      expiresAt: '2026-07-14T00:05:00.000Z',
      filename: 'cycle-pair-data-export-2026-07-14.json',
      singleUse: true,
      downloadUrl: 'https://example.com/export?lang=en#token=' + 'a'.repeat(43),
    };
    mockCallableInvoke.mockResolvedValueOnce({ data: ticket });
    await expect(
      firebaseAccountAdapter.requestDataExport('en'),
    ).resolves.toEqual(ticket);
    expect(mockCallableInvoke).toHaveBeenCalledWith({
      uid: 'stable-uid',
      locale: 'en',
    });
    for (const query of [
      '?lang=ko',
      '?lang=fr',
      '?lang=en&lang=ko',
      '?lang=en&token=secret',
    ]) {
      mockCallableInvoke.mockResolvedValueOnce({
        data: {
          ...ticket,
          downloadUrl:
            'https://example.com/export' + query + '#token=' + 'a'.repeat(43),
        },
      });
      await expect(
        firebaseAccountAdapter.requestDataExport('en'),
      ).rejects.toMatchObject({ code: 'account/invalid-export-response' });
    }
  });
  it.each(['127.0.0.1', '192.168.1.24', '172.16.0.2'])(
    'keeps emulator exports at %s while the service adapter rejects HTTP',
    async host => {
      mockAuthState.currentUser = user({
        email: 'user@example.com',
        isAnonymous: false,
      });
      const ticket = {
        schemaVersion: 1,
        exportSubjectUid: 'stable-uid',
        expiresAt: '2026-07-14T00:05:00.000Z',
        filename: 'cycle-pair-data-export-2026-07-14.json',
        singleUse: true,
        downloadUrl:
          `http://${host}:5301/cyclepair-test/asia-northeast3/downloadAccountDataExport#token=` +
          'a'.repeat(43),
      };
      const local = createFirebaseAccountAdapter(undefined, {
        createGuestSession: async () => ({
          uid: 'stable-uid',
          email: null,
          isAnonymous: true,
          emailVerified: false,
        }),
        exportOrigin: `http://${host}:5301`,
      });
      mockCallableInvoke.mockResolvedValueOnce({ data: ticket });
      await expect(local.requestDataExport('ko')).resolves.toEqual(ticket);
      mockCallableInvoke.mockResolvedValueOnce({ data: ticket });
      await expect(
        firebaseAccountAdapter.requestDataExport('ko'),
      ).rejects.toMatchObject({ code: 'account/invalid-export-response' });
      mockCallableInvoke.mockResolvedValueOnce({
        data: {
          ...ticket,
          downloadUrl: 'https://example.com/export#token=' + 'a'.repeat(43),
        },
      });
      await expect(local.requestDataExport('ko')).rejects.toMatchObject({
        code: 'account/invalid-export-response',
      });
      mockCallableInvoke.mockResolvedValueOnce({
        data: {
          ...ticket,
          downloadUrl:
            'http://192.168.1.25:5301/export#token=' + 'a'.repeat(43),
        },
      });
      await expect(local.requestDataExport('ko')).rejects.toMatchObject({
        code: 'account/invalid-export-response',
      });
    },
  );
});
