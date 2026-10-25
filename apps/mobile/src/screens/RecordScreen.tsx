import React, { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
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
import { AppIcon, type AppIconName } from '../components/AppArtwork';
const emotionIcons: Record<import('../app/emotions').EmotionCode, AppIconName> =
  {
    calm: 'leaf',
    happy: 'sun',
    affectionate: 'heart',
    anxious: 'cloud',
    irritable: 'cloud',
    hurt: 'cloud',
    lonely: 'moon',
    drained: 'cup',
    other: 'journal',
  };
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
  const { fontScale, width } = useWindowDimensions();
  const moodColumns =
    fontScale >= 1.75 ? 1 : fontScale > 1.2 || width < 310 ? 2 : 3;
  const [draft, setDraft] = useState(initialDraft ?? state.checkIn);
  const [sheet, setSheet] = useState<'help' | null>(null);
  const [details, setDetails] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const submitting = useRef(false);
  function update(next: DailyCheckIn) {
    setDraft(next);
    onDraftChange?.(next);
  }
  async function save() {
    if (submitting.current || backendBusy || !draft.emotions?.length) return;
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
      <Title>{t('How are you feeling right now?')}</Title>
      <Body muted style={styles.intro}>
        {t('Choose a word that feels like you.')}
      </Body>
      <Body muted>
        {t('Choose up to {count}', { count: MAX_EMOTIONS_PER_LOG })}
      </Body>
      <View style={styles.moods} testID="record-emotions">
        {EMOTION_CODES.map(code => {
          const selected = Boolean(draft.emotions?.includes(code));
          const disabled =
            backendBusy ||
            (!selected &&
              (draft.emotions?.length ?? 0) >= MAX_EMOTIONS_PER_LOG);
          return (
            <Pressable
              key={code}
              accessibilityRole="checkbox"
              accessibilityLabel={label(code)}
              accessibilityState={{ checked: selected, disabled }}
              disabled={disabled}
              testID={`record-emotion-${code}`}
              onPress={() =>
                update({
                  ...draft,
                  emotions: toggleEmotion(draft.emotions, code),
                })
              }
              style={[
                styles.mood,
                moodColumns === 3
                  ? styles.moodThreeColumns
                  : moodColumns === 2
                  ? styles.moodTwoColumns
                  : styles.moodOneColumn,
                selected && styles.moodSelected,
                disabled && styles.disabled,
              ]}
            >
              <AppIcon name={emotionIcons[code]} size={32} />
              <Text style={[styles.label, styles.moodLabel]}>
                {label(code)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.label}>{t('A small note, optional')}</Text>
      <TextInput
        accessibilityLabel={t('Note')}
        testID="record-note"
        placeholder={t('A few words for yourself')}
        placeholderTextColor={colors.textMuted}
        multiline
        maxLength={500}
        editable={!backendBusy}
        value={draft.note ?? ''}
        onChangeText={note => update({ ...draft, note })}
        style={styles.input}
        textAlignVertical="top"
      />
      <View style={styles.private}>
        <AppIcon name="lock" />
        <Body muted style={styles.flex}>
          {t('This note is only for you.')}
        </Body>
      </View>
      <Pressable
        accessibilityRole="button"
        testID="record-help"
        disabled={backendBusy}
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
        disabled={backendBusy}
        onPress={() => setDetails(!details)}
        style={styles.details}
      >
        <Text style={styles.label}>
          {details ? '−' : '+'} {t('More details')}
        </Text>
        <Body muted>
          {t(
            state.isLogger
              ? 'Symptoms, energy and period'
              : 'Symptoms and energy',
          )}
        </Body>
      </Pressable>
      {details ? (
        <Card style={styles.more}>
          <SectionHeader title={t('Symptoms')} />
          <View style={styles.options}>
            {symptoms.map(value => (
              <Chip
                key={value}
                disabled={backendBusy}
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
                disabled={backendBusy}
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
                disabled={backendBusy}
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
          {state.isLogger ? (
            <>
              <ToggleRow
                title={t('Period started today')}
                disabled={backendBusy}
                value={draft.periodStarted}
                onValueChange={value =>
                  update({ ...draft, periodStarted: value, periodEnded: false })
                }
              />
              <ToggleRow
                title={t('Period ended today')}
                disabled={backendBusy}
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
          disabled={backendBusy || !draft.emotions?.length}
          onPress={() => {
            save().catch(() => undefined);
          }}
        />
      </View>
      <SelectionSheet
        title={t('Help I want')}
        visible={sheet === 'help'}
        onClose={() => setSheet(null)}
      >
        <View style={styles.options}>
          {preferences.map((value, index) => (
            <Chip
              key={value}
              disabled={backendBusy}
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
  moods: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginVertical: spacing.lg,
  },
  mood: {
    minHeight: 88,
    minWidth: 0,
    flexGrow: 1,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    gap: spacing.sm,
    alignItems: 'center',
  },
  moodSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryDark,
  },
  moodThreeColumns: { flexBasis: '30%' },
  moodTwoColumns: { flexBasis: '45%' },
  moodOneColumn: { flexBasis: '100%' },
  moodLabel: { textAlign: 'center', flexShrink: 1, width: '100%' },
  disabled: { opacity: 0.5 },
  private: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  flex: { flex: 1 },
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
