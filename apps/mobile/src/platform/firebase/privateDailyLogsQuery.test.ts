/* eslint-env jest */

jest.mock('@react-native-firebase/firestore', () => ({
  collection: jest.fn(() => 'private-daily-logs-collection'),
  documentId: jest.fn(() => '__name__'),
  getFirestore: jest.fn(() => 'firestore'),
  orderBy: jest.fn(
    (field: string, direction: string) => `order:${field}:${direction}`,
  ),
  query: jest.fn((...constraints: unknown[]) => constraints),
  where: jest.fn(
    (field: string, operator: string, value: string) =>
      `where:${field}:${operator}:${value}`,
  ),
}));

import { collection, orderBy, where } from '@react-native-firebase/firestore';
import {
  buildChangedPrivateDailyLogsQuery,
  buildPrivateDailyLogTombstonesQuery,
  buildPrivateDailyLogsQuery,
  sortDailyLogsNewestFirst,
} from './privateDailyLogsQuery';

const mockCollection = collection as jest.Mock;
const mockOrderBy = orderBy as jest.Mock;
const mockWhere = where as jest.Mock;

describe('private daily log query', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the built-in ascending document-name index for the first full sync', () => {
    buildPrivateDailyLogsQuery('user-1');

    expect(mockCollection).toHaveBeenCalledWith(
      'firestore',
      'users',
      'user-1',
      'privateDailyLogs',
    );
    expect(mockWhere).not.toHaveBeenCalled();
    expect(mockOrderBy).toHaveBeenCalledWith('__name__', 'asc');
    expect(mockOrderBy).not.toHaveBeenCalledWith('__name__', 'desc');
  });

  it('queries only log and tombstone changes from the persisted cursor', () => {
    const updatedAt = '2026-07-14T01:02:03.000Z';

    buildChangedPrivateDailyLogsQuery('user-1', updatedAt);
    buildPrivateDailyLogTombstonesQuery('user-1', updatedAt);

    expect(mockCollection).toHaveBeenNthCalledWith(
      1,
      'firestore',
      'users',
      'user-1',
      'privateDailyLogs',
    );
    expect(mockCollection).toHaveBeenNthCalledWith(
      2,
      'firestore',
      'users',
      'user-1',
      'privateDailyLogTombstones',
    );
    expect(mockWhere).toHaveBeenNthCalledWith(
      1,
      'updatedAt',
      '>=',
      new Date(updatedAt),
    );
    expect(mockWhere).toHaveBeenNthCalledWith(
      2,
      'updatedAt',
      '>=',
      new Date(updatedAt),
    );
    expect(mockOrderBy).toHaveBeenNthCalledWith(1, 'updatedAt', 'asc');
    expect(mockOrderBy).toHaveBeenNthCalledWith(2, 'updatedAt', 'asc');
  });

  it('keeps the public newest-first result contract without mutating input', () => {
    const logs = [
      { localDate: '2026-07-01', record: { moodTag: 'good' } },
      { localDate: '2026-07-31', record: { moodTag: 'neutral' } },
      { localDate: '2026-07-14', record: { moodTag: 'low' } },
    ] as const;

    expect(sortDailyLogsNewestFirst(logs).map(log => log.localDate)).toEqual([
      '2026-07-31',
      '2026-07-14',
      '2026-07-01',
    ]);
    expect(logs.map(log => log.localDate)).toEqual([
      '2026-07-01',
      '2026-07-31',
      '2026-07-14',
    ]);
  });
});
