import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { type DailyCheckIn, useCyclePair } from '../app/CyclePairStore';
import {
  EMOTION_CODES,
  MAX_EMOTIONS_PER_LOG,
  toggleEmotion,
} from '../app/emotions';
import {
  Body,
  Card,
  Chip,
  PrimaryButton,
  Screen,
  SectionHeader,
  SelectionSheet,
  TextButton,
  Title,
  ToggleRow,
} from '../components/Ui';
import { useI18n } from '../i18n/I18nProvider';
import { colors, radius, spacing } from '../theme';
const symptoms = ['복통', '두통', '피로', '부종', '예민함', '허리 불편'];
const conditions: NonNullable<DailyCheckIn['condition']>[] = [
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

export function RecordScreen({
  onDone,
  onCancel,
  initialDraft,
  onDraftChange,
}: {
  onDone(): void;
  onCancel(): void;
  initialDraft?: DailyCheckIn;
  onDraftChange?(draft: DailyCheckIn): void;
}) {
  const { state, backendBusy, backendError, saveCheckIn } = useCyclePair();
  const { l, t, label } = useI18n();
  const [draft, setDraft] = useState(initialDraft ?? state.checkIn);
  const [sheet, setSheet] = useState<'emotions' | 'help' | null>(null);
  const [details, setDetails] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const submitting = useRef(false);
  function update(next: DailyCheckIn) {
    setDraft(next);
    onDraftChange?.(next);
  }
  async function save() {
    if (submitting.current || backendBusy) return;
    submitting.current = true;
    setAttempted(true);
    try {
      if (await saveCheckIn(draft)) onDone();
    } finally {
      submitting.current = false;
    }
  }
  return (
    <Screen>
      <View style={styles.header}>
        <TextButton
          label={t('Cancel')}
          disabled={backendBusy}
          onPress={onCancel}
        />
        <Text style={styles.date}>{t('Today')}</Text>
      </View>
      <Title>{t('My day')}</Title>
      <Body muted style={styles.intro}>
        {t('Your sharing choices stay the same.')}
      </Body>
      <Pressable
        accessibilityRole="button"
        testID="record-emotions"
        onPress={() => setSheet('emotions')}
        style={styles.summary}
      >
        <Text style={styles.label}>{t('How I feel')}</Text>
        <Text style={styles.value}>
          {draft.emotions?.map(label).join(', ') || t('Choose')} ›
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        testID="record-help"
        onPress={() => setSheet('help')}
        style={styles.summary}
      >
        <Text style={styles.label}>{t('Help I want')}</Text>
        <Text style={styles.value}>
          {draft.carePreference ? label(draft.carePreference) : t('Choose')} ›
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: details }}
        testID="record-details"
        onPress={() => setDetails(!details)}
        style={styles.details}
      >
        <Text style={styles.label}>
          {details ? '−' : '+'} {t('More details')}
        </Text>
        <Body muted>{t('Symptoms, energy, notes and period')}</Body>
      </Pressable>
      {details ? (
        <Card style={styles.more}>
          <SectionHeader title={t('Symptoms')} />
          <View style={styles.options}>
            {symptoms.map(value => (
              <Chip
                key={value}
                label={label(value)}
                selected={draft.symptoms.includes(value)}
                onPress={() =>
                  update({
                    ...draft,
                    symptoms: draft.symptoms.includes(value)
                      ? draft.symptoms.filter(item => item !== value)
                      : [...draft.symptoms, value],
                  })
                }
              />
            ))}
          </View>
          <SectionHeader title={t('Energy')} />
          <View style={styles.options}>
            {([1, 2, 3, 4, 5] as const).map(value => (
              <Chip
                key={value}
                label={String(value)}
                selected={draft.energy === value}
                onPress={() =>
                  update({
                    ...draft,
                    energy: draft.energy === value ? undefined : value,
                  })
                }
              />
            ))}
          </View>
          <SectionHeader title={t('Condition')} />
          <View style={styles.options}>
            {conditions.map(value => (
              <Chip
                key={value}
                label={label(value)}
                selected={draft.condition === value}
                onPress={() =>
                  update({
                    ...draft,
                    condition: draft.condition === value ? undefined : value,
                  })
                }
              />
            ))}
          </View>
          <SectionHeader title={t('Note')} />
          <TextInput
            accessibilityLabel={t('Note')}
            testID="record-note"
            placeholder={t('Add a note')}
            placeholderTextColor={colors.textSubtle}
            multiline
            maxLength={500}
            value={draft.note ?? ''}
            onChangeText={note => update({ ...draft, note })}
            style={styles.input}
            textAlignVertical="top"
          />
          <Text style={styles.count}>{draft.note?.length ?? 0}/500</Text>
          {state.isLogger ? (
            <>
              <ToggleRow
                title={t('Period started today')}
                value={draft.periodStarted}
                onValueChange={value =>
                  update({ ...draft, periodStarted: value, periodEnded: false })
                }
              />
              <ToggleRow
                title={t('Period ended today')}
                value={draft.periodEnded}
                onValueChange={value =>
                  update({ ...draft, periodEnded: value, periodStarted: false })
                }
              />
            </>
          ) : null}
        </Card>
      ) : null}
      {attempted && backendError ? (
        <Body style={styles.error}>{l(backendError)}</Body>
      ) : null}
      <View style={styles.save}>
        <PrimaryButton
          testID="record-save"
          label={t(backendBusy ? 'Saving…' : 'Save record')}
          disabled={backendBusy}
          onPress={() => {
            save().catch(() => undefined);
          }}
        />
      </View>
      <SelectionSheet
        title={t('How I feel')}
        visible={sheet === 'emotions'}
        onClose={() => setSheet(null)}
      >
        <Body muted>
          {t('Choose up to {count}', { count: MAX_EMOTIONS_PER_LOG })}
        </Body>
        <View style={styles.options}>
          {EMOTION_CODES.map(code => (
            <Chip
              selectionRole="checkbox"
              disabled={
                !draft.emotions?.includes(code) &&
                (draft.emotions?.length ?? 0) >= MAX_EMOTIONS_PER_LOG
              }
              key={code}
              testID={`record-emotion-${code}`}
              label={label(code)}
              selected={draft.emotions?.includes(code)}
              onPress={() =>
                update({
                  ...draft,
                  emotions: toggleEmotion(draft.emotions, code),
                })
              }
            />
          ))}
        </View>
      </SelectionSheet>
      <SelectionSheet
        title={t('Help I want')}
        visible={sheet === 'help'}
        onClose={() => setSheet(null)}
      >
        <View style={styles.options}>
          {preferences.map((value, index) => (
            <Chip
              key={value}
              selectionRole="radio"
              testID={`record-help-${index}`}
              label={label(value)}
              selected={draft.carePreference === value}
              onPress={() =>
                update({
                  ...draft,
                  carePreference:
                    draft.carePreference === value ? undefined : value,
                })
              }
            />
          ))}
        </View>
      </SelectionSheet>
    </Screen>
  );
}
const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  date: { color: colors.textMuted },
  intro: { marginTop: spacing.sm, marginBottom: spacing.lg },
  summary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  label: { fontSize: 16, fontWeight: '700', color: colors.text },
  value: { fontSize: 18, color: colors.primaryDark },
  details: { paddingVertical: spacing.lg, gap: spacing.sm },
  more: { gap: spacing.sm },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  input: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    padding: spacing.md,
    fontSize: 16,
  },
  count: { textAlign: 'right', color: colors.textMuted },
  save: { marginTop: spacing.xl },
  error: { color: colors.danger, marginTop: spacing.lg },
});
