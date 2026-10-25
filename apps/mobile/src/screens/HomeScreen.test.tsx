import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {render} from '@testing-library/react-native';
import {addDays, localDate} from '@cyclepair/product-core';
import {createInitialState, useCyclePair} from '../app/CyclePairStore';
import {I18nProvider} from '../i18n/I18nProvider';
import {HomeScreen} from './HomeScreen';

jest.mock('../app/CyclePairStore', () => ({
  ...jest.requireActual('../app/CyclePairStore'),
  useCyclePair: jest.fn(),
}));
const mockedUseCyclePair = jest.mocked(useCyclePair);
const now = new Date();
const today = localDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('cyclepair.language.v1', 'en');
});
function show(state: ReturnType<typeof createInitialState>) {
  mockedUseCyclePair.mockReturnValue({state, dailyHistoryStatus:'ready', setTab:jest.fn(), retryDailyHistory:jest.fn()} as unknown as ReturnType<typeof useCyclePair>);
  return render(<I18nProvider><HomeScreen onOpenRecord={jest.fn()}/></I18nProvider>);
}
it('identifies an input-only estimate as zero recorded intervals', async () => {
  const view = await show({...createInitialState(), hasCycleSeed:true,
    seed:{lastPeriodStart:addDays(today,-20),averageCycleLength:31,averagePeriodLength:5}});
  expect(view.getByText('Based on your entered 31-day cycle. Recorded cycle intervals: 0.')).toBeTruthy();
  expect(view.queryByText(/Based on 1 recorded cycle interval/)).toBeNull();
});
it('shows the actual observed interval count and average rather than the configured seed', async () => {
  const state={...createInitialState(), hasCycleSeed:true,
    seed:{lastPeriodStart:addDays(today,-60),averageCycleLength:31,averagePeriodLength:5},
    dailyHistory:[-32,-4].map(offset=>({localDate:addDays(today,offset),checkIn:{symptoms:[],periodStarted:true,periodEnded:false}}))};
  const view = await show(state);
  expect(view.getByText('Based on 2 recorded cycle intervals. Average 28 days.')).toBeTruthy();
  expect(view.queryByText('Based on your entered 31-day cycle. Recorded cycle intervals: 0.')).toBeNull();
});
it('does not offer a prediction basis before complete cycle inputs exist', async () => {
  const view=await show(createInitialState());
  expect(view.queryByText(/Based on your entered/)).toBeNull();
  expect(view.queryByText(/recorded cycle interval/)).toBeNull();
});
