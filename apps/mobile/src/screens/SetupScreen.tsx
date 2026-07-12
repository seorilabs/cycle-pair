import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CycleSeed, useMoonMate } from '../app/MoonMateStore';
import { Body, Card, Chip, PrimaryButton, Screen, Stepper, Title } from '../components/Ui';
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

export function SetupScreen() {
  const { state, completeSetup } = useMoonMate();
  const [isLogger, setLogger] = useState(true);
  const [seed, setSeed] = useState<CycleSeed>(state.seed);
  const [consentAccepted, setConsentAccepted] = useState(false);

  return (
    <Screen contentStyle={styles.content}>
      <Text style={styles.step}>1 / 3</Text>
      <Title>나에게 맞게{`\n`}기본값을 알려주세요</Title>
      <Body muted style={styles.intro}>
        처음부터 정확할 필요 없어요. 기록이 쌓이면 다시 계산하고, 이 값은 파트너에게 자동 공개되지 않아요.
      </Body>

      <Text style={styles.label}>나는</Text>
      <View style={styles.roleGrid}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: isLogger }}
          onPress={() => setLogger(true)}
          style={[styles.roleCard, isLogger && styles.roleCardSelected]}>
          <Text style={styles.roleIcon}>☾</Text>
          <Text style={styles.roleTitle}>내 주기를 기록해요</Text>
          <Text style={styles.roleBody}>기록하고 원하는 항목만 공유할게요</Text>
        </Pressable>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: !isLogger }}
          onPress={() => setLogger(false)}
          style={[styles.roleCard, !isLogger && styles.roleCardSelected]}>
          <Text style={styles.roleIcon}>♡</Text>
          <Text style={styles.roleTitle}>파트너만 챙겨요</Text>
          <Text style={styles.roleBody}>내 주기 기록 없이 함께할게요</Text>
        </Pressable>
      </View>

      {isLogger ? (
        <>
          <Text style={styles.label}>최근 기록</Text>
          <Card>
            <Text style={styles.cardLabel}>최근 생리 시작일</Text>
            <View style={styles.dateRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="날짜 하루 전"
                onPress={() => setSeed(current => ({ ...current, lastPeriodStart: shiftDate(current.lastPeriodStart, -1) }))}
                style={styles.dateButton}>
                <Text style={styles.dateButtonText}>‹</Text>
              </Pressable>
              <Text style={styles.dateValue}>{formatDate(seed.lastPeriodStart)}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="날짜 하루 후"
                onPress={() => setSeed(current => ({ ...current, lastPeriodStart: shiftDate(current.lastPeriodStart, 1) }))}
                style={styles.dateButton}>
                <Text style={styles.dateButtonText}>›</Text>
              </Pressable>
            </View>
            <Stepper
              label="평균 주기"
              value={seed.averageCycleLength}
              suffix="일"
              min={21}
              max={45}
              onChange={averageCycleLength => setSeed(current => ({ ...current, averageCycleLength }))}
            />
            <Stepper
              label="평균 기간"
              value={seed.averagePeriodLength}
              suffix="일"
              min={2}
              max={10}
              onChange={averagePeriodLength => setSeed(current => ({ ...current, averagePeriodLength }))}
            />
          </Card>
          <View style={styles.notice}>
            <Text style={styles.noticeIcon}>i</Text>
            <Text style={styles.noticeText}>예측은 참고용이며 개인차가 커요. 진단·치료 또는 피임에 사용할 수 없어요.</Text>
          </View>
        </>
      ) : (
        <Card tone="primary" style={styles.partnerOnlyCard}>
          <Chip label="기록 없이 시작" selected />
          <Body style={styles.partnerOnlyBody}>파트너가 직접 공유한 내용과 도움 선호만 보여드려요.</Body>
        </Card>
      )}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consentAccepted }}
        onPress={() => setConsentAccepted(value => !value)}
        style={[styles.consentCard, consentAccepted && styles.consentCardSelected]}>
        <View style={[styles.checkbox, consentAccepted && styles.checkboxSelected]}>
          {consentAccepted ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <View style={styles.consentCopy}>
          <Text style={styles.consentTitle}>민감정보 처리 원칙을 확인했어요</Text>
          <Text style={styles.consentBody}>
            주기·컨디션은 본인 기록과 예측, 직접 선택한 공유에만 사용하며 언제든 공유 철회·삭제할 수 있어요. 정식 동의문은 출시 전 법률 검토가 필요해요.
          </Text>
        </View>
      </Pressable>

      <View style={styles.footer}>
        <PrimaryButton
          label="파트너 연결로 계속"
          disabled={!consentAccepted}
          onPress={() => completeSetup({
            isLogger,
            seed,
            consentAcceptedAt: new Date().toISOString(),
          })}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  step: { color: colors.primary, fontSize: 13, fontWeight: '800', marginBottom: spacing.lg },
  intro: { marginTop: spacing.md, marginBottom: spacing.xl },
  label: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: spacing.md, marginTop: spacing.lg },
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
  roleCardSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  roleIcon: { color: colors.primary, fontSize: 30, fontWeight: '700' },
  roleTitle: { color: colors.text, fontSize: 15, fontWeight: '800', lineHeight: 20 },
  roleBody: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  cardLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.md },
  dateButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateButtonText: { color: colors.primaryDark, fontSize: 30, lineHeight: 34 },
  dateValue: { color: colors.text, fontSize: 19, fontWeight: '800' },
  notice: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, alignItems: 'flex-start' },
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
  noticeText: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 18 },
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
  consentCardSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkmark: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  consentCopy: { flex: 1, gap: spacing.xs },
  consentTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  consentBody: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
  footer: { marginTop: spacing.xxl },
});
