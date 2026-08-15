import { parseLocalDate } from '@cyclepair/product-core';
import {
  formatPickerLocalDate,
  localDateToPickerDate,
  pickerDateToLocalDate,
} from './localDatePicker';

describe('native LocalDate picker conversion', () => {
  it.each([
    '1900-02-28',
    '2000-02-29',
    '2024-03-01',
    '2026-08-24',
    '2099-12-31',
  ])('round-trips %s without changing its calendar day', value => {
    const localValue = parseLocalDate(value);

    expect(pickerDateToLocalDate(localDateToPickerDate(localValue))).toBe(
      localValue,
    );
  });

  it('formats the selected LocalDate without a time-zone conversion', () => {
    expect(formatPickerLocalDate(parseLocalDate('2026-08-24'))).toBe(
      '2026년 8월 24일',
    );
  });
});
