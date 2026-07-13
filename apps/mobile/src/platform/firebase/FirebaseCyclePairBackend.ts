import { getApp } from '@react-native-firebase/app';
import { getAuth, signInAnonymously } from '@react-native-firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  initializeFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from '@react-native-firebase/firestore';
import {
  getFunctions,
  httpsCallable,
} from '@react-native-firebase/functions';
import type {
  BackendShareSettings,
  CacheTombstone,
  CyclePairBackend,
  PrivateCycleRecord,
  RemotePartnerProjection,
} from '../backend/CyclePairBackend';
import { toDeviceLocalDate } from '../backend/backendPayloads';

const FUNCTIONS_REGION = 'asia-northeast3';

let initialization: Promise<void> | undefined;

function ensureFirestoreConfigured(): Promise<void> {
  if (!initialization) {
    initialization = initializeFirestore(getApp(), { persistence: false })
      .then(() => undefined)
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.toLowerCase().includes('already')) throw error;
      });
  }
  return initialization;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value
    : undefined;
}

function timestampToIso(value: unknown): string | undefined {
  const maybeTimestamp = value as { toDate?: () => Date } | undefined;
  return maybeTimestamp?.toDate?.().toISOString();
}

function parseCycle(value: unknown): PrivateCycleRecord | undefined {
  const data = asRecord(value);
  const periodDates = asRecord(data?.periodDates);
  const nextPeriodWindow = asRecord(data?.nextPeriodWindow);
  const startDate = asString(periodDates?.startDate);
  const averageCycleLength = data?.averageCycleLength;
  const averagePeriodLength = data?.averagePeriodLength;
  if (
    !startDate ||
    typeof averageCycleLength !== 'number' ||
    typeof averagePeriodLength !== 'number'
  ) {
    return undefined;
  }

  return {
    averageCycleLength,
    averagePeriodLength,
    periodDates: {
      startDate,
      ...(asString(periodDates?.endDate)
        ? { endDate: asString(periodDates?.endDate) }
        : {}),
    },
    ...(asString(nextPeriodWindow?.startDate) && asString(nextPeriodWindow?.endDate)
      ? {
          nextPeriodWindow: {
            startDate: asString(nextPeriodWindow?.startDate)!,
            endDate: asString(nextPeriodWindow?.endDate)!,
          },
        }
      : {}),
  };
}

function parseShareSettings(value: unknown): BackendShareSettings {
  const data = asRecord(value);
  return {
    cyclePhase: data?.cyclePhase === true,
    nextPeriodWindow: data?.nextPeriodWindow === true,
    periodDates: data?.periodDates === true,
    moodTag: data?.moodTag === true,
    symptomTags: data?.symptomTags === true,
    carePreferences: data?.carePreferences === true,
  };
}

function parseProjection(value: unknown): RemotePartnerProjection | null {
  const data = asRecord(value);
  const ownerUid = asString(data?.ownerUid);
  const pairId = asString(data?.pairId);
  if (!data || !ownerUid || !pairId) return null;

  const periodDates = asRecord(data.periodDates);
  const nextPeriodWindow = asRecord(data.nextPeriodWindow);
  const cyclePhase = data.cyclePhase;
  const safePhase =
    cyclePhase === 'menstrual' ||
    cyclePhase === 'follicular' ||
    cyclePhase === 'luteal' ||
    cyclePhase === 'unknown'
      ? cyclePhase
      : undefined;

  return {
    ownerUid,
    pairId,
    ...(timestampToIso(data.generatedAt)
      ? { generatedAt: timestampToIso(data.generatedAt) }
      : {}),
    ...(asString(periodDates?.startDate)
      ? {
          periodDates: {
            startDate: asString(periodDates?.startDate)!,
            ...(asString(periodDates?.endDate)
              ? { endDate: asString(periodDates?.endDate) }
              : {}),
          },
        }
      : {}),
    ...(safePhase ? { cyclePhase: safePhase } : {}),
    ...(asString(nextPeriodWindow?.startDate) && asString(nextPeriodWindow?.endDate)
      ? {
          nextPeriodWindow: {
            startDate: asString(nextPeriodWindow?.startDate)!,
            endDate: asString(nextPeriodWindow?.endDate)!,
          },
        }
      : {}),
    ...(asStringArray(data.symptomTags)
      ? { symptomTags: asStringArray(data.symptomTags) }
      : {}),
    ...(asString(data.moodTag) ? { moodTag: asString(data.moodTag) } : {}),
    ...(asStringArray(data.carePreferences)
      ? { carePreferences: asStringArray(data.carePreferences) }
      : {}),
  };
}

async function call<Request, Response>(name: string, data: Request): Promise<Response> {
  const result = await httpsCallable<Request, Response>(
    getFunctions(getApp(), FUNCTIONS_REGION),
    name,
  )(data);
  return result.data;
}

export const firebaseCyclePairBackend: CyclePairBackend = {
  kind: 'firebase',

  async initialize() {
    await ensureFirestoreConfigured();
    const auth = getAuth();
    const credential = auth.currentUser
      ? { user: auth.currentUser }
      : await signInAnonymously(auth);
    return {
      uid: credential.user.uid,
      isAnonymous: credential.user.isAnonymous,
    };
  },

  async loadPrivateSetup(uid) {
    await ensureFirestoreConfigured();
    const firestore = getFirestore();
    const cycle = await getDoc(
      doc(firestore, 'users', uid, 'privateCycles', 'current'),
    );
    if (!cycle.exists()) return null;
    const cycleData = asRecord(cycle.data());
    const consentAcceptedAt = asString(cycleData?.consentAcceptedAt);
    if (!consentAcceptedAt) return null;
    const recordsCycle = cycleData?.recordsCycle === true;
    const parsedCycle = recordsCycle ? parseCycle(cycle.data()) : undefined;
    return {
      recordsCycle,
      consentAcceptedAt,
      ...(parsedCycle ? { cycle: parsedCycle } : {}),
    };
  },

  async savePrivateSetup(uid, recordsCycle, consentAcceptedAt, cycle) {
    await ensureFirestoreConfigured();
    const firestore = getFirestore();
    const cycleRef = doc(firestore, 'users', uid, 'privateCycles', 'current');
    await setDoc(cycleRef, {
      recordsCycle,
      consentAcceptedAt,
      ...(recordsCycle && cycle ? cycle : {}),
      updatedAt: serverTimestamp(),
      schemaVersion: 1,
    });
  },

  createPairInvite(recordsCycle) {
    return call('createPairInvite', { recordsCycle });
  },

  acceptPairInvite(inviteToken, recordsCycle) {
    return call('acceptPairInvite', { inviteToken: inviteToken.trim(), recordsCycle });
  },

  async saveDailyLog(uid, record) {
    await ensureFirestoreConfigured();
    const localDate = toDeviceLocalDate();
    await setDoc(
      doc(getFirestore(), 'users', uid, 'privateDailyLogs', localDate),
      { ...record, updatedAt: serverTimestamp(), schemaVersion: 1 },
    );
  },

  async saveShareSettings(uid, pairId, settings) {
    await ensureFirestoreConfigured();
    await setDoc(
      doc(getFirestore(), 'users', uid, 'shareSettings', pairId),
      { ...settings, updatedAt: serverTimestamp(), schemaVersion: 1 },
    );
  },

  async revokePair(pairId) {
    await call('revokePair', { pairId });
  },

  async acknowledgeCacheTombstone(tombstoneId) {
    await call('acknowledgeCacheTombstone', { tombstoneId });
  },

  watchActivePair(uid, onValue, onError) {
    const membershipQuery = query(
      collection(getFirestore(), 'users', uid, 'pairMemberships'),
      where('status', '==', 'active'),
      limit(1),
    );
    return onSnapshot(
      membershipQuery,
      snapshot => {
        const membership = snapshot.docs[0];
        const data = asRecord(membership?.data());
        const pairId = asString(data?.pairId);
        const partnerUid = asString(data?.partnerUid);
        onValue(pairId && partnerUid ? { pairId, partnerUid } : null);
      },
      onError,
    );
  },

  watchPartnerProjection(membership, onValue, onError) {
    return onSnapshot(
      doc(
        getFirestore(),
        'pairs',
        membership.pairId,
        'projections',
        membership.partnerUid,
      ),
      snapshot => onValue(snapshot.exists() ? parseProjection(snapshot.data()) : null),
      onError,
    );
  },

  watchShareSettings(uid, pairId, onValue, onError) {
    return onSnapshot(
      doc(getFirestore(), 'users', uid, 'shareSettings', pairId),
      snapshot =>
        onValue(snapshot.exists() ? parseShareSettings(snapshot.data()) : null),
      onError,
    );
  },

  watchPendingTombstones(uid, onValue, onError) {
    const tombstoneQuery = query(
      collection(getFirestore(), 'users', uid, 'cacheTombstones'),
      where('status', '==', 'pending'),
    );
    return onSnapshot(
      tombstoneQuery,
      snapshot => {
        const tombstones: CacheTombstone[] = snapshot.docs.flatMap(item => {
          const pairId = asString(asRecord(item.data())?.pairId);
          return pairId ? [{ id: item.id, pairId }] : [];
        });
        onValue(tombstones);
      },
      onError,
    );
  },
};
