import { ko } from './ko';
export type Locale = 'ko' | 'en';
export type LanguageChoice = 'system' | Locale;
export type MessageKey = keyof typeof ko;
export type MessageParams = Readonly<Record<string, string | number>>;
export function resolveLocale(choice: LanguageChoice, system?: string): Locale {
  return choice === 'system'
    ? /^ko(?:[-_]|$)/i.test(system ?? '')
      ? 'ko'
      : 'en'
    : choice;
}
export function translate(
  locale: Locale,
  key: MessageKey,
  params: MessageParams = {},
): string {
  const template = locale === 'ko' ? ko[key] : key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : placeholder,
  );
}
const choices: Readonly<Record<string, MessageKey>> = {
  calm: 'Calm',
  happy: 'Happy',
  affectionate: 'Affectionate',
  anxious: 'Anxious',
  irritable: 'Irritable',
  hurt: 'Hurt',
  lonely: 'Lonely',
  drained: 'Drained',
  other: 'Other',
  복통: 'Cramps',
  cramps: 'Cramps',
  두통: 'Headache',
  headache: 'Headache',
  피로: 'Fatigue',
  fatigue: 'Fatigue',
  부종: 'Bloating',
  bloating: 'Bloating',
  예민함: 'Sensitive',
  sensitive: 'Sensitive',
  '허리 불편': 'Back discomfort',
  'back-discomfort': 'Back discomfort',
  편안해요: 'Comfortable',
  comfortable: 'Comfortable',
  '배가 아파요': 'My stomach hurts',
  '머리가 아파요': 'My head hurts',
  '공간이 필요해요': 'I need space',
  'needs-space': 'I need space',
  '쉬고 싶어요': 'Quiet time',
  'quiet-space': 'Quiet time',
  '따뜻하게 챙겨줘요': 'Warmth',
  warmth: 'Warmth',
  '그냥 들어줘요': 'Just listen',
  listen: 'Just listen',
  '평소처럼 대해줘요': 'As usual',
  'no-action': 'As usual',
};
export function choiceLabel(locale: Locale, value: string): string {
  return choices[value] ? translate(locale, choices[value]) : value;
}
