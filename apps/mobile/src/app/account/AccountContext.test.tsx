import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { Alert, Linking, Pressable, Text } from 'react-native';
import type {
  AccountErrorListener,
  AccountDeletionStatus,
  AccountPort,
  AccountSession,
  AccountSessionListener,
} from '../../domain/account/AccountPort';
import type { AccountSessionCleanup } from '../../domain/account/AccountSessionCleanup';
import { AccountSettingsCard } from '../../components/AccountSettingsCard';
import { asyncStorageAccountSessionIntentStorage } from '../../platform/local/AccountSessionIntentStorage';
import { AccountGateScreen } from '../../screens/AccountGateScreen';
import {
  AccountProvider,
  accountErrorMessage,
  useAccount,
} from './AccountContext';

class FakeAccountPort implements AccountPort {
  readonly currentSession = jest.fn(() => this.session);
  readonly initialize = jest.fn(async () => {
    if (!this.session) throw { code: 'auth/no-current-user' };
    return this.session;
  });
  readonly startGuest = jest.fn(async () => {
    this.session = {
      uid: 'new-guest-uid',
      email: null,
      isAnonymous: true,
      emailVerified: false,
    };
    this.emit();
    return this.session;
  });
  readonly upgradeAnonymous = jest.fn(
    async (email: string, _password: string) => {
      this.session = {
        uid: this.session?.uid ?? 'uid-1',
        email,
        isAnonymous: false,
        emailVerified: false,
      };
      this.emit();
      return this.session;
    },
  );
  readonly sendVerificationEmail = jest.fn(async () => undefined);
  readonly reloadSession = jest.fn(async () => {
    if (!this.session) throw { code: 'auth/no-current-user' };
    this.session = { ...this.session, emailVerified: true };
    this.emit();
    return this.session;
  });
  readonly signIn = jest.fn(async (email: string, _password: string) => {
    this.session = {
      uid: 'durable-uid',
      email,
      isAnonymous: false,
      emailVerified: true,
    };
    this.emit();
    return this.session;
  });
  readonly sendPasswordResetEmail = jest.fn(
    async (_email: string) => undefined,
  );
  readonly reauthenticateWithPassword = jest.fn(
    async (_password: string) => undefined,
  );
  readonly requestDataExport = jest.fn(async () => ({
    schemaVersion: 1 as const,
    exportSubjectUid: this.session?.uid ?? 'missing',
    expiresAt: '2026-07-14T00:05:00.000Z',
    filename: 'cycle-pair-data-export-2026-07-14.json',
    singleUse: true as const,
    downloadUrl:
      'https://asia-northeast3-demo.cloudfunctions.net/downloadAccountDataExport#token=' +
      'a'.repeat(43),
  }));
  readonly beginAccountDeletion = jest.fn(async () => ({
    schemaVersion: 1 as const,
    deletionSubjectUid: this.session?.uid ?? 'missing',
    recoveryReceipt: 'r'.repeat(43),
  }));
  readonly getAccountDeletionStatus = jest.fn(
    async (): Promise<AccountDeletionStatus> => ({
      schemaVersion: 1,
      status: 'prepared',
    }),
  );
  readonly deleteMyAccount = jest.fn(async (_recoveryReceipt: string) => ({
    schemaVersion: 1 as const,
    deleted: true as const,
    completedAt: '2026-07-14T00:00:00.000Z',
  }));
  readonly purgeLocalPrivateData = jest.fn(async (_uid: string) => undefined);
  readonly signOut = jest.fn(async () => {
    this.session = null;
    this.emit();
  });

  private readonly listeners = new Set<AccountSessionListener>();

  constructor(private session: AccountSession | null) {}

  subscribe(onSession: AccountSessionListener, _onError: AccountErrorListener) {
    this.listeners.add(onSession);
    onSession(this.session);
    return () => this.listeners.delete(onSession);
  }

  emitCurrentSession() {
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener(this.session);
  }
}

function AccountHarness() {
  const { state } = useAccount();
  if (state.hydrating) return null;
  return state.session ? <AccountSettingsCard /> : <AccountGateScreen />;
}

function QuiesceHarness() {
  const { state, deleteAccount, signIn } = useAccount();
  if (state.hydrating) return null;
  return (
    <>
      <Text>{state.sessionQuiesced ? '동기화 중지' : '동기화 활성'}</Text>
      <Text testID="recovery-session-uid">
        {state.session?.uid ?? '세션 없음'}
      </Text>
      <Pressable
        testID="direct-delete-account"
        onPress={() => {
          deleteAccount().catch(() => undefined);
        }}
      />
      <Pressable
        testID="direct-recovery-sign-in"
        onPress={() => {
          signIn('recovery@example.com', 'password-123').catch(() => undefined);
        }}
      />
    </>
  );
}

function fakeSessionCleanup(): AccountSessionCleanup {
  return {
    prepareForLogout: jest.fn(async () => undefined),
    completeLogout: jest.fn(),
    recoverFromFailedLogout: jest.fn(async () => undefined),
    prepareForAccountDeletion: jest.fn(async () => ({
      notificationUnregisterFailed: false,
    })),
  };
}

describe('AccountProvider account flows', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await asyncStorageAccountSessionIntentStorage.clearAccountDeletionIntent();
  });

  afterEach(() => jest.restoreAllMocks());

  it('upgrades an anonymous user without changing the uid and verifies/reauthenticates it', async () => {
    const account = new FakeAccountPort({
      uid: 'anonymous-uid',
      email: null,
      isAnonymous: true,
      emailVerified: false,
    });
    const view = await render(
      <AccountProvider account={account}>
        <AccountHarness />
      </AccountProvider>,
    );

    await waitFor(() => expect(view.getByText('게스트 기록')).toBeTruthy());
    await fireEvent.changeText(
      view.getByLabelText('계정 전환 이메일'),
      ' USER@Example.com ',
    );
    await fireEvent.changeText(
      view.getByLabelText('계정 전환 비밀번호'),
      'password-123',
    );
    await fireEvent.changeText(
      view.getByLabelText('계정 전환 비밀번호 확인'),
      'password-123',
    );
    await fireEvent.press(view.getByTestId('account-upgrade-submit'));

    await waitFor(() =>
      expect(view.getByText('user@example.com')).toBeTruthy(),
    );
    expect(account.upgradeAnonymous).toHaveBeenCalledWith(
      'user@example.com',
      'password-123',
    );
    expect(account.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(account.reloadSession).not.toHaveBeenCalled();

    await fireEvent.press(view.getByText('인증 여부 새로고침'));
    await waitFor(() => expect(view.getByText('인증됨')).toBeTruthy());

    await fireEvent.changeText(
      view.getByLabelText('재인증 비밀번호'),
      'password-123',
    );
    await fireEvent.press(view.getByText('비밀번호 확인'));
    await waitFor(() =>
      expect(
        view.getByText('이 세션에서 본인 확인이 완료되었습니다.'),
      ).toBeTruthy(),
    );
    expect(account.reauthenticateWithPassword).toHaveBeenCalledWith(
      'password-123',
    );
  });

  it('keeps the signed-out login gate until an explicit durable login', async () => {
    const account = new FakeAccountPort({
      uid: 'durable-uid',
      email: 'user@example.com',
      isAnonymous: false,
      emailVerified: true,
    });
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const sessionCleanup = fakeSessionCleanup();
    const view = await render(
      <AccountProvider account={account} sessionCleanup={sessionCleanup}>
        <AccountHarness />
      </AccountProvider>,
    );

    await waitFor(() =>
      expect(view.getByText('user@example.com')).toBeTruthy(),
    );
    await fireEvent.press(view.getByText('로그아웃'));
    const actions = alert.mock.calls[0]?.[2] ?? [];
    const destructive = actions.find(action => action.style === 'destructive');
    await act(async () => destructive?.onPress?.());

    await waitFor(() =>
      expect(view.getByText('내 기록으로 돌아가기')).toBeTruthy(),
    );
    expect(account.initialize).toHaveBeenCalledTimes(1);
    expect(account.signOut).toHaveBeenCalledTimes(1);
    expect(sessionCleanup.completeLogout).toHaveBeenCalledWith('durable-uid');
    expect(sessionCleanup.prepareForLogout).toHaveBeenCalledTimes(1);
    expect(sessionCleanup.prepareForLogout).toHaveBeenCalledWith(
      'durable-uid',
      true,
    );
    expect(account.purgeLocalPrivateData).toHaveBeenCalledWith('durable-uid');
    expect(
      (sessionCleanup.prepareForLogout as jest.Mock)
        .mock.invocationCallOrder[0],
    ).toBeLessThan(account.signOut.mock.invocationCallOrder[0]);
    expect(account.purgeLocalPrivateData.mock.invocationCallOrder[0]).toBeLessThan(
      account.signOut.mock.invocationCallOrder[0],
    );

    await view.unmount();
    const reopened = await render(
      <AccountProvider account={account} sessionCleanup={sessionCleanup}>
        <AccountHarness />
      </AccountProvider>,
    );
    await waitFor(() =>
      expect(reopened.getByText('내 기록으로 돌아가기')).toBeTruthy(),
    );
    expect(account.initialize).toHaveBeenCalledTimes(1);

    await fireEvent.changeText(
      reopened.getByLabelText('로그인 이메일'),
      'again@example.com',
    );
    await fireEvent.changeText(
      reopened.getByLabelText('로그인 비밀번호'),
      'correct-password',
    );
    await fireEvent.press(reopened.getByTestId('account-login-submit'));
    await waitFor(() =>
      expect(reopened.getByText('again@example.com')).toBeTruthy(),
    );
    expect(account.signIn).toHaveBeenCalledWith(
      'again@example.com',
      'correct-password',
    );
    expect(account.initialize).toHaveBeenCalledTimes(1);
  });

  it('does not clear deletion storage or the durable marker after Auth sign-out succeeds', async () => {
    const account = new FakeAccountPort({
      uid: 'durable-uid',
      email: 'user@example.com',
      isAnonymous: false,
      emailVerified: true,
    });
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const clearAccountDeletionIntent = jest.fn(async () => {
      throw new Error('keychain unavailable');
    });
    const intentStorage = {
      ...asyncStorageAccountSessionIntentStorage,
      clearAccountDeletionIntent,
    };
    const view = await render(
      <AccountProvider account={account} intentStorage={intentStorage}>
        <AccountHarness />
      </AccountProvider>,
    );
    await waitFor(() =>
      expect(view.getByText('user@example.com')).toBeTruthy(),
    );

    await fireEvent.press(view.getByText('로그아웃'));
    const destructive = (alert.mock.calls.at(-1)?.[2] ?? []).find(
      action => action.style === 'destructive',
    );
    await act(async () => destructive?.onPress?.());

    await waitFor(() =>
      expect(view.getByText('내 기록으로 돌아가기')).toBeTruthy(),
    );
    expect(clearAccountDeletionIntent).not.toHaveBeenCalled();
    await expect(
      asyncStorageAccountSessionIntentStorage.wasExplicitlySignedOut(),
    ).resolves.toBe(true);

    await view.unmount();
    const reopened = await render(
      <AccountProvider account={account} intentStorage={intentStorage}>
        <AccountHarness />
      </AccountProvider>,
    );
    await waitFor(() =>
      expect(reopened.getByText('내 기록으로 돌아가기')).toBeTruthy(),
    );
    expect(account.initialize).toHaveBeenCalledTimes(1);
  });

  it('starts a fresh anonymous identity from the explicit logout gate', async () => {
    const account = new FakeAccountPort({
      uid: 'durable-uid',
      email: 'user@example.com',
      isAnonymous: false,
      emailVerified: true,
    });
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const sessionCleanup = fakeSessionCleanup();
    const view = await render(
      <AccountProvider account={account} sessionCleanup={sessionCleanup}>
        <AccountHarness />
      </AccountProvider>,
    );
    await waitFor(() =>
      expect(view.getByText('user@example.com')).toBeTruthy(),
    );

    await fireEvent.press(view.getByText('로그아웃'));
    const destructive = (alert.mock.calls[0]?.[2] ?? []).find(
      action => action.style === 'destructive',
    );
    await act(async () => destructive?.onPress?.());
    await waitFor(() =>
      expect(view.getByText('내 기록으로 돌아가기')).toBeTruthy(),
    );

    await fireEvent.press(view.getByText('새 게스트로 시작'));
    await waitFor(() => expect(view.getByText('게스트 기록')).toBeTruthy());
    expect(account.startGuest).toHaveBeenCalledTimes(1);
    expect(view.getByText('새 게스트 기록을 시작했습니다.')).toBeTruthy();
  });

  it('keeps Auth signed in when account-bound notification cleanup fails', async () => {
    const account = new FakeAccountPort({
      uid: 'durable-uid',
      email: 'user@example.com',
      isAnonymous: false,
      emailVerified: true,
    });
    const sessionCleanup = fakeSessionCleanup();
    (sessionCleanup.prepareForLogout as jest.Mock).mockRejectedValueOnce({
      code: 'functions/unavailable',
    });
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const view = await render(
      <AccountProvider account={account} sessionCleanup={sessionCleanup}>
        <AccountHarness />
      </AccountProvider>,
    );
    await waitFor(() =>
      expect(view.getByText('user@example.com')).toBeTruthy(),
    );

    await fireEvent.press(view.getByText('로그아웃'));
    const destructive = (alert.mock.calls.at(-1)?.[2] ?? []).find(
      action => action.style === 'destructive',
    );
    await act(async () => destructive?.onPress?.());

    await waitFor(() =>
      expect(view.getByText('네트워크 연결을 확인한 뒤 다시 시도해 주세요.'))
        .toBeTruthy(),
    );
    expect(account.signOut).not.toHaveBeenCalled();
    expect(sessionCleanup.recoverFromFailedLogout).toHaveBeenCalledWith(
      'durable-uid',
    );
    expect(view.getByText('user@example.com')).toBeTruthy();
  });

  it('uses non-enumerating password reset feedback and Korean safe errors', async () => {
    const account = new FakeAccountPort({
      uid: 'durable-uid',
      email: 'user@example.com',
      isAnonymous: false,
      emailVerified: true,
    });
    const view = await render(
      <AccountProvider account={account}>
        <AccountHarness />
      </AccountProvider>,
    );
    await waitFor(() =>
      expect(view.getByText('user@example.com')).toBeTruthy(),
    );

    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    await fireEvent.press(view.getByText('로그아웃'));
    const destructive = (alert.mock.calls[0]?.[2] ?? []).find(
      action => action.style === 'destructive',
    );
    await act(async () => destructive?.onPress?.());
    await fireEvent.press(view.getByText('비밀번호를 잊었어요'));
    await fireEvent.changeText(
      view.getByLabelText('로그인 이메일'),
      'reset@example.com',
    );
    await fireEvent.press(view.getByTestId('account-reset-submit'));

    await waitFor(() =>
      expect(view.getByText(/등록된 계정이라면/)).toBeTruthy(),
    );
    expect(account.sendPasswordResetEmail).toHaveBeenCalledWith(
      'reset@example.com',
    );
    expect(accountErrorMessage({ code: 'auth/invalid-credential' })).toBe(
      '이메일 또는 비밀번호가 올바르지 않습니다.',
    );
    expect(
      accountErrorMessage(new Error('contains secret password')),
    ).not.toContain('secret');
  });

  it('requires recent reauthentication before opening a single-use export download or deleting the account', async () => {
    const account = new FakeAccountPort({
      uid: 'durable-uid',
      email: 'user@example.com',
      isAnonymous: false,
      emailVerified: true,
    });
    const openUrl = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined);
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const sessionCleanup = fakeSessionCleanup();
    const view = await render(
      <AccountProvider account={account} sessionCleanup={sessionCleanup}>
        <AccountHarness />
      </AccountProvider>,
    );
    await waitFor(() =>
      expect(view.getByText('user@example.com')).toBeTruthy(),
    );

    await fireEvent.press(view.getByText('내 데이터 JSON 다운로드'));
    expect(
      view.getByText(
        '데이터 내보내기 전에 현재 비밀번호를 다시 확인해 주세요.',
      ),
    ).toBeTruthy();
    expect(account.requestDataExport).not.toHaveBeenCalled();

    await fireEvent.changeText(
      view.getByLabelText('재인증 비밀번호'),
      'current-password',
    );
    await fireEvent.press(view.getByText('비밀번호 확인'));
    await waitFor(() =>
      expect(
        view.getByText('이 세션에서 본인 확인이 완료되었습니다.'),
      ).toBeTruthy(),
    );

    await fireEvent.press(view.getByText('내 데이터 JSON 다운로드'));
    await waitFor(() =>
      expect(account.requestDataExport).toHaveBeenCalledTimes(1),
    );
    expect(openUrl).toHaveBeenCalledWith(
      expect.stringMatching(
        /^https:\/\/asia-northeast3-demo\.cloudfunctions\.net\/downloadAccountDataExport#token=[A-Za-z0-9_-]{43}$/,
      ),
    );
    expect(
      view.getByText(/JSON은 서버에 저장되지 않으며/),
    ).toBeTruthy();

    await fireEvent.press(view.getByText('계정과 서버 데이터 영구 삭제'));
    const destructive = (alert.mock.calls.at(-1)?.[2] ?? []).find(
      action => action.style === 'destructive',
    );
    await act(async () => destructive?.onPress?.());
    await waitFor(() =>
      expect(view.getByText('내 기록으로 돌아가기')).toBeTruthy(),
    );
    expect(account.deleteMyAccount).toHaveBeenCalledTimes(1);
    expect(account.beginAccountDeletion).toHaveBeenCalledTimes(1);
    expect(account.deleteMyAccount).toHaveBeenCalledWith('r'.repeat(43));
    expect(sessionCleanup.prepareForAccountDeletion).toHaveBeenCalledTimes(1);
    expect(
      (sessionCleanup.prepareForAccountDeletion as jest.Mock)
        .mock.invocationCallOrder[0],
    ).toBeLessThan(account.deleteMyAccount.mock.invocationCallOrder[0]);
    expect(account.purgeLocalPrivateData).toHaveBeenCalledWith('durable-uid');
    expect(account.signOut).toHaveBeenCalledTimes(1);
    expect(
      view.getByText('계정과 이 기기에 저장된 데이터를 삭제했습니다.'),
    ).toBeTruthy();
  });

  it('lets an anonymous user permanently erase guest data without password reauthentication', async () => {
    const account = new FakeAccountPort({
      uid: 'anonymous-delete-uid',
      email: null,
      isAnonymous: true,
      emailVerified: false,
    });
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const view = await render(
      <AccountProvider account={account}>
        <AccountHarness />
      </AccountProvider>,
    );
    await waitFor(() => expect(view.getByText('게스트 기록')).toBeTruthy());

    await fireEvent.press(
      view.getByText('게스트 기록과 서버 데이터 영구 삭제'),
    );
    expect(alert).toHaveBeenLastCalledWith(
      '게스트 기록을 영구 삭제할까요?',
      expect.stringContaining('게스트 계정이 삭제'),
      expect.any(Array),
    );
    const destructive = (alert.mock.calls.at(-1)?.[2] ?? []).find(
      action => action.style === 'destructive',
    );
    await act(async () => destructive?.onPress?.());

    await waitFor(() =>
      expect(view.getByText('내 기록으로 돌아가기')).toBeTruthy(),
    );
    expect(account.reauthenticateWithPassword).not.toHaveBeenCalled();
    expect(account.deleteMyAccount).toHaveBeenCalledTimes(1);
    expect(account.beginAccountDeletion).toHaveBeenCalledTimes(1);
    expect(account.purgeLocalPrivateData).toHaveBeenCalledWith(
      'anonymous-delete-uid',
    );
    expect(
      view.getByText('계정과 이 기기에 저장된 데이터를 삭제했습니다.'),
    ).toBeTruthy();

    await fireEvent.press(view.getByText('새 게스트로 시작'));
    await waitFor(() => expect(view.getByText('게스트 기록')).toBeTruthy());
    expect(account.startGuest).toHaveBeenCalledTimes(1);
  });

  it('keeps an uncertain deletion quiesced and allows a safe retry', async () => {
    const account = new FakeAccountPort({
      uid: 'anonymous-retry-uid',
      email: null,
      isAnonymous: true,
      emailVerified: false,
    });
    account.deleteMyAccount.mockRejectedValueOnce({
      code: 'functions/unavailable',
    });
    const sessionCleanup = fakeSessionCleanup();
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);
    const view = await render(
      <AccountProvider account={account} sessionCleanup={sessionCleanup}>
        <AccountHarness />
      </AccountProvider>,
    );
    await waitFor(() => expect(view.getByText('게스트 기록')).toBeTruthy());

    await fireEvent.press(
      view.getByText('게스트 기록과 서버 데이터 영구 삭제'),
    );
    let destructive = (alert.mock.calls.at(-1)?.[2] ?? []).find(
      action => action.style === 'destructive',
    );
    await act(async () => destructive?.onPress?.());
    await waitFor(() =>
      expect(
        view.getByText(
          '계정 삭제 완료를 확인하지 못했습니다. 데이터 재생성을 막기 위해 동기화를 중지했습니다. 계정 삭제를 다시 시도해 주세요.',
        ),
      ).toBeTruthy(),
    );
    expect(account.purgeLocalPrivateData).not.toHaveBeenCalled();
    expect(account.signOut).not.toHaveBeenCalled();
    expect(sessionCleanup.recoverFromFailedLogout).not.toHaveBeenCalled();

    await fireEvent.press(
      view.getByText('게스트 기록과 서버 데이터 영구 삭제'),
    );
    destructive = (alert.mock.calls.at(-1)?.[2] ?? []).find(
      action => action.style === 'destructive',
    );
    await act(async () => destructive?.onPress?.());
    await waitFor(() =>
      expect(view.getByText('내 기록으로 돌아가기')).toBeTruthy(),
    );
    expect(account.deleteMyAccount).toHaveBeenCalledTimes(2);
    expect(account.purgeLocalPrivateData).toHaveBeenCalledWith(
      'anonymous-retry-uid',
    );
  });

  it('restores an uncertain deletion barrier without remounting account data after restart', async () => {
    const account = new FakeAccountPort({
      uid: 'restart-pending-uid',
      email: null,
      isAnonymous: true,
      emailVerified: false,
    });
    account.deleteMyAccount.mockRejectedValueOnce({
      code: 'functions/unavailable',
    });
    const sessionCleanup = fakeSessionCleanup();
    const first = await render(
      <AccountProvider account={account} sessionCleanup={sessionCleanup}>
        <QuiesceHarness />
      </AccountProvider>,
    );
    await waitFor(() => expect(first.getByText('동기화 활성')).toBeTruthy());

    await fireEvent.press(first.getByTestId('direct-delete-account'));
    await waitFor(() => expect(first.getByText('동기화 중지')).toBeTruthy());
    expect(account.purgeLocalPrivateData).not.toHaveBeenCalled();
    await first.unmount();

    const reopened = await render(
      <AccountProvider account={account} sessionCleanup={sessionCleanup}>
        <QuiesceHarness />
      </AccountProvider>,
    );
    await waitFor(() =>
      expect(reopened.getByText('동기화 중지')).toBeTruthy(),
    );
    expect(account.initialize).toHaveBeenCalledTimes(1);
    expect(account.currentSession).toHaveBeenCalled();
    expect(account.purgeLocalPrivateData).not.toHaveBeenCalled();
    await expect(
      asyncStorageAccountSessionIntentStorage.loadAccountDeletionIntent(),
    ).resolves.toMatchObject({
      uid: 'restart-pending-uid',
      phase: 'deletion-pending',
    });
  });

  it('retries server-confirmed local purge on restart before showing the login gate', async () => {
    const account = new FakeAccountPort({
      uid: 'restart-cleanup-uid',
      email: null,
      isAnonymous: true,
      emailVerified: false,
    });
    account.purgeLocalPrivateData.mockRejectedValueOnce(
      new Error('keychain unavailable'),
    );
    const first = await render(
      <AccountProvider
        account={account}
        sessionCleanup={fakeSessionCleanup()}>
        <QuiesceHarness />
      </AccountProvider>,
    );
    await waitFor(() => expect(first.getByText('동기화 활성')).toBeTruthy());

    await fireEvent.press(first.getByTestId('direct-delete-account'));
    await waitFor(() => expect(first.getByText('동기화 중지')).toBeTruthy());
    expect(account.deleteMyAccount).toHaveBeenCalledTimes(1);
    await expect(
      asyncStorageAccountSessionIntentStorage.loadAccountDeletionIntent(),
    ).resolves.toMatchObject({ phase: 'local-cleanup-pending' });
    await first.unmount();

    const reopened = await render(
      <AccountProvider
        account={account}
        sessionCleanup={fakeSessionCleanup()}>
        <AccountHarness />
      </AccountProvider>,
    );
    await waitFor(() =>
      expect(reopened.getByText('내 기록으로 돌아가기')).toBeTruthy(),
    );
    expect(account.initialize).toHaveBeenCalledTimes(1);
    expect(account.purgeLocalPrivateData).toHaveBeenCalledTimes(2);
    expect(account.signOut).toHaveBeenCalledTimes(1);
    await expect(
      asyncStorageAccountSessionIntentStorage.loadAccountDeletionIntent(),
    ).resolves.toBeNull();
  });

  it('fails closed when the durable deletion intent cannot be read, then only releases after a successful recheck', async () => {
    const account = new FakeAccountPort({
      uid: 'intent-read-uid',
      email: 'intent@example.com',
      isAnonymous: false,
      emailVerified: true,
    });
    const loadAccountDeletionIntent = jest
      .fn()
      .mockRejectedValueOnce(new Error('keychain unavailable'))
      .mockResolvedValue(null);
    const intentStorage = {
      ...asyncStorageAccountSessionIntentStorage,
      loadAccountDeletionIntent,
    };
    const view = await render(
      <AccountProvider account={account} intentStorage={intentStorage}>
        <QuiesceHarness />
      </AccountProvider>,
    );

    await waitFor(() => expect(view.getByText('동기화 중지')).toBeTruthy());
    expect(account.initialize).not.toHaveBeenCalled();
    expect(view.getByTestId('recovery-session-uid').props.children).toBe(
      'intent-read-uid',
    );

    await fireEvent.press(view.getByTestId('direct-delete-account'));
    await waitFor(() => expect(view.getByText('동기화 활성')).toBeTruthy());
    expect(account.deleteMyAccount).not.toHaveBeenCalled();
    expect(account.purgeLocalPrivateData).not.toHaveBeenCalled();
  });

  it('preserves deletion-pending without Auth and completes only after the same UID signs in', async () => {
    await asyncStorageAccountSessionIntentStorage.markAccountDeletionPending(
      'durable-uid',
      'r'.repeat(43),
    );
    const account = new FakeAccountPort(null);
    const view = await render(
      <AccountProvider
        account={account}
        sessionCleanup={fakeSessionCleanup()}>
        <QuiesceHarness />
      </AccountProvider>,
    );

    await waitFor(() => expect(view.getByText('동기화 중지')).toBeTruthy());
    expect(view.getByTestId('recovery-session-uid').props.children).toBe(
      '세션 없음',
    );
    expect(account.initialize).not.toHaveBeenCalled();
    expect(account.purgeLocalPrivateData).not.toHaveBeenCalled();
    await expect(
      asyncStorageAccountSessionIntentStorage.loadAccountDeletionIntent(),
    ).resolves.toMatchObject({
      uid: 'durable-uid',
      phase: 'deletion-pending',
    });

    await fireEvent.press(view.getByTestId('direct-recovery-sign-in'));
    await waitFor(() =>
      expect(view.getByTestId('recovery-session-uid').props.children).toBe(
        'durable-uid',
      ),
    );
    expect(view.getByText('동기화 중지')).toBeTruthy();

    await fireEvent.press(view.getByTestId('direct-delete-account'));
    await waitFor(() => expect(view.getByText('동기화 활성')).toBeTruthy());
    expect(account.deleteMyAccount).toHaveBeenCalledTimes(1);
    expect(account.purgeLocalPrivateData).toHaveBeenCalledWith('durable-uid');
    await expect(
      asyncStorageAccountSessionIntentStorage.loadAccountDeletionIntent(),
    ).resolves.toBeNull();
  });

  it('recovers locally from a lost deletion response after Auth is already gone', async () => {
    const receipt = 'r'.repeat(43);
    await asyncStorageAccountSessionIntentStorage.markAccountDeletionPending(
      'deleted-uid',
      receipt,
    );
    const account = new FakeAccountPort(null);
    account.getAccountDeletionStatus.mockResolvedValueOnce({
      schemaVersion: 1,
      status: 'completed',
      completedAt: '2026-07-14T00:00:00.000Z',
    });

    const view = await render(
      <AccountProvider account={account} sessionCleanup={fakeSessionCleanup()}>
        <AccountHarness />
      </AccountProvider>,
    );

    await waitFor(() =>
      expect(view.getByText('내 기록으로 돌아가기')).toBeTruthy(),
    );
    expect(account.getAccountDeletionStatus).toHaveBeenCalledWith(
      'deleted-uid',
      receipt,
    );
    expect(account.deleteMyAccount).not.toHaveBeenCalled();
    expect(account.initialize).not.toHaveBeenCalled();
    expect(account.purgeLocalPrivateData).toHaveBeenCalledWith('deleted-uid');
    await expect(
      asyncStorageAccountSessionIntentStorage.loadAccountDeletionIntent(),
    ).resolves.toBeNull();
  });

  it('waits for the server finalizer instead of replaying an in-progress deletion', async () => {
    const receipt = 'r'.repeat(43);
    await asyncStorageAccountSessionIntentStorage.markAccountDeletionPending(
      'pending-server-uid',
      receipt,
    );
    const account = new FakeAccountPort({
      uid: 'pending-server-uid',
      email: 'pending@example.com',
      isAnonymous: false,
      emailVerified: true,
    });
    account.getAccountDeletionStatus.mockResolvedValue({
      schemaVersion: 1,
      status: 'pending',
    });
    const view = await render(
      <AccountProvider account={account} sessionCleanup={fakeSessionCleanup()}>
        <QuiesceHarness />
      </AccountProvider>,
    );

    await waitFor(() => expect(view.getByText('동기화 중지')).toBeTruthy());
    await fireEvent.press(view.getByTestId('direct-delete-account'));
    await waitFor(() =>
      expect(account.getAccountDeletionStatus).toHaveBeenCalledTimes(2),
    );
    expect(account.deleteMyAccount).not.toHaveBeenCalled();
    expect(account.purgeLocalPrivateData).not.toHaveBeenCalled();
  });

  it('keeps the write barrier closed when Auth re-emits the same user during deletion', async () => {
    const account = new FakeAccountPort({
      uid: 'anonymous-quiesced-uid',
      email: null,
      isAnonymous: true,
      emailVerified: false,
    });
    let rejectDeletion: ((reason: unknown) => void) | undefined;
    account.deleteMyAccount.mockImplementationOnce(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectDeletion = reject;
        }),
    );
    const view = await render(
      <AccountProvider
        account={account}
        sessionCleanup={fakeSessionCleanup()}>
        <QuiesceHarness />
      </AccountProvider>,
    );
    await waitFor(() => expect(view.getByText('동기화 활성')).toBeTruthy());

    await fireEvent.press(view.getByTestId('direct-delete-account'));
    await waitFor(() => expect(view.getByText('동기화 중지')).toBeTruthy());
    await act(async () => account.emitCurrentSession());
    expect(view.getByText('동기화 중지')).toBeTruthy();

    await act(async () => rejectDeletion?.({ code: 'functions/unavailable' }));
    await waitFor(() => expect(view.getByText('동기화 중지')).toBeTruthy());
  });
});
