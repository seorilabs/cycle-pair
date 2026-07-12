import React, { useState } from 'react';
import { Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMoonMate } from '../app/MoonMateStore';
import {
  Body,
  Card,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Title,
} from '../components/Ui';
import { colors, radius, spacing } from '../theme';

export function InviteScreen() {
  const {
    backendKind,
    backendSession,
    invite,
    backendBusy,
    backendError,
    createInvite,
    acceptInvite,
    previewLinkPartner,
  } = useMoonMate();
  const [inviteToken, setInviteToken] = useState('');

  async function shareInvite() {
    if (!invite) return;
    await Share.share({
      message: `함께 준비해요. 24시간 안에 앱에서 이 초대 코드를 입력해 주세요:\n${invite.inviteToken}`,
      title: '파트너 초대',
    });
  }

  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.step}>2 / 3</Text>
      <Title>함께할 한 사람을{`\n`}초대해 주세요</Title>
      <Body muted style={styles.intro}>
        연결은 정확히 두 사람만 가능해요. 상대는 내가 허용한 항목만 볼 수 있어요.
      </Body>

      <View style={styles.illustration}>
        <View style={[styles.avatar, styles.avatarLeft]}>
          <Text style={styles.avatarText}>나</Text>
        </View>
        <View style={styles.connection}>
          <Text style={styles.heart}>♡</Text>
        </View>
        <View style={[styles.avatar, styles.avatarRight]}>
          <Text style={styles.avatarText}>?</Text>
        </View>
      </View>

      {backendKind === 'preview' ? (
        <Card style={styles.previewCard}>
          <Text style={styles.previewLabel}>테스트 미리보기</Text>
          <Text style={styles.previewBody}>
            자동 테스트에서는 실제 계정 대신 로컬 연결 상태를 사용해요.
          </Text>
          <PrimaryButton label="연결 상태 확인" onPress={previewLinkPartner} />
        </Card>
      ) : (
        <>
          <Card style={styles.codeCard}>
            <Text style={styles.cardTitle}>내가 초대할게요</Text>
            <Text style={styles.cardDescription}>서버에는 원문 대신 해시만 저장되는 1회용 코드예요.</Text>
            {invite ? (
              <>
                <Text style={styles.codeLabel}>24시간 뒤 만료</Text>
                <Text selectable style={styles.code}>{invite.inviteToken}</Text>
                <SecondaryButton label="초대 코드 공유하기" onPress={shareInvite} />
              </>
            ) : (
              <PrimaryButton
                label={backendBusy ? '초대 코드 만드는 중…' : '1회용 초대 만들기'}
                disabled={backendBusy || !backendSession}
                onPress={createInvite}
              />
            )}
          </Card>

          <Card style={styles.acceptCard}>
            <Text style={styles.cardTitle}>초대를 받았어요</Text>
            <TextInput
              accessibilityLabel="초대 코드"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              onChangeText={setInviteToken}
              placeholder="공유받은 43자 코드를 붙여넣기"
              placeholderTextColor={colors.textSubtle}
              style={styles.input}
              value={inviteToken}
            />
            <PrimaryButton
              label={backendBusy ? '연결 확인 중…' : '초대 수락하기'}
              disabled={backendBusy || inviteToken.trim().length !== 43 || !backendSession}
              onPress={() => acceptInvite(inviteToken)}
            />
          </Card>
        </>
      )}

      {backendError ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{backendError}</Text>
        </View>
      ) : null}

      <View style={styles.securityNote}>
        <Text style={styles.shield}>◇</Text>
        <View style={styles.securityCopy}>
          <Text style={styles.securityTitle}>상대가 수락해도 바로 공개되지 않아요</Text>
          <Text style={styles.securityBody}>다음 단계에서 공유할 항목을 직접 선택합니다.</Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  step: { color: colors.primary, fontSize: 13, fontWeight: '800', marginBottom: spacing.lg },
  intro: { marginTop: spacing.md },
  illustration: {
    height: 150,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.lg,
  },
  avatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: colors.background,
  },
  avatarLeft: { backgroundColor: colors.primary },
  avatarRight: { backgroundColor: colors.accent },
  avatarText: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  connection: {
    width: 72,
    height: 4,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heart: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    color: colors.primary,
    fontSize: 26,
    lineHeight: 35,
    textAlign: 'center',
  },
  codeCard: { alignItems: 'stretch', gap: spacing.md },
  acceptCard: { marginTop: spacing.lg, gap: spacing.md },
  previewCard: { gap: spacing.md },
  previewLabel: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  previewBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  cardDescription: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  codeLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  code: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  input: {
    minHeight: 76,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    padding: spacing.md,
    fontSize: 13,
    lineHeight: 19,
  },
  errorCard: {
    marginTop: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: '#FFF0F0',
    padding: spacing.md,
  },
  errorText: { color: colors.danger, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  securityNote: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl, alignItems: 'center' },
  shield: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.mintSoft,
    color: colors.mint,
    fontSize: 24,
    lineHeight: 36,
    textAlign: 'center',
  },
  securityCopy: { flex: 1, gap: 2 },
  securityTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  securityBody: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
});
