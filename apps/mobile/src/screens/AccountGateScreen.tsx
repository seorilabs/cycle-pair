import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useAccount } from '../app/account/AccountContext';
import {
  Card,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextButton,
} from '../components/Ui';
import { colors, radius, spacing } from '../theme';

export function AccountGateScreen({
  deletionRecovery = false,
}: {
  deletionRecovery?: boolean;
}) {
  const {
    state,
    clearFeedback,
    startGuest,
    signIn,
    requestPasswordReset,
  } = useAccount();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetMode, setResetMode] = useState(false);

  async function submitLogin() {
    if (await signIn(email, password)) setPassword('');
  }

  async function submitReset() {
    if (await requestPasswordReset(email)) setPassword('');
  }

  function switchMode() {
    clearFeedback();
    setPassword('');
    setResetMode(value => !value);
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.brandBlock}>
        <Text style={styles.brand}>∞ 사이클 페어</Text>
        <Text style={styles.title}>
          {resetMode
            ? '비밀번호 다시 설정하기'
            : deletionRecovery
              ? '삭제를 요청한 계정 확인'
              : '내 기록으로 돌아가기'}
        </Text>
        <Text style={styles.body}>
          {resetMode
            ? '계정에 등록한 이메일로 재설정 링크를 보내드려요.'
            : deletionRecovery
              ? '삭제를 요청한 동일한 이메일 계정으로 로그인하면 중단된 서버 삭제를 안전하게 다시 시도할 수 있어요.'
              : '로그아웃 상태입니다. 이메일 계정으로 로그인해야 기존 기록을 다시 불러올 수 있어요.'}
        </Text>
      </View>

      <Card style={styles.form}>
        <Text style={styles.label}>이메일</Text>
        <TextInput
          accessibilityLabel="로그인 이메일"
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          editable={!state.busy}
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="name@example.com"
          placeholderTextColor={colors.textSubtle}
          style={styles.input}
          textContentType="emailAddress"
          value={email}
        />
        {!resetMode ? (
          <>
            <Text style={styles.label}>비밀번호</Text>
            <TextInput
              accessibilityLabel="로그인 비밀번호"
              autoCapitalize="none"
              autoComplete="current-password"
              autoCorrect={false}
              editable={!state.busy}
              onChangeText={setPassword}
              onSubmitEditing={() => submitLogin().catch(() => undefined)}
              placeholder="비밀번호"
              placeholderTextColor={colors.textSubtle}
              secureTextEntry
              style={styles.input}
              textContentType="password"
              value={password}
            />
          </>
        ) : null}

        {state.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {state.error}
          </Text>
        ) : null}
        {state.notice ? (
          <Text style={styles.notice}>{state.notice}</Text>
        ) : null}

        <PrimaryButton
          disabled={state.busy}
          label={
            state.busy
              ? '처리 중…'
              : resetMode
              ? '재설정 메일 보내기'
              : '로그인'
          }
          onPress={() =>
            (resetMode ? submitReset() : submitLogin()).catch(() => undefined)
          }
          testID={resetMode ? 'account-reset-submit' : 'account-login-submit'}
        />
        <TextButton
          disabled={state.busy}
          label={resetMode ? '로그인으로 돌아가기' : '비밀번호를 잊었어요'}
          onPress={switchMode}
        />

        {!resetMode && !deletionRecovery ? (
          <View style={styles.guestBlock}>
            <Text style={styles.guestCopy}>
              이전 계정과 분리된 빈 기록으로 다시 시작할 수도 있어요.
            </Text>
            <SecondaryButton
              compact
              disabled={state.busy}
              label={state.busy ? '게스트 준비 중…' : '새 게스트로 시작'}
              onPress={() => startGuest().catch(() => undefined)}
            />
          </View>
        ) : null}
      </Card>

      <Text style={styles.privacy}>
        비밀번호는 기기에 별도로 저장하지 않고 Firebase Auth에만 전달합니다.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', gap: spacing.xl },
  brandBlock: { gap: spacing.sm },
  brand: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  title: {
    color: colors.text,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '900',
  },
  body: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  form: { gap: spacing.md },
  label: { color: colors.text, fontSize: 13, fontWeight: '800' },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.lg,
  },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  notice: { color: colors.primaryDark, fontSize: 12, lineHeight: 18 },
  guestBlock: {
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  guestCopy: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  privacy: {
    color: colors.textSubtle,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
});
