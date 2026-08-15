import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import type { LocalDate } from '@cyclepair/product-core';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  formatPickerLocalDate,
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
        accessibilityLabel={`${accessibilityLabel}, ${formatPickerLocalDate(
          value,
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
        <Text style={styles.value}>{formatPickerLocalDate(value)}</Text>
        <Text style={styles.action}>날짜 선택</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.field, disabled && styles.disabled]}>
      <DateTimePicker
        accessibilityLabel={accessibilityLabel}
        accentColor={colors.primary}
        disabled={disabled}
        display="compact"
        mode="date"
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
  iosPicker: { alignSelf: 'flex-start' },
});
