import {
  collection,
  documentId,
  getFirestore,
  orderBy,
  query,
  where,
} from '@react-native-firebase/firestore';

import type { PrivateDailyLogSnapshot } from '../backend/CyclePairBackend';

/**
 * Firestore already provides the ascending document-name index by default.
 * The first sync establishes a complete baseline in that direction. Later
 * syncs use the updatedAt index and retain the UI's newest-first contract with
 * a client-side sort.
 */
export function buildPrivateDailyLogsQuery(
  uid: string,
) {
  return query(
    collection(getFirestore(), 'users', uid, 'privateDailyLogs'),
    orderBy(documentId(), 'asc'),
  );
}

function buildChangesQuery(
  uid: string,
  collectionName: 'privateDailyLogs' | 'privateDailyLogTombstones',
  updatedAt: string,
) {
  const cursor = new Date(updatedAt);
  return query(
    collection(getFirestore(), 'users', uid, collectionName),
    where('updatedAt', '>=', cursor),
    orderBy('updatedAt', 'asc'),
  );
}

export function buildChangedPrivateDailyLogsQuery(
  uid: string,
  updatedAt: string,
) {
  return buildChangesQuery(uid, 'privateDailyLogs', updatedAt);
}

export function buildPrivateDailyLogTombstonesQuery(
  uid: string,
  updatedAt?: string,
) {
  if (updatedAt) {
    return buildChangesQuery(uid, 'privateDailyLogTombstones', updatedAt);
  }
  return query(
    collection(
      getFirestore(),
      'users',
      uid,
      'privateDailyLogTombstones',
    ),
    orderBy(documentId(), 'asc'),
  );
}

export function sortDailyLogsNewestFirst(
  logs: readonly PrivateDailyLogSnapshot[],
): PrivateDailyLogSnapshot[] {
  return [...logs].sort((left, right) =>
    right.localDate.localeCompare(left.localDate),
  );
}
