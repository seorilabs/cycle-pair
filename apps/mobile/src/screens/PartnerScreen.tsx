import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  buildPartnerSharedFields,
  getSafePartnerProjectionForToday,
  getPartnerProjectionFreshness,
} from '../app/partnerProjectionPresentation';
import { useCyclePair } from '../app/CyclePairStore';
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
  const preferenceCopy: Record<string, { title: string; body: string }> = {
    listen: {
      title: '그냥 이야기를 들어주세요',
      body: '해결책보다 편하게 들어주는 것이 좋아요.',
    },
    'quiet-space': {
      title: '조용히 쉴 시간을 주세요',
      body: '답을 재촉하지 않고 쉬도록 배려해 주세요.',
    },
    warmth: {
      title: '따뜻하게 챙겨주세요',
      body: '따뜻한 음료나 찜질팩이 필요한지 가볍게 물어보세요.',
    },
    'meal-support': {
      title: '식사를 챙겨주세요',
      body: '먹고 싶은 것이 있는지 먼저 물어보고 준비를 도와주세요.',
    },
    'schedule-flexibility': {
      title: '일정을 여유롭게 해주세요',
      body: '부담되는 일정을 조정할지 가볍게 확인해 주세요.',
    },
    'practical-help': {
      title: '실질적인 도움을 주세요',
      body: '지금 대신할 수 있는 작은 일이 있는지 물어봐 주세요.',
    },
    'check-in': {
      title: '가볍게 상태를 물어봐 주세요',
      body: '답을 재촉하지 않고 필요한 것이 있는지만 확인해 주세요.',
    },
    'no-action': {
      title: '평소처럼 대해주세요',
      body: '특별히 추측하거나 과하게 챙기지 않는 것이 좋아요.',
    },
  };
  const preferenceTag = remote?.carePreferences?.find(
    value => preferenceCopy[value],
  );
  const preference = preferenceTag ? preferenceCopy[preferenceTag] : undefined;
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
        {preference ? (
          <View style={styles.preferenceInline}>
            <Text style={styles.preferenceLabel}>원하는 도움</Text>
            <View style={styles.preferenceCopy}>
              <Text style={styles.preferenceTitle}>{preference.title}</Text>
              <Text style={styles.preferenceBody}>{preference.body}</Text>
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
  preferenceCopy: { flex: 1, gap: spacing.xs },
  preferenceTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  preferenceBody: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
