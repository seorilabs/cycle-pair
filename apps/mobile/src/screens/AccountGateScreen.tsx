import React, { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { useAccount } from '../app/account/AccountContext';
import { useHardwareBack } from '../app/useHardwareBack';
import { AppIcon, QuietTogetherArtwork } from '../components/AppArtwork';
import {
  Body,
  Card,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextButton,
  Title,
} from '../components/Ui';
import { useI18n } from '../i18n/I18nProvider';
import { colors, radius, spacing } from '../theme';

type Mode = 'entry' | 'register' | 'login' | 'reset';
export function AccountGateScreen({
  deletionRecovery = false,
}: {
  deletionRecovery?: boolean;
}) {
  const { l, t } = useI18n();
  const {
    state,
    clearFeedback,
    startGuest,
    registerEmail,
    signIn,
    requestPasswordReset,
  } = useAccount();
  const [mode, setMode] = useState<Mode>(deletionRecovery ? 'login' : 'entry');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  function changeMode(next: Mode) {
    clearFeedback();
    setPassword('');
    setMode(next);
  }
  function back() {
    if (state.busy) return true;
    if (mode === 'entry' || (deletionRecovery && mode === 'login'))
      return false;
    changeMode(mode === 'reset' ? 'login' : 'entry');
    return true;
  }
  useHardwareBack(back);
  async function submit() {
    const success =
      mode === 'reset'
        ? await requestPasswordReset(email)
        : mode === 'register'
        ? await registerEmail(email, password)
        : await signIn(email, password);
    if (success) setPassword('');
  }
  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.brand}>∞ {t('Cycle Pair')}</Text>
      {mode === 'entry' ? (
        <>
          <QuietTogetherArtwork />
          <Title>{t('A little space to understand each other.')}</Title>
          <Body muted>
            {t('Small notes for yourself. Share only what feels right.')}
          </Body>
          <PrimaryButton
            testID="account-email-start"
            disabled={state.busy}
            label={t('Start with email')}
            onPress={() => changeMode('register')}
          />
          <SecondaryButton
            disabled={state.busy}
            label={t('Start without an account')}
            onPress={() => startGuest().catch(() => undefined)}
          />
          <Body muted style={styles.hint}>
            {t(
              'Connect an account later to recover guest records on another device.',
            )}
          </Body>
          <TextButton
            disabled={state.busy}
            label={t('Already have an account? Sign in')}
            onPress={() => changeMode('login')}
          />
        </>
      ) : (
        <>
          {!deletionRecovery ? (
            <TextButton
              disabled={state.busy}
              label={t('Back')}
              onPress={back}
            />
          ) : null}
          <AppIcon name="mail" size={36} />
          <Title>
            {mode === 'reset'
              ? l('비밀번호 다시 설정하기')
              : deletionRecovery
              ? l('삭제를 요청한 계정 확인')
              : mode === 'register'
              ? t('Keep your days with you')
              : l('내 기록으로 돌아가기')}
          </Title>
          <Body muted>
            {mode === 'reset'
              ? l('계정에 등록한 이메일로 재설정 링크를 보내드려요.')
              : deletionRecovery
              ? l(
                  '삭제를 요청한 동일한 이메일 계정으로 로그인하면 중단된 서버 삭제를 안전하게 다시 시도할 수 있어요.',
                )
              : t(
                  'An email account lets you recover your records and partner connection.',
                )}
          </Body>
          <Card style={styles.form}>
            <Text style={styles.label}>{l('이메일')}</Text>
            <TextInput
              accessibilityLabel={l('로그인 이메일')}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!state.busy}
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="name@example.com"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              textContentType="emailAddress"
              value={email}
            />
            {mode !== 'reset' ? (
              <>
                <Text style={styles.label}>{l('비밀번호')}</Text>
                <TextInput
                  accessibilityLabel={l('로그인 비밀번호')}
                  autoCapitalize="none"
                  autoComplete={
                    mode === 'register' ? 'new-password' : 'current-password'
                  }
                  autoCorrect={false}
                  editable={!state.busy}
                  onChangeText={setPassword}
                  onSubmitEditing={() => submit().catch(() => undefined)}
                  placeholder={
                    mode === 'register'
                      ? t('At least 8 characters')
                      : l('비밀번호')
                  }
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  style={styles.input}
                  textContentType={
                    mode === 'register' ? 'newPassword' : 'password'
                  }
                  value={password}
                />
              </>
            ) : null}
            <PrimaryButton
              disabled={state.busy}
              label={
                state.busy
                  ? l('처리 중…')
                  : mode === 'reset'
                  ? l('재설정 메일 보내기')
                  : mode === 'register'
                  ? t('Create email account')
                  : l('로그인')
              }
              onPress={() => {
                submit().catch(() => undefined);
              }}
              testID={
                mode === 'reset'
                  ? 'account-reset-submit'
                  : mode === 'register'
                  ? 'account-register-submit'
                  : 'account-login-submit'
              }
            />
            <TextButton
              disabled={state.busy}
              label={
                mode === 'register'
                  ? t('Already have an account? Sign in')
                  : mode === 'reset'
                  ? l('로그인으로 돌아가기')
                  : l('비밀번호를 잊었어요')
              }
              onPress={() => changeMode(mode === 'login' ? 'reset' : 'login')}
            />
          </Card>
          <Body muted style={styles.hint}>
            {l('비밀번호는 이 기기에 저장하지 않아요.')}
          </Body>
        </>
      )}
      {state.busy ? (
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          {l('처리 중…')}
        </Text>
      ) : null}
      {state.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {l(state.error)}
        </Text>
      ) : null}
      {state.notice ? <Body muted>{l(state.notice)}</Body> : null}
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingTop: spacing.xl },
  brand: { color: colors.primaryDark, fontSize: 18, fontWeight: '800' },
  form: { gap: spacing.md },
  label: { color: colors.text, fontSize: 15, fontWeight: '700' },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 16,
    padding: spacing.md,
  },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 22 },
});
