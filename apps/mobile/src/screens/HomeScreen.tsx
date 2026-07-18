import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { buildCycleViewModel, formatKoreanDate } from '../app/cycleViewModel';
import {
  buildPartnerSharedFields,
  getSafePartnerProjectionForToday,
} from '../app/partnerProjectionPresentation';
import { useCyclePair } from '../app/CyclePairStore';
import {
  Card,
  Chip,
  Screen,
  SectionHeader,
  TextButton,
} from '../components/Ui';
import { colors, spacing } from '../theme';

export function HomeScreen({ onOpenRecord }: { onOpenRecord(): void }) {
  const { state, setTab } = useCyclePair();
  const viewModel = buildCycleViewModel(state);
  const hasCheckIn = Boolean(
    state.checkIn.mood ||
      state.checkIn.symptoms.length ||
      state.checkIn.energy ||
      state.checkIn.condition ||
      state.checkIn.carePreference ||
      state.checkIn.note ||
      state.checkIn.periodStarted ||
      state.checkIn.periodEnded,
  );
  const syncCopy = {
    idle: '동기화 준비됨',
    syncing: '안전하게 동기화 중…',
    queued: '오프라인 저장됨 · 연결되면 자동 동기화',
    synced: '최신 기록 동기화 완료',
    error: '동기화에 실패했어요 · 연결 상태를 확인해 주세요',
  }[state.syncStatus];
  const partnerMoodCopy: Record<string, string> = {
    'very-low': '오늘은 많이 힘들어요',
    low: '오늘은 조금 지쳐 있어요',
    neutral: '오늘은 괜찮아요',
    good: '오늘은 기분이 좋아요',
    'very-good': '오늘은 아주 좋아요',
  };
  const safePartnerProjection = getSafePartnerProjectionForToday(
    state.partnerProjection,
  );
  const hasPartnerSharedValues =
    buildPartnerSharedFields(safePartnerProjection).length > 0;
  const partnerMood = safePartnerProjection?.moodTag;

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.date}>
            {formatKoreanDate(viewModel.today)} · 오늘
          </Text>
          <Text style={styles.greeting}>
            {state.isLogger ? (
              <>천천히, 내 몸의{`\n`}리듬을 살펴봐요</>
            ) : state.paired ? (
              <>함께, 상대의{`\n`}오늘을 살펴봐요</>
            ) : (
              <>오늘 나의{`\n`}컨디션을 살펴봐요</>
            )}
          </Text>
        </View>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>나</Text>
        </View>
      </View>

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
              {state.isLogger
                ? state.hasCycleSeed
                  ? viewModel.phaseTitle
                  : '예측 기준 없음'
                : '사용하지 않음'}
            </Text>
            {state.isLogger && state.hasCycleSeed && viewModel.cycleDay ? (
              <Text style={styles.phaseDay}>
                주기 {viewModel.cycleDay}일째 · 참고용
              </Text>
            ) : null}
          </View>
        </View>
        <Text style={styles.phaseDescription}>
          {state.isLogger
            ? state.hasCycleSeed
              ? viewModel.phaseDescription
              : '오늘의 상태는 계속 기록할 수 있어요. 날짜와 평균을 직접 입력하기 전에는 예측하지 않아요.'
            : state.paired
            ? '내 주기 날짜나 예측은 만들지 않고, 상대가 직접 공유한 내용만 보여드려요.'
            : '주기 예측 없이 오늘의 기분·증상·도움 선호를 나만의 기록으로 남길 수 있어요.'}
        </Text>
        <View style={styles.predictionRow}>
          <View>
            <Text style={styles.predictionLabel}>내 다음 예상 범위</Text>
            <Text style={styles.predictionValue}>
              {!state.isLogger
                ? '기록하지 않아요'
                : !state.hasCycleSeed
                ? '예측 기준을 설정해 주세요'
                : viewModel.predictionStart && viewModel.predictionEnd
                ? `${formatKoreanDate(
                    viewModel.predictionStart,
                  )} – ${formatKoreanDate(viewModel.predictionEnd)}`
                : '기록이 더 필요해요'}
            </Text>
          </View>
          {state.isLogger &&
          state.hasCycleSeed &&
          viewModel.daysUntilPrediction !== undefined &&
          viewModel.daysUntilPrediction >= 0 ? (
            <Chip label={`D-${viewModel.daysUntilPrediction}`} selected />
          ) : null}
        </View>
      </Card>

      {state.syncStatus !== 'idle' ? (
        <View style={styles.syncRow}>
          <View
            style={[
              styles.syncDot,
              state.syncStatus === 'queued' && styles.syncDotQueued,
              state.syncStatus === 'error' && styles.syncDotError,
            ]}
          />
          <Text style={styles.syncText}>{syncCopy}</Text>
        </View>
      ) : null}

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
                    state.checkIn.mood,
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
                <Text style={styles.partnerTitle}>
                  {partnerMood
                    ? partnerMoodCopy[partnerMood] ?? '공유된 상태가 있어요'
                    : '아직 공유된 상태가 없어요'}
                </Text>
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
            <View style={styles.careDivider} />
            <Text style={styles.careEyebrow}>오늘의 케어 힌트</Text>
            <Text style={styles.careTitle}>{viewModel.careTip.title}</Text>
            <Text style={styles.careBody}>{viewModel.careTip.body}</Text>
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
          </Card>
        </>
      )}

      <Text style={styles.disclaimer}>
        주기 예측과 케어 힌트는 참고 정보이며 의료 진단·치료 또는 피임 도구가
        아닙니다.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.xl,
  },
  date: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  greeting: {
    color: colors.text,
    fontSize: 27,
    lineHeight: 35,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primaryDark, fontSize: 14, fontWeight: '900' },
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
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
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
  careDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#F0CBBE',
    marginVertical: spacing.lg,
  },
  careEyebrow: {
    color: '#A45E46',
    fontSize: 11,
    fontWeight: '900',
    marginBottom: spacing.xs,
  },
  careTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  careBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  disclaimer: {
    color: colors.textSubtle,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
});
