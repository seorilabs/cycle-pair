import type { RemotePartnerProjection } from '../platform/backend/CyclePairBackend';
import {
  buildPartnerSharedFields,
  type PartnerSharedFieldKey,
} from './partnerProjectionPresentation';
import {
  choiceLabel,
  translate,
  type Locale,
  type MessageKey,
} from '../i18n/language';
import { formatDate } from '../i18n/I18nProvider';
const titles: Record<PartnerSharedFieldKey, MessageKey> = {
  cyclePhase: 'Cycle phase',
  cycleStatus: 'Period status',
  nextPeriodWindow: 'Estimated next period',
  periodDates: 'Period dates',
  emotionTags: 'How I feel',
  symptomTags: 'Symptoms',
  energyLevel: 'Energy',
  conditionCode: 'Condition',
  carePreferences: 'Help I want',
  note: 'Note',
};
const phaseEnglish: Record<string, string> = {
  menstrual: 'Menstrual phase',
  follicular: 'Follicular phase',
  ovulatory: 'Fertility estimate',
  luteal: 'Luteal phase',
  unknown: 'More records needed',
};
const statusEnglish: Record<string, string> = {
  'period-starting': 'Period started',
  'period-in-progress': 'Period in progress',
  'period-ending': 'Period may be ending',
  'post-period': 'After the period',
  'fertile-window': 'Fertility estimate',
  'pre-period': 'Before the period',
  'cycle-in-progress': 'Cycle in progress',
  'period-late': 'Estimated window has passed',
  unknown: 'More records needed',
};
export function sharedFields(
  projection: RemotePartnerProjection | null | undefined,
  locale: Locale,
) {
  if (!projection) return [];
  return buildPartnerSharedFields(projection).map(field => {
    let value = field.value;
    switch (field.key) {
      case 'emotionTags':
        value = (projection.emotionTags ?? [])
          .map(code => choiceLabel(locale, code))
          .join(', ');
        break;
      case 'symptomTags':
        value = (projection.symptomTags ?? [])
          .map(code => choiceLabel(locale, code))
          .join(', ');
        break;
      case 'carePreferences':
        value = (projection.carePreferences ?? [])
          .map(code => choiceLabel(locale, code))
          .join(', ');
        break;
      case 'conditionCode':
        value = choiceLabel(locale, projection.conditionCode ?? '');
        break;
      case 'energyLevel':
        value = `${projection.energyLevel}/5`;
        break;
      case 'cyclePhase':
        if (locale === 'en')
          value = phaseEnglish[projection.cyclePhase ?? 'unknown'];
        break;
      case 'cycleStatus':
        if (locale === 'en')
          value = statusEnglish[projection.cycleStatus ?? 'unknown'];
        break;
      case 'nextPeriodWindow':
        if (projection.nextPeriodWindow)
          value = `${formatDate(
            projection.nextPeriodWindow.startDate,
            locale,
          )} – ${formatDate(projection.nextPeriodWindow.endDate, locale)}`;
        break;
      case 'periodDates':
        if (projection.periodDates)
          value = `${formatDate(projection.periodDates.startDate, locale)}${
            projection.periodDates.endDate
              ? ` – ${formatDate(projection.periodDates.endDate, locale)}`
              : ''
          }`;
        break;
    }
    return { ...field, label: translate(locale, titles[field.key]), value };
  });
}
