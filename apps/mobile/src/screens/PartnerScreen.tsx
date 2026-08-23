import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { buildCycleViewModel } from '../app/cycleViewModel';
import {
  buildPartnerSharedFields,
  getSafePartnerProjectionForToday,
  getPartnerProjectionFreshness,
} from '../app/partnerProjectionPresentation';
import { useCyclePair } from '../app/CyclePairStore';
import { useSubscription } from '../app/subscription/SubscriptionContext';
import { resolveCycleFeaturePolicy } from '../app/subscription/cycleFeaturePolicy';
import {
  Body,
  Card,
  Chip,
  PrimaryButton,
  Screen,
  Title,
} from '../components/Ui';
import { colors, spacing } from '../theme';
import {
  PartnerNudgeActions,
  PartnerNudgeInbox,
} from '../components/PartnerNudges';

export function PartnerScreen() {
  const { state, openPairing, continueToSharing } = useCyclePair();
  const { hasFeature } = useSubscription();
  const featurePolicy = resolveCycleFeaturePolicy(hasFeature);
  const viewModel = buildCycleViewModel(state, featurePolicy);

  if (!state.paired) {
    return (
      <Screen contentStyle={styles.content}>
        <Text style={styles.soloEyebrow}>선택 기능</Text>
        <Title>혼자 기록하다가{`\n`}필요할 때 연결해요</Title>
        <Body muted style={styles.soloIntro}>
          주기와 오늘의 컨디션은 파트너 없이도 계속 관리할 수 있어요.
        </Body>

        <Card tone="primary" style={styles.soloCard}>
          <View style={styles.soloIcon}>
            <Text style={styles.soloIconText}>♡</Text>
          </View>
          <Text style={styles.soloTitle}>한 사람과 선택적으로 공유</Text>
          <Text style={styles.soloBody}>
            상대가 초대를 수락한 뒤에도 기본값은 비공개예요. 보여줄 항목은 직접
            고릅니다.
          </Text>
          <PrimaryButton label="파트너 연결하기" onPress={openPairing} />
        </Card>

      </Screen>
    );
  }

  if (!state.sharingCompleted) {
    return (
      <Screen contentStyle={styles.content}>
        <Text style={styles.soloEyebrow}>연결 완료</Text>
        <Title>보여줄 항목을{`\n`}직접 선택해 주세요</Title>
        <Body muted style={styles.soloIntro}>
          Pair는 연결됐지만 아직 어떤 건강 정보도 공유되지 않았어요.
        </Body>
        <Card tone="primary" style={styles.soloCard}>
          <Text style={styles.soloTitle}>기본값은 모두 비공개</Text>
          <Text style={styles.soloBody}>
            공유 설정을 마친 뒤에도 언제든 항목별로 다시 끌 수 있습니다.
          </Text>
          <PrimaryButton
            label="공유 설정 계속하기"
            onPress={continueToSharing}
          />
        </Card>
      </Screen>
    );
  }

  const rawRemote = state.partnerProjection;
  const remote = getSafePartnerProjectionForToday(rawRemote);
  const hasDirectCareContext = Boolean(
    remote?.carePreferences?.length || remote?.conditionCode,
  );
  const sharedFields = buildPartnerSharedFields(remote);
  const freshness = getPartnerProjectionFreshness(rawRemote);
  const mood = sharedFields.find(field => field.key === 'moodTag');
  const hasSharedValues = sharedFields.length > 0;
  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>파</Text>
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>연결된 파트너</Text>
          <Text style={styles.title}>{state.partnerName} 님의 오늘</Text>
          <View style={styles.updatedRow}>
            <Text style={styles.updated}>{freshness.label} · 직접 공유</Text>
            {freshness.stale ? (
              <View style={styles.staleBadge}>
                <Text style={styles.staleBadgeText}>오래됨</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <PartnerNudgeInbox />

      <Card tone="accent" style={styles.statusCard}>
        <Text style={styles.statusTitle}>
          {mood
            ? `오늘은 ${mood.value}`
            : hasSharedValues
            ? '직접 공유한 정보가 있어요'
            : '아직 공유된 오늘 정보가 없어요'}
        </Text>
        <Text style={styles.statusBody}>
          {hasSharedValues
            ? `주기만으로 추측하지 않고 ${state.partnerName} 님이 허용한 항목만 표시해요.`
            : '상대가 공유할 항목을 선택하면 이 화면에 나타나요.'}
        </Text>
        <View style={styles.sharedChips}>
          {sharedFields.map(field => (
            <Chip key={field.key} label={field.label} />
          ))}
        </View>
        {hasSharedValues ? (
          <View style={styles.sharedValuesCard}>
            {sharedFields.map((field, index) => (
              <View
                accessibilityLabel={`${field.label}: ${field.value}`}
                key={field.key}
                style={[
                  styles.sharedValueRow,
                  index > 0 && styles.sharedValueDivider,
                ]}
              >
                <Text style={styles.sharedValueLabel}>{field.label}</Text>
                <Text
                  style={[
                    styles.sharedValue,
                    field.key === 'note' && styles.sharedNote,
                  ]}
                >
                  {field.value}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptySharedCard}>
            <Text style={styles.emptySharedTitle}>
              아직 공유된 정보가 없어요
            </Text>
            <Text style={styles.emptySharedBody}>
              연결 정보만 확인됐으며 건강 정보는 전달되지 않았어요.
            </Text>
          </View>
        )}
        {hasDirectCareContext && viewModel.careTips.length > 0 ? (
          <View style={styles.preferenceInline}>
            <Text style={styles.preferenceLabel}>원하는 도움</Text>
            <View style={styles.preferenceList}>
              {viewModel.careTips.map((tip, index) => (
                <View
                  key={tip.id}
                  style={[
                    styles.preferenceCopy,
                    index > 0 && styles.preferenceDivider,
                  ]}
                >
                  <Text style={styles.preferenceTitle}>{tip.title}</Text>
                  <Text style={styles.preferenceBody}>{tip.body}</Text>
                </View>
              ))}
              {!featurePolicy.fullCareTipsEnabled ? (
                <View
                  accessibilityLabel="Plus 도움 팁 잠김"
                  style={styles.careTipsLock}
                >
                  <Text style={styles.careTipsLockText}>
                    🔒 공유된 도움 팁 전체 보기는 Plus 기능이에요.
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
        <PartnerNudgeActions canAcknowledgeCare={hasSharedValues} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  soloEyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: spacing.sm,
  },
  soloIntro: { marginTop: spacing.md },
  soloCard: { alignItems: 'stretch', gap: spacing.md, marginTop: spacing.xl },
  soloIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soloIconText: { color: colors.primary, fontSize: 31 },
  soloTitle: { color: colors.primaryDark, fontSize: 18, fontWeight: '900' },
  soloBody: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginBottom: spacing.xl,
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  headerCopy: { flex: 1, gap: 2 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  updated: { color: colors.textMuted, fontSize: 11 },
  updatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  staleBadge: {
    borderRadius: 999,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  staleBadgeText: { color: colors.danger, fontSize: 9, fontWeight: '900' },
  statusCard: { padding: spacing.xl },
  statusTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '900',
    marginTop: spacing.sm,
  },
  statusBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  sharedChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  sharedValuesCard: {
    paddingVertical: spacing.sm,
    marginTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F0CBBE',
  },
  sharedValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  sharedValueDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sharedValueLabel: {
    width: 104,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
  },
  sharedValue: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'right',
    fontWeight: '700',
  },
  sharedNote: { textAlign: 'left', fontWeight: '500' },
  emptySharedCard: {
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F0CBBE',
  },
  emptySharedTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  emptySharedBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  preferenceInline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F0CBBE',
    paddingTop: spacing.lg,
    marginTop: spacing.sm,
  },
  preferenceLabel: {
    width: 72,
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
  },
  preferenceList: { flex: 1 },
  preferenceCopy: { flex: 1, gap: spacing.xs },
  preferenceDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F0CBBE',
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  preferenceTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  preferenceBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  careTipsLock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F0CBBE',
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  careTipsLockText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
  },
});
