import { sharedFields } from './sharedFieldPresentation';
import { buildPartnerProjection } from '../../../../firebase/functions/src/domain/projection';
import { createInitialState, type ShareField } from './CyclePairStore';
import {
  toBackendShareSettings,
  toPrivateCycleRecord,
  toPrivateDailyLogRecord,
} from '../platform/backend/backendPayloads';
import { sharingPreview } from './sharingPreview';
test('every sharing combination previews only what the canonical server projects', () => {
  const state = {
    ...createInitialState(),
    currentLocalDate: '2026-10-22',
    isLogger: true,
    hasCycleSeed: true,
    seed: {
      lastPeriodStart: '2026-10-08',
      averageCycleLength: 28,
      averagePeriodLength: 5,
    },
    checkIn: {
      emotions: ['calm'] as const,
      symptoms: ['복통'],
      energy: 3 as const,
      condition: '편안해요' as const,
      carePreference: '쉬고 싶어요' as const,
      note: '평온',
      periodStarted: false,
      periodEnded: false,
    },
  };
  const saved = {
    ...state,
    dailyHistory: [
      { localDate: state.currentLocalDate, checkIn: state.checkIn },
    ],
  };
  const fields = Object.keys(state.shareSettings) as ShareField[];
  for (let mask = 0; mask < 2 ** fields.length; mask++) {
    const shareSettings = { ...state.shareSettings };
    fields.forEach((field, i) => {
      shareSettings[field] = Math.floor(mask / 2 ** i) % 2 === 1;
    });
    const candidate = { ...saved, shareSettings };
    const server = buildPartnerProjection({
      ownerUid: 'preview',
      pairId: 'preview',
      generatedAt: '2026-10-22T00:00:00Z',
      privateCycle: toPrivateCycleRecord(state.seed, state.currentLocalDate),
      privateDailyLog: {
        localDate: state.currentLocalDate,
        ...toPrivateDailyLogRecord(state.checkIn),
      },
      shareSettings: toBackendShareSettings(shareSettings),
    });
    const metadata = ['schemaVersion', 'generatedAt'];
    const expected = Object.fromEntries(
      Object.entries(server).filter(([key]) => !metadata.includes(key)),
    );
    expect(sharingPreview(candidate)).toEqual(expected);
  }
});

test('the rendered sharing preview retains today’s chosen values and hides private notes', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 22, 12));
  try {
    const base = createInitialState();
    const checkIn = {
      ...base.checkIn,
      emotions: ['calm'] as const,
      carePreference: '그냥 들어줘요' as const,
      note: 'Synthetic private note',
    };
    const state = {
      ...base,
      currentLocalDate: '2026-10-22',
      checkIn,
      dailyHistory: [{ localDate: '2026-10-22', checkIn }],
      shareSettings: {
        ...base.shareSettings,
        emotions: true,
        carePreference: true,
      },
    };
    const fields = sharedFields(sharingPreview(state), 'en');
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'emotionTags', value: 'Calm' }),
        expect.objectContaining({
          key: 'carePreferences',
          value: 'Just listen',
        }),
      ]),
    );
    expect(fields.some(field => field.key === 'note')).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
