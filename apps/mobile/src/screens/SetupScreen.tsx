import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CycleSeed, useCyclePair } from '../app/CyclePairStore';
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

function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  const shiftedYear = date.getFullYear();
  const shiftedMonth = String(date.getMonth() + 1).padStart(2, '0');
  const shiftedDay = String(date.getDate()).padStart(2, '0');
  return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${year}. ${Number(month)}. ${Number(day)}.`;
}

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
    Boolean(state.sensitiveDataConsentAcceptedAt),
  );
  const [saveAttempted, setSaveAttempted] = useState(false);
  const submittingRef = useRef(false);
  const roleLocked = Boolean(state.sensitiveDataConsentAcceptedAt);
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
      });
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <TextButton label="이전" onPress={goBack} />
        <Text style={styles.step}>기본 설정</Text>
      </View>
      <Title>내 기록을 위한{`\n`}기본값을 알려주세요</Title>
      <Body muted style={styles.intro}>
        처음부터 정확할 필요 없어요. 파트너 연결 없이 바로 시작할 수 있고, 이
        값은 누구에게도 자동 공개되지 않아요.
      </Body>

      <Text style={styles.label}>나는</Text>
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
          <Text style={styles.roleTitle}>내 주기를 기록해요</Text>
          <Text style={styles.roleBody}>기록하고 원하는 항목만 공유할게요</Text>
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
          <Text style={styles.roleTitle}>내 주기는 기록하지 않아요</Text>
          <Text style={styles.roleBody}>오늘의 컨디션만 기록할게요</Text>
        </Pressable>
      </View>
      {roleLocked ? (
        <Text style={styles.roleLockNote}>
          기본 설정을 저장한 뒤에는 기록 경계를 보호하기 위해 여기서 역할을
          변경할 수 없어요.
        </Text>
      ) : null}

      {isLogger ? (
        <>
          <Text style={styles.label}>최근 기록</Text>
          <Card>
            <ToggleRow
              title="예측 기준 입력"
              description="정확히 아는 경우에만 켜세요. 끄면 임의 날짜나 평균으로 예측하지 않아요."
              value={hasCycleSeed}
              disabled={backendBusy}
              onValueChange={setHasCycleSeed}
            />
            {hasCycleSeed ? (
              <>
                <Text style={styles.cardLabel}>최근 생리 시작일</Text>
                <View style={styles.dateRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="날짜 하루 전"
                    accessibilityState={{ disabled: backendBusy }}
                    disabled={backendBusy}
                    onPress={() =>
                      setSeed(current => ({
                        ...current,
                        lastPeriodStart: shiftDate(current.lastPeriodStart, -1),
                      }))
                    }
                    style={styles.dateButton}
                  >
                    <Text style={styles.dateButtonText}>‹</Text>
                  </Pressable>
                  <Text style={styles.dateValue}>
                    {formatDate(seed.lastPeriodStart)}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="날짜 하루 후"
                    accessibilityState={{
                      disabled: backendBusy || seed.lastPeriodStart >= today,
                    }}
                    disabled={backendBusy || seed.lastPeriodStart >= today}
                    onPress={() =>
                      setSeed(current => ({
                        ...current,
                        lastPeriodStart: shiftDate(current.lastPeriodStart, 1),
                      }))
                    }
                    style={[
                      styles.dateButton,
                      seed.lastPeriodStart >= today &&
                        styles.dateButtonDisabled,
                    ]}
                  >
                    <Text style={styles.dateButtonText}>›</Text>
                  </Pressable>
                </View>
                {hasFutureStartDate ? (
                  <Text style={styles.errorText}>
                    최근 생리 시작일은 오늘 이후로 설정할 수 없어요.
                  </Text>
                ) : null}
                <Stepper
                  label="평균 주기"
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
                  label="평균 기간"
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
                날짜와 평균 없이 시작합니다. 오늘의 상태와 실제 생리 시작·종료
                기록은 계속 남길 수 있어요.
              </Body>
            )}
          </Card>
          <View style={styles.notice}>
            <Text style={styles.noticeIcon}>i</Text>
            <Text style={styles.noticeText}>
              예측은 참고용이며 개인차가 커요. 진단·치료 또는 피임에 사용할 수
              없어요.
            </Text>
          </View>
        </>
      ) : (
        <Card tone="primary" style={styles.partnerOnlyCard}>
          <Chip label="기록 없이 시작" selected />
          <Body style={styles.partnerOnlyBody}>
            주기 예측 없이도 오늘의 기분·증상·도움 선호를 기록할 수 있어요.
          </Body>
        </Card>
      )}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="민감정보 처리 원칙 동의"
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
            민감정보 처리 원칙을 확인했어요
          </Text>
          <Text style={styles.consentBody}>
            주기·컨디션은 본인 기록과 예측, 직접 선택한 공유에만 사용하며 언제든
            공유 철회·삭제할 수 있어요. 정식 동의문은 출시 전 법률 검토가
            필요해요.
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
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.md,
  },
  dateButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateButtonText: { color: colors.primaryDark, fontSize: 30, lineHeight: 34 },
  dateButtonDisabled: { opacity: 0.4 },
  dateValue: { color: colors.text, fontSize: 19, fontWeight: '800' },
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
