const mockStorage = {
  getItem: jest.fn<Promise<string | null>, [string]>(),
  setItem: jest.fn<Promise<void>, [string, string]>(),
  removeItem: jest.fn<Promise<void>, [string]>(),
};

import {
  getLocalDateKey,
  readConditionShareDraftWithStorage,
  writeConditionShareDraftWithStorage,
} from './condition-storage-core';
import { EMPTY_SHARE_DRAFT, type ConditionShareDraft } from './share-draft';

const COMPLETE_DRAFT: ConditionShareDraft = {
  condition: 'cramps',
  helpPreference: 'listen',
};

describe('AppsInToss condition storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.getItem.mockResolvedValue(null);
    mockStorage.setItem.mockResolvedValue();
    mockStorage.removeItem.mockResolvedValue();
  });

  it('keeps a draft only for the same local date', async () => {
    mockStorage.getItem.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        savedLocalDate: '2026-08-02',
        draft: COMPLETE_DRAFT,
      }),
    );

    await expect(
      readConditionShareDraftWithStorage(mockStorage, '2026-08-02'),
    ).resolves.toEqual(COMPLETE_DRAFT);
    expect(mockStorage.removeItem).not.toHaveBeenCalled();
  });

  it('deletes yesterday draft before it can be shared as today', async () => {
    mockStorage.getItem.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        savedLocalDate: '2026-08-01',
        draft: COMPLETE_DRAFT,
      }),
    );

    await expect(
      readConditionShareDraftWithStorage(mockStorage, '2026-08-02'),
    ).resolves.toBe(EMPTY_SHARE_DRAFT);
    expect(mockStorage.removeItem).toHaveBeenCalledWith(
      'cycle-pair/condition-share/v1',
    );
  });

  it('writes a versioned payload with its local date', async () => {
    await writeConditionShareDraftWithStorage(
      mockStorage,
      COMPLETE_DRAFT,
      '2026-08-02',
    );

    expect(mockStorage.setItem).toHaveBeenCalledWith(
      'cycle-pair/condition-share/v1',
      JSON.stringify({
        schemaVersion: 1,
        savedLocalDate: '2026-08-02',
        draft: COMPLETE_DRAFT,
      }),
    );
  });

  it('uses the device local calendar date instead of UTC', () => {
    expect(getLocalDateKey(new Date(2026, 7, 2, 23, 59))).toBe('2026-08-02');
  });
});
