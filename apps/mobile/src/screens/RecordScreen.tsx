import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DailyCheckIn, useCyclePair } from '../app/CyclePairStore';
import { Body, Card, Chip, PrimaryButton, Screen, SectionHeader, TextButton, Title } from '../components/Ui';
import { colors, radius, spacing } from '../theme';
import {
  EMOTION_CODES,
  EMOTION_LABELS,
  MAX_EMOTIONS_PER_LOG,
  toggleEmotion,
  type EmotionCode,
} from '../app/emotions';

const emotionEmoji: Readonly<Record<EmotionCode, string>> = {
  calm: '🙂',
  happy: '😊',
  affectionate: '🥰',
  anxious: '😟',
  irritable: '😤',
  hurt: '🥺',
  lonely: '🌙',
  drained: '😮‍💨',
  other: '💬',
};
const symptoms = ['복통', '두통', '피로', '부종', '예민함', '허리 불편'];
const energyLevels: Array<NonNullable<DailyCheckIn['energy']>> = [1, 2, 3, 4, 5];
const conditions: Array<NonNullable<DailyCheckIn['condition']>> = [
  '편안해요',
  '배가 아파요',
  '머리가 아파요',
  '공간이 필요해요',
];
const preferences: NonNullable<DailyCheckIn['carePreference']>[] = [
  '쉬고 싶어요',
  '따뜻하게 챙겨줘요',
  '그냥 들어줘요',
  '평소처럼 대해줘요',
];

export function RecordScreen({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const { state, backendBusy, backendError, saveCheckIn } = useCyclePair();
  const [draft, setDraft] = useState<DailyCheckIn>(state.checkIn);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const submittingRef = useRef(false);

  function toggleSymptom(value: string) {
    setDraft(current => ({
      ...current,
      symptoms: current.symptoms.includes(value)
        ? current.symptoms.filter(item => item !== value)
        : [...current.symptoms, value],
    }));
  }

  async function save() {
    if (submittingRef.current || backendBusy) return;
    submittingRef.current = true;
    setSaveAttempted(true);
    try {
      if (await saveCheckIn(draft)) onDone();
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="기록 화면 닫기"
          accessibilityState={{ disabled: backendBusy }}
          disabled={backendBusy}
          onPress={onCancel}
          hitSlop={12}>
          <Text style={styles.close}>×</Text>
        </Pressable>
        <Text style={styles.date}>오늘 기록</Text>
        <View style={styles.placeholder} />
      </View>
      <Title>지금 내 상태를{`\n`}짧게 남겨볼까요?</Title>
      <Body muted style={styles.intro}>선택하지 않은 항목은 저장하지 않아요. 공유 설정도 그대로 유지돼요.</Body>

      <SectionHeader title="지금 마음" />
      <Body muted style={styles.intro}>
        여러 개를 골라도 돼요. 최대 {MAX_EMOTIONS_PER_LOG}개까지 담겨요.
      </Body>
      <View style={styles.moodGrid}>
        {EMOTION_CODES.map(code => {
          const selected = (draft.emotions ?? []).includes(code);
          const atLimit =
            !selected && (draft.emotions ?? []).length >= MAX_EMOTIONS_PER_LOG;
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected, disabled: atLimit }}
              disabled={atLimit}
              key={code}
              onPress={() =>
                setDraft(current => ({
                  ...current,
                  emotions: toggleEmotion(current.emotions, code),
                }))
              }
              style={[
                styles.moodCard,
                selected && styles.moodCardSelected,
                atLimit && styles.moodCardDisabled,
              ]}>
              <Text style={styles.moodEmoji}>{emotionEmoji[code]}</Text>
              <Text style={[styles.moodLabel, selected && styles.moodLabelSelected]}>
                {EMOTION_LABELS[code]}
              </Text>
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

      <SectionHeader title="에너지" />
      <View style={styles.energyRow}>
        {energyLevels.map(level => (
          <Chip
            key={level}
            label={String(level)}
            selected={draft.energy === level}
            onPress={() =>
              setDraft(current => ({
                ...current,
                energy: current.energy === level ? undefined : level,
              }))
            }
          />
        ))}
      </View>

      <SectionHeader title="컨디션" />
      <View style={styles.chips}>
        {conditions.map(condition => (
          <Chip
            key={condition}
            label={condition}
            selected={draft.condition === condition}
            onPress={() =>
              setDraft(current => ({
                ...current,
                condition: current.condition === condition ? undefined : condition,
              }))
            }
          />
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

      <SectionHeader title="메모" />
      <TextInput
        accessibilityLabel="오늘의 메모"
        multiline
        maxLength={500}
        placeholder="남기고 싶은 내용이 있다면 적어주세요"
        placeholderTextColor={colors.textSubtle}
        value={draft.note ?? ''}
        onChangeText={note => setDraft(current => ({ ...current, note }))}
        style={styles.noteInput}
        textAlignVertical="top"
      />
      <Text style={styles.characterCount}>{draft.note?.length ?? 0}/500</Text>

      {state.isLogger ? (
        <View style={styles.periodGroup}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: draft.periodStarted }}
            onPress={() =>
              setDraft(current => ({
                ...current,
                periodStarted: !current.periodStarted,
                periodEnded: false,
              }))
            }
            style={[styles.periodButton, draft.periodStarted && styles.periodButtonSelected]}>
            <View style={[styles.checkbox, draft.periodStarted && styles.checkboxSelected]}>
              {draft.periodStarted ? <Text style={styles.check}>✓</Text> : null}
            </View>
            <View style={styles.periodCopy}>
              <Text style={styles.periodTitle}>오늘 생리가 시작했어요</Text>
              <Text style={styles.periodBody}>
                {state.hasCycleSeed
                  ? '새 주기 시작일로 저장하고 다음 예상일을 다시 계산해요'
                  : '새 주기 시작일로 저장해요. 다음 생리 예상은 설정에서 켤 수 있어요'}
              </Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: draft.periodEnded }}
            onPress={() =>
              setDraft(current => ({
                ...current,
                periodStarted: false,
                periodEnded: !current.periodEnded,
              }))
            }
            style={[styles.periodButton, draft.periodEnded && styles.periodButtonSelected]}>
            <View style={[styles.checkbox, draft.periodEnded && styles.checkboxSelected]}>
              {draft.periodEnded ? <Text style={styles.check}>✓</Text> : null}
            </View>
            <View style={styles.periodCopy}>
              <Text style={styles.periodTitle}>오늘 생리가 끝났어요</Text>
              <Text style={styles.periodBody}>이번 주기의 종료일로 기록해요</Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      {backendError && saveAttempted ? (
        <View accessibilityRole="alert" style={styles.errorCard}>
          <Text style={styles.errorText}>{backendError}</Text>
          <TextButton
            label="다시 시도"
            disabled={backendBusy}
            onPress={() => {
              save().catch(() => undefined);
            }}
          />
        </View>
      ) : null}

      <View style={styles.footer}>
        <PrimaryButton
          label={backendBusy ? '저장 중…' : '안전하게 저장하기'}
          disabled={backendBusy}
          onPress={() => {
            save().catch(() => undefined);
          }}
        />
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
  moodCardDisabled: {
    opacity: 0.4,
  },
  moodCardSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  moodEmoji: { fontSize: 28 },
  moodLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  moodLabelSelected: { color: colors.primaryDark, fontWeight: '900' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  energyRow: { flexDirection: 'row', gap: spacing.sm },
  preferenceCard: { paddingVertical: spacing.sm },
  preferenceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 50 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  preferenceText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  noteInput: {
    minHeight: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    padding: spacing.md,
  },
  characterCount: { color: colors.textSubtle, fontSize: 11, textAlign: 'right', marginTop: spacing.xs },
  periodGroup: { gap: spacing.sm, marginTop: spacing.xl },
  periodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
  errorCard: {
    gap: spacing.sm,
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  footer: { marginTop: spacing.xxl, gap: spacing.md },
  footerNote: { color: colors.textSubtle, fontSize: 11, textAlign: 'center' },
});
