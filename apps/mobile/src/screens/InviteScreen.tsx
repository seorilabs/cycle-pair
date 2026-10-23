import React, { useEffect, useRef, useState } from 'react';
import { Platform, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCyclePair } from '../app/CyclePairStore';
import { buildInviteExpiryPresentation } from '../app/inviteExpiryPresentation';
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
export function InviteScreen() {
  const {
    state,
    backendKind,
    backendSession,
    invite,
    backendBusy,
    backendError,
    createInvite,
    acceptInvite,
    previewLinkPartner,
    goBack,
    continueToSharing,
  } = useCyclePair();
  const { l, t, locale } = useI18n();
  const [direction, setDirection] = useState<'send' | 'receive' | null>(null);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now);
  const submitting = useRef(false);
  const expiry = invite
    ? buildInviteExpiryPresentation(invite.expiresAt, now)
    : null;
  const expiresAt = expiry?.expiresAtMillis ?? 0;
  useEffect(() => {
    if (!invite || expiry?.expired) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(30_000, Math.max(1, expiresAt - now)),
    );
    return () => clearTimeout(timer);
  }, [invite, expiry?.expired, expiresAt, now]);
  async function run(action: () => Promise<unknown>) {
    if (submitting.current || backendBusy) return;
    submitting.current = true;
    try {
      await action();
      setNow(Date.now());
    } finally {
      submitting.current = false;
    }
  }
  const expiryDate =
    invite && Number.isFinite(Date.parse(invite.expiresAt))
      ? new Intl.DateTimeFormat(locale === 'ko' ? 'ko-KR' : 'en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(invite.expiresAt))
      : '';
  return (
    <Screen>
      <TextButton label={t('Close')} disabled={backendBusy} onPress={goBack} />
      <View style={styles.heading}>
        <Title>{t('Connect a partner')}</Title>
        <Body muted>{t('Connect to share selected updates.')}</Body>
      </View>
      {state.paired ? (
        <Card style={styles.card}>
          <Body>{t('Connected')}</Body>
          <PrimaryButton
            label={t('Choose what to share')}
            onPress={continueToSharing}
          />
        </Card>
      ) : (
        <>
          {!direction ? (
            <View style={styles.card}>
              <PrimaryButton
                label={t('Send invitation')}
                onPress={() => setDirection('send')}
                testID="invite-send"
              />
              <SecondaryButton
                label={t('Receive invitation')}
                onPress={() => setDirection('receive')}
              />
            </View>
          ) : (
            <>
              <TextButton
                label={t('Back')}
                disabled={backendBusy}
                onPress={() => setDirection(null)}
              />
              <Card style={styles.card}>
                <Text style={styles.title}>
                  {t(
                    direction === 'send'
                      ? 'Send invitation'
                      : 'Receive invitation',
                  )}
                </Text>
                {backendKind === 'preview' ? (
                  <PrimaryButton
                    label={t('Connect')}
                    onPress={previewLinkPartner}
                  />
                ) : direction === 'send' ? (
                  <>
                    <Body muted>
                      {t('This code can be used once before it expires.')}
                    </Body>
                    {invite && !expiry?.expired ? (
                      <>
                        <Text
                          selectable
                          accessibilityLabel={t('Invitation code')}
                          testID="invite-code"
                          style={styles.code}
                        >
                          {invite.inviteToken}
                        </Text>
                        <Body muted>
                          {t('Expires {date}', { date: expiryDate })}
                        </Body>
                        <PrimaryButton
                          label={t('Share invitation')}
                          disabled={backendBusy}
                          onPress={() => {
                            Share.share({
                              title: t('Cycle Pair'),
                              message: t(
                                'Enter this code in Cycle Pair before {date}:\n{code}',
                                { date: expiryDate, code: invite.inviteToken },
                              ),
                            }).catch(() => undefined);
                          }}
                        />
                      </>
                    ) : (
                      <>
                        {expiry?.expired ? (
                          <Body>{t('Invitation expired')}</Body>
                        ) : null}
                        <PrimaryButton
                          label={t(
                            backendBusy
                              ? 'Creating…'
                              : expiry?.expired
                              ? 'Create a new invitation'
                              : 'Create invitation',
                          )}
                          disabled={backendBusy || !backendSession}
                          onPress={() => {
                            run(createInvite).catch(() => undefined);
                          }}
                          testID="invite-create"
                        />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <TextInput
                      accessibilityLabel={t('Invitation code')}
                      testID="invite-input"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType={
                        Platform.OS === 'ios' ? 'ascii-capable' : 'default'
                      }
                      maxLength={43}
                      placeholder={t('Paste your invitation code')}
                      placeholderTextColor={colors.textSubtle}
                      value={code}
                      onChangeText={setCode}
                      style={styles.input}
                    />
                    <PrimaryButton
                      label={t(backendBusy ? 'Connecting…' : 'Connect')}
                      disabled={
                        backendBusy ||
                        !backendSession ||
                        !/^[A-Za-z0-9_-]{43}$/.test(code.trim())
                      }
                      onPress={() => {
                        run(() => acceptInvite(code.trim())).catch(
                          () => undefined,
                        );
                      }}
                    />
                  </>
                )}
              </Card>
            </>
          )}
        </>
      )}
      {backendError ? (
        <Body style={styles.error}>{l(backendError)}</Body>
      ) : null}
    </Screen>
  );
}
const styles = StyleSheet.create({
  heading: { gap: spacing.md, marginVertical: spacing.xl },
  card: { gap: spacing.lg, marginTop: spacing.lg },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  code: { fontSize: 17, color: colors.primaryDark },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  error: { color: colors.danger, marginTop: spacing.lg },
});
