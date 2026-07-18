import React, {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccountOperationError,
  type AccountExportDownloadTicket,
  type AccountPort,
  type AccountSession,
} from '../../domain/account/AccountPort';
import type { AccountSessionCleanup } from '../../domain/account/AccountSessionCleanup';
import {
  asyncStorageAccountSessionIntentStorage,
  type AccountSessionIntentStorage,
} from '../../platform/local/AccountSessionIntentStorage';
import type { SafeCrashReporter } from '../../platform/observability/SafeCrashReporter';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AccountState {
  readonly hydrating: boolean;
  readonly busy: boolean;
  readonly sessionQuiesced: boolean;
  readonly session: AccountSession | null;
  readonly error: string | null;
  readonly notice: string | null;
  readonly reauthenticatedAt: string | null;
  readonly deletionRecovery:
    | 'none'
    | 'intent-unreadable'
    | 'deletion-preparing'
    | 'deletion-pending'
    | 'local-cleanup-pending';
}

export interface AccountContextValue {
  readonly state: AccountState;
  clearFeedback(): void;
  startGuest(): Promise<boolean>;
  upgradeAnonymous(email: string, password: string): Promise<boolean>;
  resendVerification(): Promise<boolean>;
  refreshVerification(): Promise<boolean>;
  signIn(email: string, password: string): Promise<boolean>;
  requestPasswordReset(email: string): Promise<boolean>;
  reauthenticate(password: string): Promise<boolean>;
  requestDataExport(): Promise<AccountExportDownloadTicket | null>;
  deleteAccount(): Promise<boolean>;
  logout(): Promise<boolean>;
}

function errorCode(error: unknown): string {
  if (error instanceof AccountOperationError) return error.code;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code).toLowerCase();
  }
  return '';
}

export function accountErrorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code.includes('invalid-email'))
    return '이메일 주소 형식을 확인해 주세요.';
  if (code.includes('email-already-in-use'))
    return '이미 사용 중인 이메일입니다. 로그인해 주세요.';
  if (code.includes('credential-already-in-use'))
    return '이미 다른 계정에 연결된 로그인 정보입니다.';
  if (code.includes('weak-password') || code.includes('password-too-short')) {
    return '비밀번호는 8자 이상으로 입력해 주세요.';
  }
  if (code.includes('wrong-password') || code.includes('invalid-credential')) {
    return '이메일 또는 비밀번호가 올바르지 않습니다.';
  }
  if (code.includes('user-not-found'))
    return '이메일 또는 비밀번호가 올바르지 않습니다.';
  if (code.includes('user-disabled'))
    return '사용이 중지된 계정입니다. 고객지원에 문의해 주세요.';
  if (code.includes('too-many-requests'))
    return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (
    code.includes('network-request-failed') ||
    code.includes('network') ||
    code.includes('unavailable')
  ) {
    return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
  }
  if (code.includes('requires-recent-login'))
    return '보호된 작업을 계속하려면 비밀번호를 다시 확인해 주세요.';
  if (code.includes('failed-precondition'))
    return '비밀번호를 다시 확인한 뒤 민감한 작업을 진행해 주세요.';
  if (code.includes('operation-not-allowed'))
    return '현재 이메일 로그인을 사용할 수 없습니다. 운영 설정을 확인해 주세요.';
  if (code.includes('email-account-required'))
    return '이메일 계정으로 전환한 뒤 사용할 수 있습니다.';
  if (code.includes('not-anonymous'))
    return '이미 복구 가능한 계정으로 전환되었습니다.';
  if (code.includes('no-current-user'))
    return '로그인 상태가 만료되었습니다. 다시 로그인해 주세요.';
  if (code.includes('uid-changed'))
    return '계정 전환 중 사용자 식별자가 변경되어 중단했습니다.';
  if (code.includes('deletion-subject-mismatch'))
    return '삭제를 요청한 계정과 다른 계정입니다. 동일한 계정으로 로그인해 주세요.';
  if (code.includes('deletion-recovery-active'))
    return '진행 중인 계정 삭제 상태를 먼저 완료해 주세요.';
  if (code.includes('pending-offline-changes'))
    return '동기화되지 않은 기록이 남아 있어 로그아웃하지 않았습니다. 네트워크 연결 후 다시 시도해 주세요.';
  if (code.includes('invalid-export-response'))
    return '내보내기 데이터 형식을 확인하지 못했습니다.';
  if (code.includes('invalid-deletion-response'))
    return '계정 삭제 완료 응답을 확인하지 못했습니다.';
  return '계정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string) {
  if (!EMAIL_PATTERN.test(email)) {
    throw new AccountOperationError('account/invalid-email');
  }
}

const AccountContext = createContext<AccountContextValue | null>(null);

const noopCrashReporter: SafeCrashReporter = {
  async setEnabled() {},
  async recordFailure() {},
};

const noopSessionCleanup: AccountSessionCleanup = {
  async prepareForLogout() {},
  completeLogout() {},
  async recoverFromFailedLogout() {},
  async prepareForAccountDeletion() {
    return { notificationUnregisterFailed: false };
  },
};

export function AccountProvider({
  account,
  intentStorage = asyncStorageAccountSessionIntentStorage,
  crashReporter = noopCrashReporter,
  sessionCleanup = noopSessionCleanup,
  children,
}: PropsWithChildren<{
  account: AccountPort;
  intentStorage?: AccountSessionIntentStorage;
  crashReporter?: SafeCrashReporter;
  sessionCleanup?: AccountSessionCleanup;
}>) {
  const [state, setState] = useState<AccountState>({
    hydrating: true,
    busy: false,
    sessionQuiesced: false,
    session: null,
    error: null,
    notice: null,
    reauthenticatedAt: null,
    deletionRecovery: 'none',
  });
  const explicitSignOut = useRef(false);
  const intentResolved = useRef(false);

  const applyError = useCallback(
    (error: unknown) => {
      setState(current => ({
        ...current,
        busy: false,
        error: accountErrorMessage(error),
        notice: null,
      }));
      crashReporter
        .recordFailure('unknown-failure', {
          surface: 'auth',
          operation: 'account-operation',
          retryable: true,
        })
        .catch(() => undefined);
    },
    [crashReporter],
  );

  const finishLocalAccountExit = useCallback(
    async (uid: string) => {
      await account.purgeLocalPrivateData(uid);
      await intentStorage.markExplicitlySignedOut();
      explicitSignOut.current = true;
      try {
        await account.signOut();
      } catch {
        // A server-side account deletion can invalidate the native Auth user
        // before local sign-out. The durable explicit gate still prevents a
        // cached identity from being remounted on the next launch.
      }
      await intentStorage.clearAccountDeletionIntent();
      setState(current => ({
        ...current,
        hydrating: false,
        busy: false,
        session: null,
        sessionQuiesced: false,
        reauthenticatedAt: null,
        deletionRecovery: 'none',
        error: null,
        notice: '계정과 이 기기에 저장된 데이터를 삭제했습니다.',
      }));
    },
    [account, intentStorage],
  );

  useEffect(() => {
    let active = true;
    const stop = account.subscribe(
      session => {
        if (!active) return;
        if (!intentResolved.current || (explicitSignOut.current && session))
          return;
        setState(current => ({
          ...current,
          session,
          // Native Auth can re-emit the same user while account deletion or
          // logout is draining writes. Do not let that duplicate callback
          // remount UID-bound providers and reopen their watchers.
          sessionQuiesced:
            current.deletionRecovery !== 'none'
              ? true
              : session && current.session?.uid === session.uid
                ? current.sessionQuiesced
                : false,
          reauthenticatedAt:
            session && current.session?.uid === session.uid
              ? current.reauthenticatedAt
              : null,
        }));
      },
      error => {
        if (active) applyError(error);
      },
    );
    Promise.all([
      intentStorage.wasExplicitlySignedOut(),
      intentStorage.loadAccountDeletionIntent(),
    ])
      .then(async ([signedOut, deletionIntent]) => {
        if (!active) return;
        explicitSignOut.current = signedOut;
        intentResolved.current = true;
        if (deletionIntent) {
          const nativeSession = account.currentSession();
          if (deletionIntent.phase === 'local-cleanup-pending') {
            try {
              await account.purgeLocalPrivateData(deletionIntent.uid);
            } catch {
              if (!active) return;
              setState(current => ({
                ...current,
                hydrating: false,
                session:
                  nativeSession?.uid === deletionIntent.uid
                    ? nativeSession
                    : null,
                sessionQuiesced: true,
                deletionRecovery: 'local-cleanup-pending',
                error:
                  '서버 계정은 삭제했지만 기기의 보안 저장소 정리를 완료하지 못했습니다. 다시 시도해 주세요.',
                notice: null,
              }));
              return;
            }
            await intentStorage.markExplicitlySignedOut();
            explicitSignOut.current = true;
            await account.signOut().catch(() => undefined);
            await intentStorage.clearAccountDeletionIntent();
            if (!active) return;
            setState(current => ({
              ...current,
              hydrating: false,
              session: null,
              sessionQuiesced: false,
              deletionRecovery: 'none',
              error: null,
              notice: '중단됐던 기기 데이터 삭제를 완료했습니다.',
            }));
            return;
          }

          let deletionServerStatus: 'prepared' | 'pending' | null = null;
          if (deletionIntent.phase === 'deletion-pending') {
            try {
              const status = await account.getAccountDeletionStatus(
                deletionIntent.uid,
                deletionIntent.recoveryReceipt,
              );
              if (status.status === 'completed') {
                await intentStorage.markAccountDeletionLocalCleanupPending(
                  deletionIntent.uid,
                  deletionIntent.recoveryReceipt,
                );
                try {
                  await finishLocalAccountExit(deletionIntent.uid);
                } catch {
                  if (!active) return;
                  setState(current => ({
                    ...current,
                    hydrating: false,
                    session: null,
                    sessionQuiesced: true,
                    deletionRecovery: 'local-cleanup-pending',
                    error:
                      '서버 계정은 삭제했지만 기기의 보안 저장소 정리를 완료하지 못했습니다. 다시 시도해 주세요.',
                    notice: null,
                  }));
                }
                return;
              }
              deletionServerStatus = status.status;
            } catch {
              // The durable receipt remains the privacy barrier. A later app
              // launch or explicit retry can query the server again.
            }
          }

          if (nativeSession && nativeSession.uid !== deletionIntent.uid) {
            // A different persisted Auth identity must not replace the deletion
            // subject. Sign it out without clearing the durable deletion intent.
            await account.signOut().catch(() => undefined);
          }
          setState(current => ({
            ...current,
            hydrating: false,
            session:
              nativeSession?.uid === deletionIntent.uid ? nativeSession : null,
            sessionQuiesced: true,
            deletionRecovery:
              deletionServerStatus === 'prepared'
                ? 'deletion-preparing'
                : deletionIntent.phase,
            error:
              deletionIntent.phase === 'deletion-preparing' ||
              deletionServerStatus === 'prepared'
                ? nativeSession?.uid === deletionIntent.uid
                  ? '계정 삭제 준비를 완료하지 못했습니다. 계정 삭제를 다시 시도해 주세요.'
                  : '삭제를 요청한 동일한 이메일 계정으로 로그인한 뒤 계정 삭제를 다시 시도해 주세요.'
                : '서버에서 계정 삭제를 처리 중입니다. 잠시 후 상태 확인을 다시 시도해 주세요.',
            notice: null,
          }));
          return;
        }
        if (signedOut) {
          setState(current => ({
            ...current,
            hydrating: false,
            session: null,
              sessionQuiesced: false,
              deletionRecovery: 'none',
            error: null,
          }));
          return;
        }
        const session = await account.initialize();
        if (!active) return;
        setState(current => ({
          ...current,
          hydrating: false,
          session,
          sessionQuiesced: false,
          deletionRecovery: 'none',
          error: null,
        }));
      })
      .catch(() => {
        if (!active) return;
        const nativeSession = account.currentSession();
        setState(current => ({
          ...current,
          hydrating: false,
          session: nativeSession,
          sessionQuiesced: true,
          deletionRecovery: 'intent-unreadable',
          error:
            '계정 삭제 상태를 보안 저장소에서 확인하지 못했습니다. 상태 확인을 다시 시도해 주세요.',
          notice: null,
        }));
      });
    return () => {
      active = false;
      stop();
    };
  }, [account, applyError, finishLocalAccountExit, intentStorage]);

  const clearFeedback = useCallback(() => {
    setState(current => ({ ...current, error: null, notice: null }));
  }, []);

  const startGuest = useCallback(async () => {
    try {
      const pendingIntent = await intentStorage.loadAccountDeletionIntent();
      if (pendingIntent || state.deletionRecovery !== 'none') {
        throw new AccountOperationError('account/deletion-recovery-active');
      }
      setState(current => ({
        ...current,
        busy: true,
        error: null,
        notice: null,
      }));
      const session = await account.startGuest();
      try {
        await intentStorage.clearExplicitSignOut();
      } catch (error) {
        // Do not leave an unintentional guest session behind when the startup
        // intent could not be persisted. A retry can then start cleanly.
        await account.signOut().catch(() => undefined);
        throw error;
      }
      explicitSignOut.current = false;
      setState(current => ({
        ...current,
        busy: false,
        session,
        sessionQuiesced: false,
        reauthenticatedAt: null,
        notice: '새 게스트 기록을 시작했습니다.',
      }));
      return true;
    } catch (error) {
      applyError(error);
      return false;
    }
  }, [account, applyError, intentStorage, state.deletionRecovery]);

  const upgradeAnonymous = useCallback(
    async (rawEmail: string, password: string) => {
      const email = normalizedEmail(rawEmail);
      try {
        validateEmail(email);
        if (password.length < 8) {
          throw new AccountOperationError('account/password-too-short');
        }
        setState(current => ({
          ...current,
          busy: true,
          error: null,
          notice: null,
        }));
        const session = await account.upgradeAnonymous(email, password);
        explicitSignOut.current = false;
        await intentStorage.clearExplicitSignOut();
        setState(current => ({ ...current, session }));
        try {
          await account.sendVerificationEmail();
          setState(current => ({
            ...current,
            busy: false,
            notice: '계정 전환이 완료되어 인증 메일을 보냈습니다.',
          }));
        } catch (verificationError) {
          setState(current => ({
            ...current,
            busy: false,
            error: accountErrorMessage(verificationError),
            notice: '계정 전환은 완료되었습니다. 인증 메일을 다시 보내 주세요.',
          }));
        }
        return true;
      } catch (error) {
        applyError(error);
        return false;
      }
    },
    [account, applyError, intentStorage],
  );

  const resendVerification = useCallback(async () => {
    try {
      setState(current => ({
        ...current,
        busy: true,
        error: null,
        notice: null,
      }));
      await account.sendVerificationEmail();
      setState(current => ({
        ...current,
        busy: false,
        notice: '인증 메일을 다시 보냈습니다.',
      }));
      return true;
    } catch (error) {
      applyError(error);
      return false;
    }
  }, [account, applyError]);

  const refreshVerification = useCallback(async () => {
    try {
      setState(current => ({
        ...current,
        busy: true,
        error: null,
        notice: null,
      }));
      const session = await account.reloadSession();
      setState(current => ({
        ...current,
        busy: false,
        session,
        notice: session.emailVerified
          ? '이메일 인증을 확인했습니다.'
          : '아직 인증되지 않았습니다. 메일의 링크를 연 뒤 다시 확인해 주세요.',
      }));
      return session.emailVerified;
    } catch (error) {
      applyError(error);
      return false;
    }
  }, [account, applyError]);

  const signIn = useCallback(
    async (rawEmail: string, password: string) => {
      const email = normalizedEmail(rawEmail);
      try {
        validateEmail(email);
        if (!password)
          throw new AccountOperationError('auth/invalid-credential');
        const pendingIntent = await intentStorage.loadAccountDeletionIntent();
        if (pendingIntent?.phase === 'local-cleanup-pending') {
          throw new AccountOperationError('account/deletion-recovery-active');
        }
        setState(current => ({
          ...current,
          busy: true,
          error: null,
          notice: null,
        }));
        const session = await account.signIn(email, password);
        if (pendingIntent && pendingIntent.uid !== session.uid) {
          await account.signOut().catch(() => undefined);
          throw new AccountOperationError('account/deletion-subject-mismatch');
        }
        explicitSignOut.current = false;
        await intentStorage.clearExplicitSignOut();
        intentResolved.current = true;
        setState(current => ({
          ...current,
          busy: false,
          session,
          sessionQuiesced: pendingIntent !== null,
          deletionRecovery: pendingIntent?.phase ?? 'none',
          reauthenticatedAt: null,
          notice: pendingIntent
            ? '삭제를 요청한 계정을 확인했습니다. 계정 삭제를 다시 시도해 주세요.'
            : '로그인했습니다.',
        }));
        return true;
      } catch (error) {
        applyError(error);
        return false;
      }
    },
    [account, applyError, intentStorage],
  );

  const requestPasswordReset = useCallback(
    async (rawEmail: string) => {
      const email = normalizedEmail(rawEmail);
      try {
        validateEmail(email);
        setState(current => ({
          ...current,
          busy: true,
          error: null,
          notice: null,
        }));
        await account.sendPasswordResetEmail(email);
        setState(current => ({
          ...current,
          busy: false,
          notice: '등록된 계정이라면 비밀번호 재설정 메일이 전송됩니다.',
        }));
        return true;
      } catch (error) {
        applyError(error);
        return false;
      }
    },
    [account, applyError],
  );

  const reauthenticate = useCallback(
    async (password: string) => {
      try {
        if (!password)
          throw new AccountOperationError('auth/invalid-credential');
        setState(current => ({
          ...current,
          busy: true,
          error: null,
          notice: null,
        }));
        await account.reauthenticateWithPassword(password);
        const now = new Date().toISOString();
        setState(current => ({
          ...current,
          busy: false,
          reauthenticatedAt: now,
          notice: '비밀번호를 확인했습니다. 민감한 작업을 계속할 수 있습니다.',
        }));
        return true;
      } catch (error) {
        applyError(error);
        return false;
      }
    },
    [account, applyError],
  );

  const requestDataExport = useCallback(async () => {
    try {
      if (state.session?.isAnonymous) {
        throw new AccountOperationError('account/email-account-required');
      }
      const reauthenticatedAt = state.reauthenticatedAt
        ? Date.parse(state.reauthenticatedAt)
        : Number.NaN;
      if (
        !Number.isFinite(reauthenticatedAt) ||
        Date.now() - reauthenticatedAt > 5 * 60 * 1_000
      ) {
        throw new AccountOperationError('auth/requires-recent-login');
      }
      setState(current => ({
        ...current,
        busy: true,
        error: null,
        notice: null,
      }));
      const ticket = await account.requestDataExport();
      setState(current => ({
        ...current,
        busy: false,
        notice: '5분 동안 유효한 단회 다운로드 링크를 만들었습니다.',
      }));
      return ticket;
    } catch (error) {
      applyError(error);
      return null;
    }
  }, [
    account,
    applyError,
    state.reauthenticatedAt,
    state.session?.isAnonymous,
  ]);

  const deleteAccount = useCallback(async () => {
    let preparationCallableStarted = false;
    let deletionCallableStarted = false;
    let deletionIntentCreated = false;
    let serverDeletionConfirmed = false;
    let recoveryReceipt: string | null = null;
    try {
      const pendingIntent = await intentStorage.loadAccountDeletionIntent();
      if (
        !pendingIntent &&
        state.deletionRecovery === 'intent-unreadable'
      ) {
        const signedOut = await intentStorage.wasExplicitlySignedOut();
        const nativeSession = account.currentSession();
        explicitSignOut.current = signedOut;
        intentResolved.current = true;
        setState(current => ({
          ...current,
          busy: false,
          session: signedOut ? null : nativeSession,
          sessionQuiesced: false,
          deletionRecovery: 'none',
          error: null,
          notice: '계정 삭제 상태를 다시 확인했습니다.',
        }));
        return true;
      }
      const deletingSession = state.session;
      if (pendingIntent?.phase === 'local-cleanup-pending') {
        serverDeletionConfirmed = true;
        recoveryReceipt = pendingIntent.recoveryReceipt;
        setState(current => ({
          ...current,
          busy: true,
          sessionQuiesced: true,
          deletionRecovery: 'local-cleanup-pending',
          error: null,
          notice: null,
        }));
        await finishLocalAccountExit(pendingIntent.uid);
        return true;
      }
      if (pendingIntent?.phase === 'deletion-pending') {
        recoveryReceipt = pendingIntent.recoveryReceipt;
        try {
          const status = await account.getAccountDeletionStatus(
            pendingIntent.uid,
            recoveryReceipt,
          );
          if (status.status === 'completed') {
            serverDeletionConfirmed = true;
            await intentStorage.markAccountDeletionLocalCleanupPending(
              pendingIntent.uid,
              recoveryReceipt,
            );
            setState(current => ({
              ...current,
              busy: true,
              sessionQuiesced: true,
              deletionRecovery: 'local-cleanup-pending',
              error: null,
              notice: null,
            }));
            await finishLocalAccountExit(pendingIntent.uid);
            return true;
          }
          if (status.status === 'pending' || !state.session) {
            setState(current => ({
              ...current,
              busy: false,
              sessionQuiesced: true,
              deletionRecovery:
                status.status === 'prepared'
                  ? 'deletion-preparing'
                  : 'deletion-pending',
              error:
                status.status === 'prepared'
                  ? '삭제를 요청한 동일한 이메일 계정으로 로그인한 뒤 계정 삭제를 다시 시도해 주세요.'
                  : '서버에서 계정 삭제를 처리 중입니다. 잠시 후 상태 확인을 다시 시도해 주세요.',
              notice: null,
            }));
            return false;
          }
        } catch (statusError) {
          if (!state.session) {
            applyError(statusError);
            setState(current => ({
              ...current,
              sessionQuiesced: true,
              deletionRecovery: 'deletion-pending',
            }));
            return false;
          }
        }
      }
      if (!deletingSession) {
        if (pendingIntent) {
          setState(current => ({
            ...current,
            busy: false,
            sessionQuiesced: true,
            deletionRecovery: pendingIntent.phase,
            error:
              pendingIntent.phase === 'deletion-preparing'
                ? '삭제를 요청한 동일한 이메일 계정으로 로그인한 뒤 계정 삭제를 다시 시도해 주세요.'
                : '서버에서 계정 삭제를 처리 중입니다. 잠시 후 상태 확인을 다시 시도해 주세요.',
            notice: null,
          }));
          return false;
        }
        throw new AccountOperationError('account/no-current-user');
      }
      if (pendingIntent && pendingIntent.uid !== deletingSession.uid) {
        throw new AccountOperationError('account/uid-changed');
      }
      if (!deletingSession.isAnonymous && !pendingIntent) {
        const reauthenticatedAt = state.reauthenticatedAt
          ? Date.parse(state.reauthenticatedAt)
          : Number.NaN;
        if (
          !Number.isFinite(reauthenticatedAt) ||
          Date.now() - reauthenticatedAt > 5 * 60 * 1_000
        ) {
          throw new AccountOperationError('auth/requires-recent-login');
        }
      }
      setState(current => ({
        ...current,
        busy: true,
        error: null,
        notice: null,
      }));
      const deletedUid = deletingSession.uid;
      if (!pendingIntent) {
        // Persist a device-only barrier before asking the server to mint the
        // recovery receipt. A lost begin response can then be retried safely.
        await intentStorage.markAccountDeletionPreparing(deletedUid);
        deletionIntentCreated = true;
        setState(current => ({
          ...current,
          sessionQuiesced: true,
          deletionRecovery: 'deletion-preparing',
        }));
      }
      // Local opt-ins must be reset while the current Auth identity can still
      // unregister its FCM token and before the server write barrier is made.
      await sessionCleanup.prepareForAccountDeletion(deletedUid);
      if (recoveryReceipt === null) {
        preparationCallableStarted = true;
        const preparation = await account.beginAccountDeletion();
        if (preparation.deletionSubjectUid !== deletedUid) {
          throw new AccountOperationError('account/uid-changed');
        }
        recoveryReceipt = preparation.recoveryReceipt;
        await intentStorage.markAccountDeletionPending(
          deletedUid,
          recoveryReceipt,
        );
        setState(current => ({
          ...current,
          sessionQuiesced: true,
          deletionRecovery: 'deletion-pending',
        }));
      }
      deletionCallableStarted = true;
      setState(current => ({ ...current, sessionQuiesced: true }));
      await account.deleteMyAccount(recoveryReceipt);
      serverDeletionConfirmed = true;
      await intentStorage.markAccountDeletionLocalCleanupPending(
        deletedUid,
        recoveryReceipt,
      );
      setState(current => ({
        ...current,
        deletionRecovery: 'local-cleanup-pending',
      }));
      await finishLocalAccountExit(deletedUid);
      return true;
    } catch (error) {
      let intentRollbackFailed = false;
      if (
        !preparationCallableStarted &&
        !deletionCallableStarted &&
        deletionIntentCreated
      ) {
        try {
          await intentStorage.clearAccountDeletionIntent();
        } catch {
          intentRollbackFailed = true;
        }
      }
      setState(current => ({
        ...current,
        busy: false,
        sessionQuiesced:
          preparationCallableStarted ||
          deletionCallableStarted ||
          serverDeletionConfirmed ||
          intentRollbackFailed
            ? true
            : current.sessionQuiesced,
        deletionRecovery: serverDeletionConfirmed
          ? 'local-cleanup-pending'
          : deletionCallableStarted
            ? 'deletion-pending'
            : preparationCallableStarted || intentRollbackFailed
              ? recoveryReceipt === null
                ? 'deletion-preparing'
                : 'deletion-pending'
            : deletionIntentCreated
              ? 'none'
              : current.deletionRecovery,
        error: serverDeletionConfirmed
          ? '서버 계정은 삭제했지만 기기의 보안 저장소 정리를 완료하지 못했습니다. 기기 데이터 정리를 다시 시도해 주세요.'
          : deletionCallableStarted
            ? '계정 삭제 완료를 확인하지 못했습니다. 데이터 재생성을 막기 위해 동기화를 중지했습니다. 계정 삭제를 다시 시도해 주세요.'
            : preparationCallableStarted || intentRollbackFailed
              ? '계정 삭제 준비를 확인하지 못했습니다. 데이터 재생성을 막기 위해 동기화를 중지했습니다. 계정 삭제를 다시 시도해 주세요.'
            : accountErrorMessage(error),
        notice: null,
      }));
      return false;
    }
  }, [
    account,
    applyError,
    finishLocalAccountExit,
    intentStorage,
    sessionCleanup,
    state.reauthenticatedAt,
    state.session,
    state.deletionRecovery,
  ]);

  const logout = useCallback(async () => {
    const logoutUid = state.session?.uid;
    const recoverable = !state.sessionQuiesced;
    try {
      if (!logoutUid) {
        throw new AccountOperationError('account/no-current-user');
      }
      if (await intentStorage.loadAccountDeletionIntent()) {
        throw new AccountOperationError('account/deletion-recovery-active');
      }
      setState(current => ({
        ...current,
        busy: true,
        sessionQuiesced: true,
        error: null,
        notice: null,
      }));
      // Fail closed: preserve the authenticated session when server-side FCM
      // unregister or local opt-in reset cannot complete.
      await sessionCleanup.prepareForLogout(logoutUid, recoverable);
      await account.purgeLocalPrivateData(logoutUid);
      await intentStorage.markExplicitlySignedOut();
      explicitSignOut.current = true;
      await account.signOut();
    } catch (error) {
      let rollbackError: unknown;
      let recovered = false;
      if (logoutUid && recoverable) {
        try {
          await sessionCleanup.recoverFromFailedLogout(logoutUid);
          recovered = true;
        } catch (recoveryFailure) {
          rollbackError = recoveryFailure;
        }
      }
      try {
        await intentStorage.clearExplicitSignOut();
        explicitSignOut.current = false;
      } catch (markerRollbackFailure) {
        rollbackError = rollbackError ?? markerRollbackFailure;
      }
      applyError(rollbackError ?? error);
      if (recovered) {
        // Remount CyclePairProvider so all UID-bound Firestore watchers are
        // recreated after preferences and the backend session are restored.
        setState(current => ({ ...current, sessionQuiesced: false }));
      }
      return false;
    }

    // The durable explicit-sign-out marker is the startup privacy barrier.
    // Once native Auth sign-out succeeds, do not run another fallible async
    // operation that could enter the rollback path and erase that marker.
    try {
      sessionCleanup.completeLogout(logoutUid);
    } catch {
      // Auth sign-out is already committed. A local completion hook must never
      // reopen the previous identity or clear the durable signed-out marker.
    }
    setState(current => ({
      ...current,
      busy: false,
      session: null,
      sessionQuiesced: false,
      deletionRecovery: 'none',
      reauthenticatedAt: null,
      notice: null,
    }));
    return true;
  }, [
    account,
    applyError,
    intentStorage,
    sessionCleanup,
    state.session?.uid,
    state.sessionQuiesced,
  ]);

  const value = useMemo<AccountContextValue>(
    () => ({
      state,
      clearFeedback,
      startGuest,
      upgradeAnonymous,
      resendVerification,
      refreshVerification,
      signIn,
      requestPasswordReset,
      reauthenticate,
      requestDataExport,
      deleteAccount,
      logout,
    }),
    [
      state,
      clearFeedback,
      startGuest,
      upgradeAnonymous,
      resendVerification,
      refreshVerification,
      signIn,
      requestPasswordReset,
      reauthenticate,
      requestDataExport,
      deleteAccount,
      logout,
    ],
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  const context = useContext(AccountContext);
  if (!context)
    throw new Error('useAccount must be used inside AccountProvider');
  return context;
}
