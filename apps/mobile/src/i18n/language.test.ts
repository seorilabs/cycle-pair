import { resolveLocale, translate, choiceLabel } from './language';

test.each([
  ['ko-KR', 'ko'],
  ['ko_KR', 'ko'],
  ['en-US', 'en'],
  ['fr-FR', 'en'],
  [undefined, 'en'],
])('system locale %s resolves to %s', (system, expected) => {
  expect(resolveLocale('system', system)).toBe(expected);
});
test('explicit choice overrides system locale', () => {
  expect(resolveLocale('en', 'ko-KR')).toBe('en');
  expect(resolveLocale('ko', 'en-US')).toBe('ko');
});
test('interpolation keeps user content unchanged', () => {
  expect(translate('en', '{name} shared an update', { name: '평온' })).toBe(
    '평온 shared an update',
  );
});
test('legacy record identifiers are localized without changing stored values', () => {
  expect(choiceLabel('en', '쉬고 싶어요')).toBe('Quiet time');
  expect(choiceLabel('ko', 'quiet-space')).toBe('쉬고 싶어요');
  expect(choiceLabel('en', '복통')).toBe('Cramps');
  expect(choiceLabel('en', 'calm')).toBe('Calm');
});
