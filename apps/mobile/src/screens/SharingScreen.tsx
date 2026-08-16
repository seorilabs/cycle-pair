import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ShareField, useCyclePair } from '../app/CyclePairStore';
import { Body, Card, PrimaryButton, Screen, SecondaryButton, TextButton, Title, ToggleRow } from '../components/Ui';
import { colors, spacing } from '../theme';

const fields: Array<{ key: ShareField; title: string; description: string }> = [
  { key: 'cyclePhase', title: '현재 주기 국면', description: '월경 중·회복기·변화기처럼 큰 흐름을 공유해요' },
  { key: 'cycleStatus', title: '세부 생리 상태', description: '시작·진행·마무리·직후처럼 더 자세한 상태를 공유해요' },
  { key: 'fertilityStatus', title: '가임 가능 시기', description: '예측 기반 참고 정보이며 피임 판단에는 사용할 수 없어요' },
  { key: 'predictedPeriod', title: '다음 생리 예정 범위', description: '참고용 예상 범위만 공유해요' },
  { key: 'periodDates', title: '실제 생리 날짜', description: '시작·종료 기록을 공유해요' },
  { key: 'mood', title: '오늘의 기분', description: '내가 직접 고른 기분만 보여줘요' },
  { key: 'symptoms', title: '증상', description: '민감할 수 있어 기본값은 꺼져 있어요' },
  { key: 'energy', title: '에너지 정도', description: '1–5 단계 중 오늘 고른 값만 보여줘요' },
  { key: 'condition', title: '오늘의 컨디션', description: '편안함·피곤함처럼 직접 고른 상태만 보여줘요' },
  { key: 'carePreference', title: '원하는 도움', description: '추측 대신 내가 선택한 배려 방식을 알려줘요' },
  { key: 'note', title: '오늘의 메모', description: '자유 입력이라 특히 민감할 수 있어 기본값은 꺼져 있어요' },
];

export function SharingScreen() {
  const {
    state,
    backendBusy,
    backendError,
    goBack,
    toggleShare,
    useRecommendedSharing,
    completeSharing,
  } = useCyclePair();
  const submittingRef = useRef(false);
  const [saveAttempted, setSaveAttempted] = React.useState(false);
  const selectedCount = Object.values(state.shareSettings).filter(Boolean).length;

  async function saveSharing() {
    if (submittingRef.current || backendBusy) return;
    submittingRef.current = true;
    setSaveAttempted(true);
    try {
      await completeSharing();
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <TextButton label="이전" disabled={backendBusy} onPress={goBack} />
        <Text style={styles.step}>연결 후 선택</Text>
      </View>
      <Title>{state.partnerName} 님에게{`\n`}무엇을 보여줄까요?</Title>
      <Body muted style={styles.intro}>
        처음에는 아무것도 공유하지 않아요. 지금 고르거나, 나중에 설정에서 바꿀 수 있어요.
      </Body>

      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>현재 공유 항목</Text>
        <Text style={styles.summaryCount}>{selectedCount}개</Text>
      </View>

      <Card style={styles.card}>
        {fields.map(field => (
          <ToggleRow
            key={field.key}
            title={field.title}
            description={field.description}
            value={state.shareSettings[field.key]}
            disabled={backendBusy}
            onValueChange={() => toggleShare(field.key)}
          />
        ))}
      </Card>

      <Card tone="mint" style={styles.privacyCard}>
        <Text style={styles.privacyIcon}>◇</Text>
        <View style={styles.privacyCopy}>
          <Text style={styles.privacyTitle}>원본 기록은 나만 볼 수 있어요</Text>
          <Text style={styles.privacyBody}>서버도 파트너용 공유본을 별도 문서로 만들고, 허용하지 않은 필드는 포함하지 않아요.</Text>
        </View>
      </Card>

      {backendError && saveAttempted ? (
        <View accessibilityRole="alert" style={styles.errorCard}>
          <Text style={styles.errorText}>{backendError}</Text>
          <TextButton
            label="다시 시도"
            disabled={backendBusy}
            onPress={() => {
              saveSharing().catch(() => undefined);
            }}
          />
        </View>
      ) : null}

      <View style={styles.buttons}>
        <SecondaryButton
          label="추천 설정 적용"
          disabled={backendBusy}
          onPress={useRecommendedSharing}
        />
        <PrimaryButton
          label={
            backendBusy
              ? '공유 설정 저장 중…'
              : selectedCount === 0
                ? '공유 없이 시작'
                : `${selectedCount}개 항목 공유하고 시작`
          }
          disabled={backendBusy}
          onPress={() => {
            saveSharing().catch(() => undefined);
          }}
        />
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
  intro: { marginTop: spacing.md, marginBottom: spacing.lg },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: spacing.lg },
  summaryLabel: { color: colors.text, fontSize: 16, fontWeight: '800' },
  summaryCount: { color: colors.primary, fontSize: 16, fontWeight: '900' },
  card: { paddingVertical: 0 },
  privacyCard: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg, alignItems: 'flex-start' },
  privacyIcon: { color: colors.mint, fontSize: 30, fontWeight: '800' },
  privacyCopy: { flex: 1, gap: spacing.xs },
  privacyTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  privacyBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  errorCard: {
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  buttons: { gap: spacing.md, marginTop: spacing.xl },
});
