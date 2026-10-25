import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {fireEvent, render} from '@testing-library/react-native';
import {parseLocalDate} from '@cyclepair/product-core';
import {I18nProvider} from '../i18n/I18nProvider';
import {observedRecordSummary} from '../app/observedRecordSummary';
import {MoodHistoryCard, WeekRecordCard} from './ObservedDays';
const through=parseLocalDate('2026-10-25');
beforeEach(async()=>{
  await AsyncStorage.clear();
  await AsyncStorage.setItem('cyclepair.language.v1','en');
});
it('shows a real first-record action and no invented feeling for an empty history',async()=>{
  const onOpenRecord=jest.fn();
  const summary=observedRecordSummary([],through);
  const view=await render(<I18nProvider><MoodHistoryCard summary={summary} onOpenRecord={onOpenRecord}/></I18nProvider>);
  expect(view.getByText('Your story starts here')).toBeTruthy();
  expect(view.queryByText('Calm')).toBeNull();
  fireEvent.press(view.getByRole('button',{name:'Write your first note'}));
  expect(onOpenRecord).toHaveBeenCalledTimes(1);
});
it('keeps a recorded day without a feeling distinct from a missing day',async()=>{
  const summary=observedRecordSummary([{localDate:'2026-10-25',checkIn:{symptoms:[],periodStarted:false,periodEnded:false}}],through);
  const view=await render(<I18nProvider><WeekRecordCard summary={summary}/><MoodHistoryCard summary={summary} onOpenRecord={jest.fn()}/></I18nProvider>);
  expect(view.getByLabelText(/Oct 25, 2026, No feeling selected/)).toBeTruthy();
  expect(view.getByText('Your records are here. Add a feeling when it feels right.')).toBeTruthy();
  expect(view.queryByText('Your story starts here')).toBeNull();
  expect(view.queryByText('Calm')).toBeNull();
});

it('uses English feeling labels in observed data and accessible summaries',async()=>{
  const summary=observedRecordSummary([{localDate:'2026-10-25',checkIn:{emotions:['calm','affectionate'],symptoms:[],periodStarted:false,periodEnded:false}}],through);
  const view=await render(<I18nProvider><WeekRecordCard summary={summary}/><MoodHistoryCard summary={summary} onOpenRecord={jest.fn()}/></I18nProvider>);
  expect(view.getByLabelText(/Oct 25, 2026, Calm, Affectionate/)).toBeTruthy();
  expect(view.getByLabelText('Calm, 1 day')).toBeTruthy();
  expect(view.queryByText('평온')).toBeNull();
  expect(view.queryByText('애정')).toBeNull();
});
