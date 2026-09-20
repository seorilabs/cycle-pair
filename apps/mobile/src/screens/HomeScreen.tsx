import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buildCycleViewModel, formatKoreanDate } from '../app/cycleViewModel';
import {
  buildPartnerSharedFields,
  buildPartnerTodaySummary,
  getSafePartnerProjectionForToday,
} from '../app/partnerProjectionPresentation';
import { useCyclePair } from '../app/CyclePairStore';
import { useSubscription } from '../app/subscription/SubscriptionContext';
import { resolveCycleFeaturePolicy } from '../app/subscription/cycleFeaturePolicy';
import {
  Card,
  Chip,
  Screen,
  SectionHeader,
  TextButton,
} from '../components/Ui';
import { colors, spacing } from '../theme';
import { emotionLabel } from '../app/emotions';
import {
  PartnerNudgeActions,
  PartnerNudgeInbox,
} from '../components/PartnerNudges';

export function HomeScreen({ onOpenRecord }: { onOpenRecord(): void }) {
  const { state, setTab } = useCyclePair();
  const { hasFeature } = useSubscription();
  const featurePolicy = resolveCycleFeaturePolicy(hasFeature);
  const viewModel = buildCycleViewModel(state, featurePolicy);
  const hasCheckIn = Boolean(
    state.checkIn.emotions?.length ||
      state.checkIn.symptoms.length ||
      state.checkIn.energy ||
      state.checkIn.condition ||
      state.checkIn.carePreference ||
      state.checkIn.note ||
      state.checkIn.periodStarted ||
      state.checkIn.periodEnded,
  );
  const syncCopy = {
    idle: '동기화 준비',
    syncing: '동기화 중',
    queued: '오프라인 저장',
    synced: '동기화 완료',
    error: '동기화 오류',
  }[state.syncStatus];
  const safePartnerProjection = getSafePartnerProjectionForToday(
    state.partnerProjection,
  );
  const partnerSharedFields = buildPartnerSharedFields(safePartnerProjection);
  const hasPartnerSharedValues = partnerSharedFields.length > 0;
  const partnerSummary = buildPartnerTodaySummary(safePartnerProjection);

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.date}>
          {formatKoreanDate(viewModel.today)} · 오늘
        </Text>
        <View style={styles.headlineRow}>
          <Text numberOfLines={1} style={styles.greeting}>
            {state.isLogger
              ? '천천히, 내 몸의 리듬을 살펴봐요'
              : state.paired
              ? '함께, 상대의 오늘을 살펴봐요'
              : '오늘 나의 컨디션을 살펴봐요'}
          </Text>
          {state.syncStatus !== 'idle' ? (
            <View accessibilityLabel={syncCopy} style={styles.syncRow}>
              <View
                style={[
                  styles.syncDot,
                  state.syncStatus === 'queued' && styles.syncDotQueued,
                  state.syncStatus === 'error' && styles.syncDotError,
                ]}
              />
              <Text numberOfLines={1} style={styles.syncText}>
                {syncCopy}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {state.paired ? <PartnerNudgeInbox /> : null}

      {state.paired && state.sharingCompleted ? (
        <>
          <SectionHeader
            title={`${state.partnerName} 님의 오늘`}
            action={
              <TextButton label="자세히" onPress={() => setTab('partner')} />
            }
          />
          <Card tone="accent" style={styles.partnerCard}>
            <View style={styles.partnerHeader}>
              <View style={styles.partnerAvatar}>
                <Text style={styles.partnerAvatarText}>파</Text>
              </View>
              <View style={styles.partnerCopy}>
                <Text style={styles.partnerTitle}>오늘 상태 한눈에 보기</Text>
                <Text style={styles.partnerBody}>
                  {hasPartnerSharedValues
                    ? '상대가 오늘 직접 허용한 정보예요'
                    : '오늘 공유된 항목을 기다리는 중이에요'}
                </Text>
              </View>
              <Chip
                label={
                  hasPartnerSharedValues ? '오늘 공유됨' : '오늘 정보 없음'
                }
                selected={hasPartnerSharedValues}
              />
            </View>
            <View style={styles.partnerStatusGrid}>
              <View style={styles.partnerStatusBlock}>
                <Text style={styles.partnerStatusLabel}>생리·주기 상태</Text>
                <Text style={styles.partnerStatusTitle}>
                  {partnerSummary.cycleTitle ?? '공유된 주기 상태가 없어요'}
                </Text>
                <Text style={styles.partnerStatusBody}>
                  {partnerSummary.cycleDetail ??
                    '파트너가 공유를 켜면 오늘의 주기 흐름을 볼 수 있어요.'}
                </Text>
              </View>
              <View style={styles.partnerStatusDivider} />
              <View style={styles.partnerStatusBlock}>
                <Text style={styles.partnerStatusLabel}>오늘의 컨디션</Text>
                <Text style={styles.partnerStatusTitle}>
                  {partnerSummary.conditionTitle}
                </Text>
                <Text style={styles.partnerStatusBody}>
                  {partnerSummary.conditionDetail}
                </Text>
                {partnerSummary.conditionTags.length > 0 ? (
                  <View style={styles.partnerTags}>
                    {partnerSummary.conditionTags.map(tag => (
                      <Chip key={tag} label={tag} />
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
            <PartnerNudgeActions canAcknowledgeCare={hasPartnerSharedValues} />
          </Card>
        </>
      ) : (
        <>
          <SectionHeader
            title={state.paired ? '공유 설정' : '파트너 연결'}
            action={
              <TextButton
                label={state.paired ? '계속' : '선택'}
                onPress={() => setTab('partner')}
              />
            }
          />
          <Card tone="accent" style={styles.partnerCard}>
            <Text style={styles.soloPartnerTitle}>
              {state.paired
                ? '아직 공유된 정보가 없어요'
                : '지금은 혼자 기록하고 있어요'}
            </Text>
            <Text style={styles.soloPartnerBody}>
              {state.paired
                ? '파트너 탭에서 공유할 항목을 직접 선택해 주세요.'
                : '내 기록과 예측은 그대로 사용할 수 있고, 연결은 나중에 선택할 수 있어요.'}
            </Text>
            {state.paired ? (
              <PartnerNudgeActions canAcknowledgeCare={false} />
            ) : null}
          </Card>
        </>
      )}

      <SectionHeader
        title="오늘의 체크인"
        action={<TextButton label="기록하기" onPress={onOpenRecord} />}
      />
      <Pressable accessibilityRole="button" onPress={onOpenRecord}>
        <Card style={styles.checkInCard}>
          <View style={styles.checkIcon}>
            <Text style={styles.checkIconText}>{hasCheckIn ? '✓' : '+'}</Text>
          </View>
          <View style={styles.checkCopy}>
            <Text style={styles.checkTitle}>
              {hasCheckIn ? '오늘 기록을 남겼어요' : '지금 컨디션은 어떤가요?'}
            </Text>
            <Text style={styles.checkBody}>
              {hasCheckIn
                ? [
                    ...(state.checkIn.emotions ?? []).map(emotionLabel),
                    ...state.checkIn.symptoms,
                    state.checkIn.carePreference,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : '30초면 충분해요. 공유 여부는 따로 결정돼요.'}
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Card>
      </Pressable>

      {state.isLogger ? (
        <>
          <SectionHeader title="나의 주기" />
          <Card tone="primary" style={styles.phaseCard}>
            <View style={styles.phaseTop}>
              <View style={styles.phaseRing}>
                <View style={styles.phaseRingInner}>
                  <Text style={styles.phaseMark}>∞</Text>
                </View>
              </View>
              <View style={styles.phaseCopy}>
                <Text style={styles.phaseEyebrow}>나의 주기 기록</Text>
                <Text style={styles.phaseTitle}>
                  {state.hasCycleSeed ? viewModel.phaseTitle : '다음 생리 예상 꺼짐'}
                </Text>
                {state.hasCycleSeed && viewModel.cycleDay ? (
                  <Text style={styles.phaseDay}>
                    주기 {viewModel.cycleDay}일째 · 참고용
                  </Text>
                ) : null}
              </View>
            </View>
            <Text style={styles.phaseDescription}>
              {state.hasCycleSeed
                ? viewModel.phaseDescription
                : '최근 생리일과 평소 주기를 입력하면 다음 예상 범위를 보여드려요.'}
            </Text>
            <View style={styles.predictionRow}>
              <View>
                <Text style={styles.predictionLabel}>
                  {viewModel.daysLate ? '마지막 예상 범위' : '내 다음 예상 범위'}
                </Text>
                <Text style={styles.predictionValue}>
                  {!state.hasCycleSeed
                    ? '설정에서 다음 생리 예상을 켜주세요'
                    : viewModel.predictionStart && viewModel.predictionEnd
                    ? `${formatKoreanDate(
                        viewModel.predictionStart,
                        viewModel.today,
                      )} – ${formatKoreanDate(
                        viewModel.predictionEnd,
                        viewModel.today,
                      )}`
                    : '기록이 더 필요해요'}
                </Text>
                {viewModel.daysLate ? (
                  <Text style={styles.lateNotice}>
                    예정일에서 {viewModel.daysLate}일 지났어요. 새 주기가
                    시작됐다면 기록해 주세요.
                  </Text>
                ) : null}
              </View>
              {state.hasCycleSeed &&
              viewModel.daysUntilPrediction !== undefined ? (
                <Chip
                  label={
                    viewModel.daysLate
                      ? `지연 ${viewModel.daysLate}일`
                      : `D-${viewModel.daysUntilPrediction}`
                  }
                  selected
                />
              ) : null}
            </View>
            {state.hasCycleSeed ? (
              <View style={styles.featureAccess}>
                <Text style={styles.historyAccessText}>
                  {featurePolicy.extendedHistoryEnabled
                    ? '최근 10년 기록을 예측에 반영해요.'
                    : '최근 12개월 기록을 반영해요. 더 오래된 기록 반영은 Plus 기능이에요.'}
                </Text>
                {viewModel.advancedPrediction ? (
                  <View style={styles.predictionDetail}>
                    <Text style={styles.predictionDetailTitle}>예측 근거</Text>
                    <Text style={styles.predictionDetailBody}>
                      평균 {viewModel.advancedPrediction.averageCycleLengthDays}일
                      {' · '}관측 {viewModel.advancedPrediction.sampleSize}개
                      {' · '}신뢰도{' '}
                      {{ low: '낮음', medium: '보통', high: '높음' }[
                        viewModel.advancedPrediction.confidence
                      ]}
                    </Text>
                    <Text style={styles.predictionDetailMeta}>
                      {viewModel.advancedPrediction.observedCycleLengths.length >
                      0
                        ? `최근 주기 ${viewModel.advancedPrediction.observedCycleLengths.join(
                            ' · ',
                          )}일 · 표준편차 ${
                            viewModel.advancedPrediction.standardDeviationDays
                          }일`
                        : '관측된 주기가 더 쌓이면 상세 근거를 표시해요.'}
                    </Text>
                  </View>
                ) : (
                  <View
                    accessibilityLabel="Plus 예측 상세 잠김"
                    style={styles.lockedFeature}
                  >
                    <Text style={styles.lockedFeatureTitle}>
                      🔒 Plus 예측 상세
                    </Text>
                    <Text style={styles.lockedFeatureBody}>
                      관측 주기와 신뢰도 근거는 Plus에서 확인할 수 있어요.
                    </Text>
                  </View>
                )}
              </View>
            ) : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  header: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  date: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  headlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  greeting: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  phaseCard: { padding: spacing.xl, borderColor: '#DCD0EF' },
  phaseTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  phaseRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 8,
    borderColor: 'rgba(124,105,184,0.18)',
    borderTopColor: colors.primary,
    borderRightColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-22deg' }],
  },
  phaseRingInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseMark: { color: colors.primary, fontSize: 36, lineHeight: 43 },
  phaseCopy: { flex: 1 },
  phaseEyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: spacing.xs,
  },
  phaseTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  phaseDay: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs },
  phaseDescription: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.lg,
  },
  predictionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D5C8E9',
  },
  predictionLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  predictionValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  lateNotice: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
    maxWidth: 220,
  },
  featureAccess: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  historyAccessText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
  },
  predictionDetail: {
    gap: spacing.xs,
    borderRadius: 14,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  predictionDetailTitle: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  predictionDetailBody: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  predictionDetailMeta: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
  },
  lockedFeature: {
    gap: spacing.xs,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.58)',
    padding: spacing.md,
  },
  lockedFeatureTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '900',
  },
  lockedFeatureBody: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 999,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  syncDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.mint,
  },
  syncDotQueued: { backgroundColor: colors.accent },
  syncDotError: { backgroundColor: colors.danger },
  syncText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  checkInCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  checkIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.mintSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIconText: { color: colors.mint, fontSize: 24, fontWeight: '800' },
  checkCopy: { flex: 1, gap: spacing.xs },
  checkTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  checkBody: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  chevron: { color: colors.textSubtle, fontSize: 28 },
  partnerCard: { padding: spacing.xl },
  soloPartnerTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  soloPartnerBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  partnerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  partnerAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  partnerAvatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  partnerCopy: { flex: 1, gap: 2 },
  partnerTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  partnerBody: { color: colors.textMuted, fontSize: 11 },
  partnerStatusGrid: {
    gap: spacing.lg,
    marginTop: spacing.xl,
  },
  partnerStatusBlock: { gap: spacing.xs },
  partnerStatusLabel: {
    color: '#A45E46',
    fontSize: 11,
    fontWeight: '900',
  },
  partnerStatusTitle: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '900',
  },
  partnerStatusBody: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  partnerStatusDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#F0CBBE',
  },
  partnerTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
