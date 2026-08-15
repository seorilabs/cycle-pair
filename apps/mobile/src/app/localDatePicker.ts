import { localDate, type LocalDate } from '@cyclepair/product-core';

/**
 * Native date pickers work with instants, while the product stores calendar-only
 * LocalDate values. Noon avoids a midnight DST transition changing the day.
 */
export function localDateToPickerDate(value: LocalDate): Date {
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(0);
  result.setHours(12, 0, 0, 0);
  result.setFullYear(year!, month! - 1, day!);
  return result;
}

export function pickerDateToLocalDate(value: Date): LocalDate {
  return localDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

export function formatPickerLocalDate(value: LocalDate): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}
