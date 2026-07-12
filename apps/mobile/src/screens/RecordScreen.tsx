import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DailyCheckIn, useMoonMate } from '../app/MoonMateStore';
import { Body, Card, Chip, PrimaryButton, Screen, SectionHeader, Title } from '../components/Ui';
import { colors, radius, spacing } from '../theme';

const moods: Array<{ label: NonNullable<DailyCheckIn['mood']>; emoji: string }> = [
  { label: '힘들어요', emoji: '😣' },
  { label: '지쳐요', emoji: '😴' },
  { label: '괜찮아요', emoji: '🙂' },
  { label: '좋아요', emoji: '😊' },
];
const symptoms = ['복통', '두통', '피로', '부종', '예민함', '허리 불편'];
const preferences: NonNullable<DailyCheckIn['carePreference']>[] = [
  '쉬고 싶어요',
  '따뜻하게 챙겨줘요',
  '그냥 들어줘요',
  '평소처럼 대해줘요',
];

export function RecordScreen({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const { state, saveCheckIn } = useMoonMate();
  const [draft, setDraft] = useState<DailyCheckIn>(state.checkIn);

  function toggleSymptom(value: string) {
    setDraft(current => ({
      ...current,
      symptoms: current.symptoms.includes(value)
        ? current.symptoms.filter(item => item !== value)
        : [...current.symptoms, value],
    }));
  }

  async function save() {
    if (await saveCheckIn(draft)) onDone();
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.topBar}>
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={12}>
          <Text style={styles.close}>×</Text>
        </Pressable>
        <Text style={styles.date}>오늘 기록</Text>
        <View style={styles.placeholder} />
      </View>
      <Title>지금 내 상태를{`\n`}짧게 남겨볼까요?</Title>
      <Body muted style={styles.intro}>선택하지 않은 항목은 저장하지 않아요. 공유 설정도 그대로 유지돼요.</Body>

      <SectionHeader title="기분" />
      <View style={styles.moodGrid}>
        {moods.map(item => {
          const selected = draft.mood === item.label;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={item.label}
              onPress={() => setDraft(current => ({ ...current, mood: selected ? undefined : item.label }))}
              style={[styles.moodCard, selected && styles.moodCardSelected]}>
              <Text style={styles.moodEmoji}>{item.emoji}</Text>
              <Text style={[styles.moodLabel, selected && styles.moodLabelSelected]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <SectionHeader title="몸 상태" />
      <View style={styles.chips}>
        {symptoms.map(symptom => (
          <Chip key={symptom} label={symptom} selected={draft.symptoms.includes(symptom)} onPress={() => toggleSymptom(symptom)} />
        ))}
      </View>

      <SectionHeader title="오늘 원하는 도움" />
      <Card style={styles.preferenceCard}>
        {preferences.map(preference => {
          const selected = draft.carePreference === preference;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={preference}
              onPress={() => setDraft(current => ({ ...current, carePreference: selected ? undefined : preference }))}
              style={styles.preferenceRow}>
              <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
              <Text style={styles.preferenceText}>{preference}</Text>
            </Pressable>
          );
        })}
      </Card>

      {state.isLogger ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: draft.periodStarted }}
          onPress={() => setDraft(current => ({ ...current, periodStarted: !current.periodStarted }))}
          style={[styles.periodButton, draft.periodStarted && styles.periodButtonSelected]}>
          <View style={[styles.checkbox, draft.periodStarted && styles.checkboxSelected]}>
            {draft.periodStarted ? <Text style={styles.check}>✓</Text> : null}
          </View>
          <View style={styles.periodCopy}>
            <Text style={styles.periodTitle}>오늘 생리가 시작했어요</Text>
            <Text style={styles.periodBody}>새 주기 시작일로 기록하고 예측을 다시 계산해요</Text>
          </View>
        </Pressable>
      ) : null}

      <View style={styles.footer}>
        <PrimaryButton label="안전하게 저장하기" onPress={save} />
        <Text style={styles.footerNote}>민감한 기분·증상 값은 Analytics로 보내지 않아요.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  close: { color: colors.text, fontSize: 34, lineHeight: 38, fontWeight: '300' },
  date: { color: colors.textMuted, fontSize: 14, fontWeight: '800' },
  placeholder: { width: 30 },
  intro: { marginTop: spacing.md },
  moodGrid: { flexDirection: 'row', gap: spacing.sm },
  moodCard: {
    flex: 1,
    minHeight: 90,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  moodCardSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  moodEmoji: { fontSize: 28 },
  moodLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  moodLabelSelected: { color: colors.primaryDark, fontWeight: '900' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preferenceCard: { paddingVertical: spacing.sm },
  preferenceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 50 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  preferenceText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  periodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  periodButtonSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  checkbox: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  check: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  periodCopy: { flex: 1, gap: spacing.xs },
  periodTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  periodBody: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  footer: { marginTop: spacing.xxl, gap: spacing.md },
  footerNote: { color: colors.textSubtle, fontSize: 11, textAlign: 'center' },
});
