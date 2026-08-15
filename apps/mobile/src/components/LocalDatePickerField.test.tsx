import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { parseLocalDate } from '@cyclepair/product-core';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import { LocalDatePickerField } from './LocalDatePickerField';

jest.mock('@react-native-community/datetimepicker', () => {
  const ReactModule = require('react');
  const { View: NativeView } = require('react-native');
  return {
    __esModule: true,
    default: (props: object) =>
      ReactModule.createElement(NativeView, props),
    DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() },
  };
});

describe('LocalDatePickerField', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: originalOS,
    });
    jest.clearAllMocks();
  });

  it('uses the iOS native compact picker and returns a LocalDate', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'ios',
    });
    const onChange = jest.fn();
    const view = await render(
      <LocalDatePickerField
        accessibilityLabel="일정 날짜"
        onChange={onChange}
        testID="date-picker"
        value={parseLocalDate('2026-08-24')}
      />,
    );
    const picker = view.getByTestId('date-picker');

    expect(picker.props.display).toBe('compact');
    fireEvent(picker, 'valueChange', {}, new Date(2026, 8, 1, 12));
    expect(onChange).toHaveBeenCalledWith('2026-09-01');
  });

  it('opens the Android native date dialog with the configured maximum', async () => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    const onChange = jest.fn();
    const view = await render(
      <LocalDatePickerField
        accessibilityLabel="최근 생리 시작일"
        maximumDate={parseLocalDate('2026-08-24')}
        onChange={onChange}
        testID="date-picker"
        value={parseLocalDate('2026-08-01')}
      />,
    );

    fireEvent.press(view.getByTestId('date-picker'));
    expect(DateTimePickerAndroid.open).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'date',
        display: 'default',
        maximumDate: expect.any(Date),
      }),
    );
    const options = (DateTimePickerAndroid.open as jest.Mock).mock.calls[0][0];
    options.onValueChange({}, new Date(2026, 7, 23, 12));
    expect(onChange).toHaveBeenCalledWith('2026-08-23');
  });
});
