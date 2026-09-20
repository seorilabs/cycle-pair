import {
  EMPTY_SHARE_DRAFT,
  buildConditionShareMessage,
  isCompleteShareDraft,
  parseShareDraft,
} from './share-draft';

describe('AppsInToss condition share draft', () => {
  test('builds a neutral message from explicit selections only', () => {
    const message = buildConditionShareMessage({
      condition: 'cramps',
      helpPreference: 'listen',
    });

    expect(message).toContain('배가 아파요');
    expect(message).toContain('그냥 들어줘요');
    expect(message).not.toMatch(/생리|주기|날짜|증상/);
  });

  test('rejects unknown persisted values', () => {
    expect(
      parseShareDraft({ condition: 'unknown-value', helpPreference: 'listen' }),
    ).toEqual({ condition: null, helpPreference: 'listen' });
    expect(parseShareDraft(null)).toEqual(EMPTY_SHARE_DRAFT);
  });

  test('requires both selections before sharing', () => {
    expect(
      isCompleteShareDraft({ condition: 'comfortable', helpPreference: null }),
    ).toBe(false);
    expect(
      isCompleteShareDraft({
        condition: 'comfortable',
        helpPreference: 'no-action',
      }),
    ).toBe(true);
  });
});
