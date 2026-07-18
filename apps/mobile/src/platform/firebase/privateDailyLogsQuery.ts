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
 * Fetch the complete bounded range in that direction, then retain the UI's
 * newest-first contract with a client-side sort.
 */
export function buildPrivateDailyLogsQuery(
  uid: string,
  fromDate: string,
  toDate: string,
) {
  return query(
    collection(getFirestore(), 'users', uid, 'privateDailyLogs'),
    where(documentId(), '>=', fromDate),
    where(documentId(), '<=', toDate),
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
