import type {
  ActivePairMembership,
  BackendErrorHandler,
  CacheTombstone,
  CyclePairBackend,
  PairEvent,
  PrivateDailyLogSnapshot,
  RemotePartnerProjection,
} from './CyclePairBackend';

function unsupported(): never {
  throw new Error('Firebase 개발 프로젝트에서만 사용할 수 있습니다.');
}

const dailyLogs = new Map<string, PrivateDailyLogSnapshot>();
const pairEvents = new Map<string, PairEvent>();

function dailyKey(uid: string, localDate: string): string {
  return `${uid}:${localDate}`;
}

function eventKey(pairId: string, eventId: string): string {
  return `${pairId}:${eventId}`;
}

export const previewCyclePairBackend: CyclePairBackend = {
  kind: 'preview',
  async initialize() {
    return { uid: 'preview-self', isAnonymous: true };
  },
  async quiesceSessionForLogout() {
    return { flushed: 0, remaining: 0, failed: 0 };
  },
  async quiesceSession() {},
  resumeSession() {},

  async loadCachedActivePair() {
    return null;
  },

  async loadCachedPairEvents() {
    return [];
  },
  async loadPrivateSetup() {
    return null;
  },
  async savePrivateSetup() {
    return { status: 'synced', mutationId: 'private-setup-current' };
  },
  async createPairInvite() {
    return unsupported();
  },
  async acceptPairInvite() {
    return unsupported();
  },
  async listDailyLogs(uid, fromDate, toDate) {
    return [...dailyLogs.entries()]
      .filter(
        ([key, snapshot]) =>
          key.startsWith(`${uid}:`) &&
          snapshot.localDate >= fromDate &&
          snapshot.localDate <= toDate,
      )
      .map(([, snapshot]) => snapshot)
      .sort((left, right) => right.localDate.localeCompare(left.localDate));
  },
  async saveDailyLog(uid, localDate, record, mutationId) {
    dailyLogs.set(dailyKey(uid, localDate), {
      localDate,
      record,
      mutationId,
      updatedAt: new Date().toISOString(),
    });
    return { status: 'synced', mutationId };
  },
  async deleteDailyLog(uid, localDate, mutationId) {
    dailyLogs.delete(dailyKey(uid, localDate));
    return { status: 'synced', mutationId };
  },
  async saveShareSettings(_uid, pairId) {
    return { status: 'synced', mutationId: `share-settings-${pairId}` };
  },
  async upsertPairEvent(uid, pairId, event, mutationId) {
    const existing = pairEvents.get(eventKey(pairId, event.id));
    pairEvents.set(eventKey(pairId, event.id), {
      ...event,
      pairId,
      createdBy: existing?.createdBy ?? uid,
      updatedBy: uid,
      mutationId,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { status: 'synced', mutationId };
  },
  async deletePairEvent(_uid, pairId, eventId, mutationId) {
    pairEvents.delete(eventKey(pairId, eventId));
    return { status: 'synced', mutationId };
  },
  async flushPendingMutations() {
    return { flushed: 0, remaining: 0, failed: 0 };
  },
  async clearPendingPairMutations() {},
  async revokePair() {},
  async acknowledgeCacheTombstone() {},
  watchActivePair(
    _uid: string,
    onValue: (membership: ActivePairMembership | null) => void,
    _onError: BackendErrorHandler,
  ) {
    onValue(null);
    return () => undefined;
  },
  watchPartnerProjection(
    _membership: ActivePairMembership,
    onValue: (projection: RemotePartnerProjection | null) => void,
    _onError: BackendErrorHandler,
  ) {
    onValue(null);
    return () => undefined;
  },
  watchShareSettings(_uid, _pairId, onValue, _onError) {
    onValue(null);
    return () => undefined;
  },
  watchPairEvents(membership, onValue, _onError) {
    onValue(
      [...pairEvents.values()]
        .filter(event => event.pairId === membership.pairId)
        .sort((left, right) =>
          left.date === right.date
            ? (left.startTime ?? '').localeCompare(right.startTime ?? '')
            : left.date.localeCompare(right.date),
        ),
    );
    return () => undefined;
  },
  watchPendingTombstones(
    _uid: string,
    onValue: (tombstones: readonly CacheTombstone[]) => void,
    _onError: BackendErrorHandler,
  ) {
    onValue([]);
    return () => undefined;
  },
};
