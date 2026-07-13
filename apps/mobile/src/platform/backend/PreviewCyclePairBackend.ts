import type {
  ActivePairMembership,
  BackendErrorHandler,
  CacheTombstone,
  CyclePairBackend,
  RemotePartnerProjection,
} from './CyclePairBackend';

function unsupported(): never {
  throw new Error('Firebase 개발 프로젝트에서만 사용할 수 있습니다.');
}

export const previewCyclePairBackend: CyclePairBackend = {
  kind: 'preview',
  async initialize() {
    return { uid: 'preview-self', isAnonymous: true };
  },
  async loadPrivateSetup() {
    return null;
  },
  async savePrivateSetup() {},
  async createPairInvite() {
    return unsupported();
  },
  async acceptPairInvite() {
    return unsupported();
  },
  async saveDailyLog() {},
  async saveShareSettings() {},
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
  watchShareSettings(
    _uid,
    _pairId,
    onValue,
    _onError,
  ) {
    onValue(null);
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
