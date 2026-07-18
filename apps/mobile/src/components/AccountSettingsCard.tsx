import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAccount } from '../app/account/AccountContext';
import type { AccountExportDownloadTicket } from '../domain/account/AccountPort';
import { colors, radius, spacing } from '../theme';
import { Card, Chip, PrimaryButton, SecondaryButton, TextButton } from './Ui';

function AccountInput({
  accessibilityLabel,
  value,
  onChangeText,
  placeholder,
  email = false,
  currentPassword = false,
}: {
  accessibilityLabel: string;
  value: string;
  onChangeText(value: string): void;
  placeholder: string;
  email?: boolean;
  currentPassword?: boolean;
}) {
  const { state } = useAccount();
  return (
    <TextInput
      accessibilityLabel={accessibilityLabel}
      autoCapitalize="none"
      autoComplete={
        email ? 'email' : currentPassword ? 'current-password' : 'new-password'
      }
      autoCorrect={false}
      editable={!state.busy}
      keyboardType={email ? 'email-address' : 'default'}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textSubtle}
      secureTextEntry={!email}
      style={styles.input}
      textContentType={
        email ? 'emailAddress' : currentPassword ? 'password' : 'newPassword'
      }
      value={value}
    />
  );
}

export function AccountSettingsCard() {
  const {
    state,
    clearFeedback,
    upgradeAnonymous,
    resendVerification,
    refreshVerification,
    reauthenticate,
    requestDataExport,
    deleteAccount,
    logout,
  } = useAccount();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [reauthPassword, setReauthPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [exportTicket, setExportTicket] =
    useState<AccountExportDownloadTicket | null>(null);
  const session = state.session;

  useEffect(() => {
    setPassword('');
    setPasswordConfirm('');
    setReauthPassword('');
    setLocalError(null);
    setExportTicket(null);
  }, [session?.isAnonymous, session?.uid]);

  if (!session) return null;

  async function submitUpgrade() {
    setLocalError(null);
    clearFeedback();
    if (password !== passwordConfirm) {
      setLocalError('비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    if (await upgradeAnonymous(email, password)) {
      setPassword('');
      setPasswordConfirm('');
    }
  }

  async function submitReauthentication() {
    if (await reauthenticate(reauthPassword)) setReauthPassword('');
  }

  async function openExportDownload(downloadUrl: string) {
    try {
      await Linking.openURL(downloadUrl);
    } catch {
      setLocalError(
        '다운로드 화면을 열지 못했습니다. 만료 전에 링크를 다시 열어 주세요.',
      );
    }
  }

  async function requestExportDownload() {
    setLocalError(null);
    const verifiedAt = state.reauthenticatedAt
      ? Date.parse(state.reauthenticatedAt)
      : Number.NaN;
    if (
      !Number.isFinite(verifiedAt) ||
      Date.now() - verifiedAt > 5 * 60 * 1_000
    ) {
      setLocalError('데이터 내보내기 전에 현재 비밀번호를 다시 확인해 주세요.');
      return;
    }
    const ticket = await requestDataExport();
    if (!ticket) return;
    setExportTicket(ticket);
    await openExportDownload(ticket.downloadUrl);
  }

  function confirmDeleteAccount() {
    if (!session?.isAnonymous) {
      const verifiedAt = state.reauthenticatedAt
        ? Date.parse(state.reauthenticatedAt)
        : Number.NaN;
      if (
        !Number.isFinite(verifiedAt) ||
        Date.now() - verifiedAt > 5 * 60 * 1_000
      ) {
        setLocalError('계정 삭제 전에 현재 비밀번호를 다시 확인해 주세요.');
        return;
      }
    }
    setLocalError(null);
    Alert.alert(
      session?.isAnonymous
        ? '게스트 기록을 영구 삭제할까요?'
        : '계정과 데이터를 영구 삭제할까요?',
      session?.isAnonymous
        ? '이 기기와 서버의 개인 기록, Pair 연결, 공유 설정, 게스트 계정이 삭제되며 되돌릴 수 없습니다.'
        : '개인 기록, Pair 연결, 공유 설정과 Firebase Auth 계정이 삭제되며 되돌릴 수 없습니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '영구 삭제',
          style: 'destructive',
          onPress: () => deleteAccount().catch(() => undefined),
        },
      ],
    );
  }

  function confirmLogout() {
    Alert.alert(
      '로그아웃할까요?',
      '동기화되지 않은 기록이 있으면 로그아웃을 중단합니다. 완료 후에는 다시 로그인하기 전까지 기록을 볼 수 없습니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '로그아웃',
          style: 'destructive',
          onPress: () => logout().catch(() => undefined),
        },
      ],
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>
            {session.isAnonymous ? '게스트 기록' : session.email}
          </Text>
          <Text style={styles.description}>
            {session.isAnonymous
              ? '지금 기기를 잃거나 로그아웃하면 기록을 복구할 수 없어요.'
              : 'Firebase Auth가 로그인 상태를 안전하게 관리합니다.'}
          </Text>
        </View>
        <Chip
          label={
            session.isAnonymous
              ? '게스트'
              : session.emailVerified
              ? '인증됨'
              : '미인증'
          }
          selected={!session.isAnonymous && session.emailVerified}
        />
      </View>

      {session.isAnonymous ? (
        <View style={styles.form}>
          <Text style={styles.formTitle}>이메일 계정으로 안전하게 보관</Text>
          <AccountInput
            accessibilityLabel="계정 전환 이메일"
            email
            onChangeText={setEmail}
            placeholder="name@example.com"
            value={email}
          />
          <AccountInput
            accessibilityLabel="계정 전환 비밀번호"
            onChangeText={setPassword}
            placeholder="비밀번호 8자 이상"
            value={password}
          />
          <AccountInput
            accessibilityLabel="계정 전환 비밀번호 확인"
            onChangeText={setPasswordConfirm}
            placeholder="비밀번호 다시 입력"
            value={passwordConfirm}
          />
          <PrimaryButton
            disabled={state.busy}
            label={
              state.busy ? '계정 전환 중…' : '현재 기록 그대로 계정 만들기'
            }
            onPress={() => submitUpgrade().catch(() => undefined)}
            testID="account-upgrade-submit"
          />
          <Text style={styles.caption}>
            현재 UID를 유지해 기존 기록과 Pair 연결이 그대로 보존됩니다.
          </Text>
        </View>
      ) : (
        <View style={styles.form}>
          {!session.emailVerified ? (
            <View style={styles.inlineActions}>
              <SecondaryButton
                compact
                label="인증 메일 다시 보내기"
                onPress={() => resendVerification().catch(() => undefined)}
              />
              <TextButton
                disabled={state.busy}
                label="인증 여부 새로고침"
                onPress={() => refreshVerification().catch(() => undefined)}
              />
            </View>
          ) : null}

          <Text style={styles.formTitle}>민감한 작업 전 비밀번호 확인</Text>
          <Text style={styles.description}>
            데이터 내보내기와 계정 삭제 전에 다시 확인합니다.
          </Text>
          <AccountInput
            accessibilityLabel="재인증 비밀번호"
            currentPassword
            onChangeText={setReauthPassword}
            placeholder="현재 비밀번호"
            value={reauthPassword}
          />
          <SecondaryButton
            compact
            label={state.busy ? '확인 중…' : '비밀번호 확인'}
            onPress={() => submitReauthentication().catch(() => undefined)}
          />
          {state.reauthenticatedAt ? (
            <Text style={styles.success}>
              이 세션에서 본인 확인이 완료되었습니다.
            </Text>
          ) : null}
          <TextButton
            disabled={state.busy}
            label="로그아웃"
            onPress={confirmLogout}
          />
        </View>
      )}

      <View style={styles.dataRights}>
        <Text style={styles.formTitle}>내 데이터 권리</Text>
        <Text style={styles.description}>
          {session.isAnonymous
            ? '게스트 기록도 언제든 영구 삭제할 수 있습니다. JSON 내보내기는 복구 가능한 이메일 계정으로 전환한 뒤 제공됩니다.'
            : '최근 비밀번호 확인 후 5분짜리 단회 링크를 발급합니다. 다운로드할 때만 JSON을 메모리에서 만들고 서버에는 저장하지 않습니다.'}
        </Text>
        {!session.isAnonymous ? (
          <>
            <SecondaryButton
              compact
              label={
                state.busy
                  ? '다운로드 링크 생성 중…'
                  : '내 데이터 JSON 다운로드'
              }
              onPress={() => requestExportDownload().catch(() => undefined)}
            />
            {exportTicket ? (
              <View style={styles.exportTicket}>
                <Text style={styles.caption}>
                  {new Date(exportTicket.expiresAt).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  까지 유효한 단회 링크입니다. JSON은 서버에 저장되지 않으며
                  다운로드를 시작하면 링크가 폐기됩니다.
                </Text>
                <TextButton
                  disabled={state.busy}
                  label="만료 전 다운로드 링크 다시 열기"
                  onPress={() =>
                    openExportDownload(exportTicket.downloadUrl).catch(
                      () => undefined,
                    )
                  }
                />
              </View>
            ) : null}
            <SecondaryButton
              compact
              danger
              label="계정과 서버 데이터 영구 삭제"
              onPress={confirmDeleteAccount}
            />
          </>
        ) : (
          <>
            <Text style={styles.caption}>
              JSON 내보내기는 이메일 계정 전환 후 사용할 수 있습니다.
            </Text>
            <SecondaryButton
              compact
              danger
              label="게스트 기록과 서버 데이터 영구 삭제"
              onPress={confirmDeleteAccount}
            />
          </>
        )}
      </View>

      {localError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {localError}
        </Text>
      ) : null}
      {state.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {state.error}
        </Text>
      ) : null}
      {state.notice ? <Text style={styles.success}>{state.notice}</Text> : null}

    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerCopy: { flex: 1, gap: spacing.xs },
  title: { color: colors.text, fontSize: 16, fontWeight: '900' },
  description: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
  form: { gap: spacing.md },
  formTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: spacing.lg,
  },
  inlineActions: { gap: spacing.md },
  dataRights: {
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
  },
  caption: { color: colors.textSubtle, fontSize: 10, lineHeight: 16 },
  exportTicket: {
    gap: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    padding: spacing.md,
  },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  success: { color: colors.primaryDark, fontSize: 12, lineHeight: 18 },
});
