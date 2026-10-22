import { formatDate, useI18n } from '../i18n/I18nProvider';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import type { LocalDate } from '@cyclepair/product-core';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  localDateToPickerDate,
  pickerDateToLocalDate,
} from '../app/localDatePicker';
import { colors, radius, spacing } from '../theme';

interface LocalDatePickerFieldProps {
  readonly accessibilityLabel: string;
  readonly value: LocalDate;
  readonly onChange: (value: LocalDate) => void;
  readonly disabled?: boolean;
  readonly minimumDate?: LocalDate;
  readonly maximumDate?: LocalDate;
  readonly testID?: string;
}

export function LocalDatePickerField({
  accessibilityLabel,
  value,
  onChange,
  disabled = false,
  minimumDate,
  maximumDate,
  testID,
}: LocalDatePickerFieldProps) {
  const { l, locale } = useI18n();
  const pickerValue = localDateToPickerDate(value);
  const pickerMinimum = minimumDate
    ? localDateToPickerDate(minimumDate)
    : undefined;
  const pickerMaximum = maximumDate
    ? localDateToPickerDate(maximumDate)
    : undefined;

  if (Platform.OS === 'android') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}, ${formatDate(
          value,
          locale,
        )}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() =>
          DateTimePickerAndroid.open({
            value: pickerValue,
            mode: 'date',
            display: 'default',
            ...(pickerMinimum ? { minimumDate: pickerMinimum } : {}),
            ...(pickerMaximum ? { maximumDate: pickerMaximum } : {}),
            onValueChange: (_event, selectedDate) =>
              onChange(pickerDateToLocalDate(selectedDate)),
          })
        }
        style={[styles.field, disabled && styles.disabled]}
        testID={testID}
      >
        <Text style={styles.value}>{formatDate(value, locale)}</Text>
        <Text style={styles.action}>{l('날짜 선택')}</Text>
      </Pressable>
    );
  }

  return (
    <View
      style={[styles.field, styles.iosField, disabled && styles.disabled]}
      testID={testID ? `${testID}-container` : undefined}
    >
      <DateTimePicker
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: formatDate(value, locale) }}
        accentColor={colors.primary}
        disabled={disabled}
        display="compact"
        mode="date"
        locale={locale === 'ko' ? 'ko-KR' : 'en-US'}
        onValueChange={(_event, selectedDate) =>
          onChange(pickerDateToLocalDate(selectedDate))
        }
        {...(pickerMinimum ? { minimumDate: pickerMinimum } : {})}
        {...(pickerMaximum ? { maximumDate: pickerMaximum } : {})}
        style={styles.iosPicker}
        testID={testID}
        themeVariant="light"
        value={pickerValue}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  disabled: { opacity: 0.5 },
  value: { color: colors.text, fontSize: 15, fontWeight: '700' },
  action: { color: colors.primaryDark, fontSize: 12, fontWeight: '800' },
  iosField: { justifyContent: 'center' },
  iosPicker: { alignSelf: 'center' },
});
