import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { PartnerNudgeType } from '../platform/backend/CyclePairBackend';
import { useCyclePair } from '../app/CyclePairStore';
import { Card, TextButton } from './Ui';
import { colors, radius, spacing } from '../theme';

const nudgeCopy: Record<PartnerNudgeType, string> = {
  'check-in-request': '파트너가 “오늘 어때요?”라고 물었어요.',
  'care-acknowledgement': '파트너가 “확인했어요, 챙겨볼게요”라고 전했어요.',
};

function remainingMinutes(value: string | undefined, now: number): number {
  if (!value) return 0;
  const remaining = Date.parse(value) - now;
  return Number.isFinite(remaining) && remaining > 0
    ? Math.ceil(remaining / 60_000)
    : 0;
}

export function PartnerNudgeInbox() {
  const {
    partnerNudgeState,
    nudgeBusy,
    nudgeFeedback,
    acknowledgePartnerNudge,
  } = useCyclePair();
  const received = partnerNudgeState.received;
  if (!received && !nudgeFeedback) return null;

  return (
    <View style={styles.inboxWrap}>
      {received ? (
        <Card tone="mint" style={styles.inboxCard}>
          <View style={styles.inboxCopy}>
            <Text style={styles.inboxEyebrow}>파트너의 넛지</Text>
            <Text style={styles.inboxMessage}>{nudgeCopy[received.type]}</Text>
          </View>
          <TextButton
            label={nudgeBusy ? '처리 중…' : '확인'}
            disabled={nudgeBusy}
            onPress={() => {
              acknowledgePartnerNudge().catch(() => undefined);
            }}
          />
        </Card>
      ) : null}
      {nudgeFeedback ? (
        <Text accessibilityLiveRegion="polite" style={styles.feedback}>
          {nudgeFeedback}
        </Text>
      ) : null}
    </View>
  );
}

function NudgeButton({
  type,
  label,
  disabled,
  remaining,
}: {
  type: PartnerNudgeType;
  label: string;
  disabled: boolean;
  remaining: number;
}) {
  const { nudgeBusy, sendPartnerNudge } = useCyclePair();
  const buttonDisabled = disabled || nudgeBusy || remaining > 0;
  const displayLabel = remaining > 0 ? `${remaining}분 후` : label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: buttonDisabled }}
      disabled={buttonDisabled}
      onPress={() => {
        sendPartnerNudge(type).catch(() => undefined);
      }}
      style={({ pressed }) => [
        styles.nudgeButton,
        type === 'care-acknowledgement' && styles.nudgeButtonAccent,
        pressed && styles.nudgeButtonPressed,
        buttonDisabled && styles.nudgeButtonDisabled,
      ]}
      testID={`partner-nudge-${type}`}
    >
      <Text
        numberOfLines={2}
        style={[
          styles.nudgeButtonText,
          type === 'care-acknowledgement' && styles.nudgeButtonTextAccent,
        ]}
      >
        {displayLabel}
      </Text>
    </Pressable>
  );
}

export function PartnerNudgeActions({
  canAcknowledgeCare,
}: {
  canAcknowledgeCare: boolean;
}) {
  const { partnerNudgeState } = useCyclePair();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const remaining = useMemo(
    () => ({
      checkIn: remainingMinutes(
        partnerNudgeState.nextAllowedAt['check-in-request'],
        now,
      ),
      care: remainingMinutes(
        partnerNudgeState.nextAllowedAt['care-acknowledgement'],
        now,
      ),
    }),
    [now, partnerNudgeState.nextAllowedAt],
  );

  return (
    <View style={styles.actions}>
      <NudgeButton
        type="check-in-request"
        label="오늘 어때요?"
        disabled={false}
        remaining={remaining.checkIn}
      />
      <NudgeButton
        type="care-acknowledgement"
        label="확인했어요, 챙겨볼게요"
        disabled={!canAcknowledgeCare}
        remaining={remaining.care}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  inboxWrap: { gap: spacing.sm, marginBottom: spacing.md },
  inboxCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  inboxCopy: { flex: 1, gap: 2 },
  inboxEyebrow: { color: colors.mint, fontSize: 10, fontWeight: '900' },
  inboxMessage: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  feedback: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  nudgeButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  nudgeButtonAccent: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  nudgeButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  nudgeButtonTextAccent: { color: '#FFFFFF' },
  nudgeButtonPressed: { opacity: 0.72 },
  nudgeButtonDisabled: { opacity: 0.4 },
});
