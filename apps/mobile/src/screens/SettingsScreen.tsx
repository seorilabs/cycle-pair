import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ShareField, useMoonMate } from '../app/MoonMateStore';
import { Card, Chip, Screen, SectionHeader, ToggleRow } from '../components/Ui';
import { colors, spacing } from '../theme';

const shareRows: Array<{ key: ShareField; label: string }> = [
  { key: 'cyclePhase', label: '현재 주기 국면' },
  { key: 'predictedPeriod', label: '다음 생리 예상 범위' },
  { key: 'periodDates', label: '실제 생리 날짜' },
  { key: 'mood', label: '오늘의 기분' },
  { key: 'symptoms', label: '증상' },
  { key: 'carePreference', label: '원하는 도움' },
];

function SettingLink({ title, description, onPress, danger = false }: { title: string; description?: string; onPress(): void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.linkRow}>
      <View style={styles.linkCopy}>
        <Text style={[styles.linkTitle, danger && styles.danger]}>{title}</Text>
        {description ? <Text style={styles.linkDescription}>{description}</Text> : null}
      </View>
      <Text style={[styles.chevron, danger && styles.danger]}>›</Text>
    </Pressable>
  );
}

export function SettingsScreen() {
  const {
    state,
    backendKind,
    backendBusy,
    backendError,
    toggleShare,
    toggleNotifications,
    disconnectPair,
    resetApp,
  } = useMoonMate();
  const selectedCount = Object.values(state.shareSettings).filter(Boolean).length;

  function confirmDisconnect() {
    Alert.alert(
      '파트너 연결을 해제할까요?',
      '서버 접근은 즉시 차단되고, 상대 기기의 공유 캐시는 다음 온라인 동기화에서 삭제됩니다.',
      [
        { text: '취소', style: 'cancel' },
        { text: '연결 해제', style: 'destructive', onPress: () => disconnectPair().catch(() => undefined) },
      ],
    );
  }

  function confirmReset() {
    Alert.alert('개발 데이터를 초기화할까요?', '이 기기의 온보딩과 로컬 미리보기 기록이 삭제됩니다.', [
      { text: '취소', style: 'cancel' },
      { text: '초기화', style: 'destructive', onPress: resetApp },
    ]);
  }

  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.title}>설정</Text>
      <Card style={styles.profileCard}>
        <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>나</Text></View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileTitle}>내 MoonMate</Text>
          <Text style={styles.profileBody}>{state.partnerName} 님과 연결됨 · {backendKind === 'firebase' ? 'Firebase 동기화' : '테스트 미리보기'}</Text>
        </View>
        <Chip label="Free" />
      </Card>

      <SectionHeader title="공유 범위" action={<Text style={styles.count}>{selectedCount}개 공유 중</Text>} />
      <Card style={styles.rowsCard}>
        {shareRows.map(row => (
          <ToggleRow
            key={row.key}
            title={row.label}
            value={state.shareSettings[row.key]}
            onValueChange={() => toggleShare(row.key)}
          />
        ))}
      </Card>

      <SectionHeader title="알림과 개인정보" />
      <Card style={styles.rowsCard}>
        <ToggleRow
          title="중립적인 잠금화면 알림"
          description="생리·PMS·증상 표현 없이 ‘함께 확인할 업데이트가 있어요’로 표시"
          value={state.neutralNotifications}
          onValueChange={toggleNotifications}
        />
        <SettingLink title="내 데이터 내보내기" description="개발 단계 · Firebase 연결 후 제공" onPress={() => Alert.alert('준비 중', '백엔드 연결 후 안전한 내보내기를 제공합니다.')} />
        <SettingLink title="민감정보 동의와 개인정보 처리방침" onPress={() => Alert.alert('출시 전 확정 필요', '법률 검토와 마켓별 고지를 완료한 뒤 연결합니다.')} />
      </Card>

      <SectionHeader title="구독" />
      <Card tone="primary" style={styles.subscriptionCard}>
        <View style={styles.subscriptionCopy}>
          <Text style={styles.subscriptionEyebrow}>MoonMate Plus · 설계 중</Text>
          <Text style={styles.subscriptionTitle}>광고 없이, 신뢰를 먼저</Text>
          <Text style={styles.subscriptionBody}>결제 경계와 영수증 서버 검증이 준비될 때까지 실제 구매는 노출하지 않아요.</Text>
        </View>
      </Card>

      <SectionHeader title="연결과 데이터" />
      <Card style={styles.rowsCard}>
        <SettingLink title={backendBusy ? '연결 해제 처리 중…' : '파트너 연결 해제'} description="접근권 즉시 회수 · 캐시 tombstone 동기화" onPress={confirmDisconnect} danger />
        {backendKind === 'preview' ? <SettingLink title="개발 데이터 초기화" onPress={confirmReset} danger /> : null}
      </Card>

      {backendError ? <Text style={styles.syncError}>{backendError}</Text> : null}

      <View style={styles.footer}>
        <Text style={styles.brand}>☾ MoonMate</Text>
        <Text style={styles.version}>0.1.0 · 의료 도구 아님</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  title: { color: colors.text, fontSize: 30, fontWeight: '900', marginBottom: spacing.xl },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  profileAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  profileCopy: { flex: 1, gap: 2 },
  profileTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  profileBody: { color: colors.textMuted, fontSize: 11 },
  count: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  rowsCard: { paddingVertical: 0 },
  linkRow: { flexDirection: 'row', alignItems: 'center', minHeight: 62, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  linkCopy: { flex: 1, gap: spacing.xs },
  linkTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  linkDescription: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  chevron: { color: colors.textSubtle, fontSize: 25 },
  danger: { color: colors.danger },
  syncError: { color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
  subscriptionCard: { flexDirection: 'row', gap: spacing.md },
  subscriptionCopy: { flex: 1, gap: spacing.xs },
  subscriptionEyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  subscriptionTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  subscriptionBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  footer: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.xxl },
  brand: { color: colors.primaryDark, fontSize: 14, fontWeight: '900' },
  version: { color: colors.textSubtle, fontSize: 10 },
});
