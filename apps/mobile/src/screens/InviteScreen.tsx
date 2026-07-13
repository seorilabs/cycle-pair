import React, { useState } from 'react';
import { Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useCyclePair } from '../app/CyclePairStore';
import {
  Body,
  Card,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TextButton,
  Title,
} from '../components/Ui';
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
  const [inviteToken, setInviteToken] = useState('');
  const isConnected = state.paired && Boolean(state.sharingPairId);

  async function shareInvite() {
    if (!invite) return;
    await Share.share({
      message: `함께 준비해요. 24시간 안에 앱에서 이 초대 코드를 입력해 주세요:\n${invite.inviteToken}`,
      title: '파트너 초대',
    });
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <TextButton label="닫기" disabled={backendBusy} onPress={goBack} />
        <Text style={styles.step}>선택 기능</Text>
      </View>
      <Title>
        {isConnected ? `파트너 연결을\n확인했어요` : `함께할 한 사람을\n초대해 주세요`}
      </Title>
      <Body muted style={styles.intro}>
        {isConnected
          ? '이전 단계로 돌아가도 연결은 유지돼요. 다음 단계에서 공유 범위를 정할 수 있어요.'
          : '연결하지 않아도 내 기록은 계속 사용할 수 있어요. 상대는 연결 후에도 내가 허용한 항목만 볼 수 있습니다.'}
      </Body>

      <View style={styles.illustration}>
        <View style={[styles.avatar, styles.avatarLeft]}>
          <Text style={styles.avatarText}>나</Text>
        </View>
        <View style={styles.connection}>
          <Text style={styles.heart}>♡</Text>
        </View>
        <View style={[styles.avatar, styles.avatarRight]}>
          <Text style={styles.avatarText}>{isConnected ? '✓' : '?'}</Text>
        </View>
      </View>

      {isConnected ? (
        <Card style={styles.connectedCard}>
          <Text style={styles.previewLabel}>파트너 연결 완료</Text>
          <Text style={styles.previewBody}>
            연결을 새로 만들 필요 없이 기존 Pair를 그대로 사용해요.
          </Text>
          <PrimaryButton label="공유 설정으로 계속" onPress={continueToSharing} />
        </Card>
      ) : backendKind === 'preview' ? (
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  step: { color: colors.primary, fontSize: 13, fontWeight: '800' },
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
  connectedCard: { gap: spacing.md },
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
