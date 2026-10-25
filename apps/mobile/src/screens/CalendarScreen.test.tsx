import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {render} from '@testing-library/react-native';
import {createInitialState, useCyclePair} from '../app/CyclePairStore';
import {I18nProvider} from '../i18n/I18nProvider';
import {CalendarScreen} from './CalendarScreen';

jest.mock('../app/CyclePairStore', () => ({
  ...jest.requireActual('../app/CyclePairStore'),
  useCyclePair: jest.fn(),
}));
it.each([
  ['en', 'Has a record, Has a shared event'],
  ['ko', '기록 있음, 공동 일정 있음'],
] as const)('reads record and shared-event date markers in %s', async (locale, markers) => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('cyclepair.language.v1', locale);
  const state=createInitialState();
  const date=state.currentLocalDate;
  jest.mocked(useCyclePair).mockReturnValue({
    state:{...state, paired:true, sharingCompleted:true, sharingPairId:'owned-pair',
      dailyHistory:[{localDate:date,checkIn:{emotions:['calm'],symptoms:[],periodStarted:false,periodEnded:false}}],
      sharedEvents:[{id:'owned-event',pairId:'owned-pair',createdBy:'self',updatedBy:'self',mutationId:'owned-event',date,title:'A quiet walk'}]},
    backendBusy:false,backendError:null,dailyHistoryStatus:'ready',retryDailyHistory:jest.fn(),
    deleteDailyLog:jest.fn(),upsertPairEvent:jest.fn(),deletePairEvent:jest.fn(),
  } as unknown as ReturnType<typeof useCyclePair>);
  const view=await render(<I18nProvider><CalendarScreen onOpenRecord={jest.fn()}/></I18nProvider>);
  expect(view.getByRole('button',{name:new RegExp(`^${date}, .*${markers}$`)})).toBeTruthy();
  if(locale==='en')expect(view.queryByLabelText(/기록 있음|공동 일정 있음/)).toBeNull();
  const weekday=view.getByLabelText(locale==='en'?'Sun':'일');
  expect(weekday.props.children).toBe(locale==='en'?'S':'일');
});
