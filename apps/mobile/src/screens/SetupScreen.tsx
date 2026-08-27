import { parseLocalDate } from '@cyclepair/product-core';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CycleSeed, useCyclePair } from '../app/CyclePairStore';
import { LocalDatePickerField } from '../components/LocalDatePickerField';
import {
  Body,
  Card,
  Chip,
  PrimaryButton,
  Screen,
  Stepper,
  TextButton,
  Title,
  ToggleRow,
} from '../components/Ui';
import { colors, radius, spacing } from '../theme';
import {
  hasCurrentSensitiveHealthConsent,
  SENSITIVE_HEALTH_CONSENT_VERSION,
} from '../domain/privacy/SensitiveHealthConsent';

function localToday(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function SetupScreen() {
  const { state, backendBusy, backendError, completeSetup, goBack } =
    useCyclePair();
  const [isLogger, setLogger] = useState(state.isLogger);
  const [hasCycleSeed, setHasCycleSeed] = useState(state.hasCycleSeed);
  const [seed, setSeed] = useState<CycleSeed>(state.seed);
  const [consentAccepted, setConsentAccepted] = useState(
    hasCurrentSensitiveHealthConsent(
      state.sensitiveDataConsentAcceptedAt,
      state.sensitiveDataConsentVersion,
    ),
  );
  const [saveAttempted, setSaveAttempted] = useState(false);
  const submittingRef = useRef(false);
  const roleLocked = hasCurrentSensitiveHealthConsent(
    state.sensitiveDataConsentAcceptedAt,
    state.sensitiveDataConsentVersion,
  );
  const today = localToday();
  const hasFutureStartDate =
    isLogger && hasCycleSeed && seed.lastPeriodStart > today;

  async function saveSetup() {
    if (
      submittingRef.current ||
      backendBusy ||
      !consentAccepted ||
      hasFutureStartDate
    ) {
      return;
    }
    submittingRef.current = true;
    setSaveAttempted(true);
    try {
      await completeSetup({
        isLogger,
        ...(isLogger && hasCycleSeed ? { seed } : {}),
        consentAcceptedAt: new Date().toISOString(),
        consentVersion: SENSITIVE_HEALTH_CONSENT_VERSION,
      });
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <TextButton label="이전" onPress={goBack} />
        <Text style={styles.step}>시작 설정</Text>
      </View>
      <Title>어떤 기록을{`\n`}남길까요?</Title>
      <Body muted style={styles.intro}>
        파트너 연결 없이 시작할 수 있고, 기록은 자동으로 공유되지 않아요.
      </Body>

      <Text style={styles.label}>기록 방식</Text>
      <View style={styles.roleGrid}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{
            checked: isLogger,
            disabled: roleLocked || backendBusy,
          }}
          disabled={roleLocked || backendBusy}
          onPress={() => setLogger(true)}
          style={[
            styles.roleCard,
            isLogger && styles.roleCardSelected,
            roleLocked && styles.roleCardLocked,
          ]}
        >
          <Text style={styles.roleIcon}>∞</Text>
          <Text style={styles.roleTitle}>주기와 컨디션 기록</Text>
          <Text style={styles.roleBody}>생리 주기와 오늘의 상태를 기록해요</Text>
        </Pressable>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{
            checked: !isLogger,
            disabled: roleLocked || backendBusy,
          }}
          disabled={roleLocked || backendBusy}
          onPress={() => setLogger(false)}
          style={[
            styles.roleCard,
            !isLogger && styles.roleCardSelected,
            roleLocked && styles.roleCardLocked,
          ]}
        >
          <Text style={styles.roleIcon}>♡</Text>
          <Text style={styles.roleTitle}>컨디션만 기록</Text>
          <Text style={styles.roleBody}>주기 없이 오늘의 상태만 기록해요</Text>
        </Pressable>
      </View>
      {roleLocked ? (
        <Text style={styles.roleLockNote}>
          기존 기록을 보호하기 위해 이 화면에서는 기록 방식을 바꿀 수 없어요.
        </Text>
      ) : null}

      {isLogger ? (
        <>
          <Text style={styles.label}>다음 생리 예상</Text>
          <Card>
            <ToggleRow
              title="다음 생리일 미리 보기"
              description="최근 생리일과 평소 주기를 바탕으로 다음 예상 범위를 보여드려요."
              value={hasCycleSeed}
              disabled={backendBusy}
              onValueChange={setHasCycleSeed}
            />
            {hasCycleSeed ? (
              <>
                <Text style={styles.cardLabel}>최근 생리 시작일</Text>
                <View style={styles.datePicker}>
                  <LocalDatePickerField
                    accessibilityLabel="최근 생리 시작일"
                    disabled={backendBusy}
                    maximumDate={parseLocalDate(today)}
                    onChange={lastPeriodStart =>
                      setSeed(current => ({ ...current, lastPeriodStart }))
                    }
                    testID="last-period-start-date-picker"
                    value={parseLocalDate(seed.lastPeriodStart)}
                  />
                </View>
                {hasFutureStartDate ? (
                  <Text style={styles.errorText}>
                    최근 생리 시작일은 오늘 이후로 설정할 수 없어요.
                  </Text>
                ) : null}
                <Stepper
                  label="다음 생리까지 보통"
                  value={seed.averageCycleLength}
                  suffix="일"
                  min={21}
                  max={45}
                  disabled={backendBusy}
                  onChange={averageCycleLength =>
                    setSeed(current => ({ ...current, averageCycleLength }))
                  }
                />
                <Stepper
                  label="생리가 보통"
                  value={seed.averagePeriodLength}
                  suffix="일"
                  min={2}
                  max={10}
                  disabled={backendBusy}
                  onChange={averagePeriodLength =>
                    setSeed(current => ({ ...current, averagePeriodLength }))
                  }
                />
              </>
            ) : (
              <Body muted>
                지금은 건너뛰어도 돼요. 실제 생리일은 언제든 기록할 수 있어요.
              </Body>
            )}
          </Card>
          <View style={styles.notice}>
            <Text style={styles.noticeIcon}>i</Text>
            <Text style={styles.noticeText}>
              예상일은 참고용이에요. 피임이나 의료 판단에는 사용하지 마세요.
            </Text>
          </View>
        </>
      ) : (
        <Card tone="primary" style={styles.partnerOnlyCard}>
          <Chip label="컨디션만 기록" selected />
          <Body style={styles.partnerOnlyBody}>
            주기 정보 없이 기분, 증상, 필요한 도움을 기록해요.
          </Body>
        </Card>
      )}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="주기·컨디션 정보 이용 동의"
        accessibilityState={{ checked: consentAccepted, disabled: backendBusy }}
        disabled={backendBusy}
        onPress={() => setConsentAccepted(value => !value)}
        style={[
          styles.consentCard,
          consentAccepted && styles.consentCardSelected,
        ]}
      >
        <View
          style={[styles.checkbox, consentAccepted && styles.checkboxSelected]}
        >
          {consentAccepted ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <View style={styles.consentCopy}>
          <Text style={styles.consentTitle}>
            주기·컨디션 정보 이용에 동의해요
          </Text>
          <Text style={styles.consentBody}>
            입력한 정보는 기록과 예상에만 사용하고, 선택한 항목만 파트너에게
            공유해요.
          </Text>
        </View>
      </Pressable>

      {backendError && saveAttempted ? (
        <View accessibilityRole="alert" style={styles.errorCard}>
          <Text style={styles.errorText}>{backendError}</Text>
          <TextButton
            label="다시 시도"
            disabled={backendBusy || !consentAccepted || hasFutureStartDate}
            onPress={() => {
              saveSetup().catch(() => undefined);
            }}
          />
        </View>
      ) : null}

      <View style={styles.footer}>
        <PrimaryButton
          label={backendBusy ? '저장 중…' : '저장하고 시작'}
          disabled={backendBusy || !consentAccepted || hasFutureStartDate}
          onPress={() => {
            saveSetup().catch(() => undefined);
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
  },
  step: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    marginBottom: spacing.lg,
  },
  intro: { marginTop: spacing.md, marginBottom: spacing.xl },
  label: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: spacing.md,
    marginTop: spacing.lg,
  },
  roleGrid: { flexDirection: 'row', gap: spacing.md },
  roleCard: {
    flex: 1,
    minHeight: 164,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  roleCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  roleCardLocked: { opacity: 0.78 },
  roleLockNote: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  roleIcon: { color: colors.primary, fontSize: 30, fontWeight: '700' },
  roleTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  roleBody: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  cardLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  datePicker: { marginVertical: spacing.md },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    alignItems: 'flex-start',
  },
  noticeIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    fontWeight: '800',
  },
  noticeText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  partnerOnlyCard: { marginTop: spacing.lg, gap: spacing.lg },
  partnerOnlyBody: { color: colors.primaryDark },
  consentCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  consentCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  checkmark: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  consentCopy: { flex: 1, gap: spacing.xs },
  consentTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  consentBody: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
  errorCard: {
    gap: spacing.sm,
    marginTop: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
  },
  errorText: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  footer: { marginTop: spacing.xxl },
});
